import type { Context } from 'koishi'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Config } from './index'

type ApiConfig = Pick<Config, 'apiHost' | 'apiKey' | 'waitSeconds' | 'pollInterval' | 'pollTimeout' | 'downloadTimeout'>
type ApiResult = Record<string, unknown>

interface ApiResponse {
  data: ApiResult
  requestId?: string
}

const retryableCodes = new Set([
  'RATE_LIMITED', 'QUEUE_FULL', 'IDENTITY_POOL_EXHAUSTED', 'ENDPOINT_CIRCUIT_OPEN',
  'UPSTREAM_RISK_CONTROL', 'SIGNING_FAILED', 'INTERNAL', 'DOWNLOADER_UNAVAILABLE',
])

interface ApiFailure {
  code: string
  message: string
  retryable: boolean
  retryAfter: number
  requestId?: string
}

class DtkApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    const { code, message, requestId } = failure
    super(`${code}：${message}${requestId ? ` (request_id=${requestId})` : ''}`)
    this.name = 'DtkApiError'
  }
}

class DtkTaskError extends DtkApiError {}

export function isRecord(value: unknown): value is ApiResult {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseEnvelope(text: string): ApiResult {
  try {
    const value: unknown = JSON.parse(text)
    if (isRecord(value)) return value
  } catch {
    // Proxies can return a non-JSON response, including on HTTP 429.
  }
  return {}
}

function nonNegativeNumber(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function apiFailure(error: unknown, requestId?: string, status = 0, headers?: Headers): ApiFailure {
  const data = isRecord(error) ? error : {}
  const defaultCode = status === 429 ? 'RATE_LIMITED' : status >= 400 ? `HTTP_${status}` : 'PARSE_FAILED'
  const code = typeof data.code === 'string' ? data.code : defaultCode
  const message = typeof data.message === 'string' ? data.message : 'dtk 请求或任务失败'
  const retryAfter = headers?.get('Retry-After')
  const headerDelay = retryAfter ? (nonNegativeNumber(retryAfter)
    ?? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000)) : 0
  return {
    code,
    message,
    requestId,
    retryable: data.retryable !== false && (status === 429 || data.retryable === true || retryableCodes.has(code)),
    retryAfter: Math.max(nonNegativeNumber(data.retry_after) ?? 0, headerDelay || 0) * 1000,
  }
}

export function describeError(error: unknown, key: string) {
  const message = error instanceof Error ? error.message : String(error)
  return (key ? message.split(key).join('[已隐藏]') : message)
    .replace(/dtk_[a-z0-9_-]+/gi, '[已隐藏]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[链接已隐藏]')
}

function hasContent(value: unknown): value is ApiResult {
  return isRecord(value) && (isRecord(value.media) || typeof value.kind === 'string')
}

function remaining(deadline: number) {
  const timeout = deadline - Date.now()
  if (timeout <= 0) throw new Error('dtk 解析任务等待超时')
  return timeout
}

export class DouyinApi {
  private readonly controller = new AbortController()
  private readonly logger
  private rateResumeAt = 0
  readonly baseUrl: string

  constructor(private readonly ctx: Context, private readonly config: ApiConfig) {
    this.baseUrl = config.apiHost.trim().replace(/\/+$/, '')
    this.logger = ctx.logger('douyin-analytics')
    ctx.on('dispose', () => this.controller.abort())
  }

  get disposed() {
    return this.controller.signal.aborted
  }

  async parse(url: string) {
    if (!this.baseUrl) throw new Error('未配置 dtk API 地址')
    const wait = Math.max(0, Math.min(30, this.config.waitSeconds))
    const timeout = Math.max(15_000, (wait + 10) * 1000)
    let response = await this.submit(url, wait, Date.now() + timeout, timeout)
    const deadline = Date.now() + this.config.pollTimeout * 1000
    let refreshedExpired = false
    for (let attempt = 0; ; attempt++) {
      const taskId = response.data.task_id
      if (hasContent(response.data) && !taskId) return response.data
      if (typeof taskId !== 'string' || !taskId) throw new Error('dtk 没有返回解析内容或任务 ID')

      try {
        return await this.collect(response, taskId, deadline)
      } catch (error) {
        if (!(error instanceof DtkApiError) || attempt >= 2) throw error
        if (error.failure.code === 'TASK_NOT_FOUND' && !refreshedExpired) {
          refreshedExpired = true
          this.logger.info('dtk 解析任务已过期，重新提交')
        } else {
          if (!(error instanceof DtkTaskError) || !error.failure.retryable || error.failure.code === 'TASK_NOT_FOUND') throw error
          await this.backoff(error, attempt, deadline)
        }
      }
      response = await this.submit(url, 0, deadline, 15_000, true)
    }
  }

  private submit(url: string, wait: number, deadline: number, timeout: number, refresh = false) {
    const path = `/api/v1/parse?wait=${wait}&lang=zh${refresh ? '&refresh=true' : ''}`
    return this.request(path, deadline, timeout, { url, include_raw: false })
  }

  private async collect(response: ApiResponse, taskId: string, deadline: number): Promise<ApiResult> {
    const path = `/api/v1/tasks/${encodeURIComponent(taskId)}?lang=zh`
    const initialDelay = this.config.pollInterval * 1000
    let delay = initialDelay
    let lastState = ''
    for (let submitted = true; ; submitted = false) {
      const task = response.data
      if (task.task_id !== taskId) throw new Error('dtk 返回了不匹配的任务 ID')
      const state = String(task.state || task.status || '').toLowerCase()
      if (state !== lastState) {
        this.logger.debug('dtk 解析任务状态 %s', describeError(state, this.config.apiKey))
        lastState = state
      }
      const done = ['done', 'success', 'succeeded'].includes(state)
      const failed = ['failed', 'error'].includes(state)
      if (done && hasContent(task.data)) return task.data
      if (done && !submitted) throw new Error('dtk 已完成任务没有返回解析内容')
      if (failed && (isRecord(task.error) || !submitted)) {
        throw new DtkTaskError(apiFailure(task.error, response.requestId))
      }
      if (['cancelled', 'canceled'].includes(state)) throw new Error('dtk 解析任务已取消')
      if (!submitted) {
        await sleep(Math.min(delay, remaining(deadline)), undefined, { signal: this.controller.signal })
        delay = Math.min(delay * 2, Math.max(initialDelay, 5_000))
      }
      response = await this.request(path, deadline, 15_000)
    }
  }

  private async withRequestSignal<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.controller.signal
    signal.throwIfAborted()
    // Koishi's HTTP service can leave its listener attached to a request signal.
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    try {
      return await request(controller.signal)
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private async request(path: string, deadline: number, timeout: number, body?: object): Promise<ApiResponse> {
    for (let attempt = 0; ; attempt++) {
      const rateDelay = this.rateResumeAt - Date.now()
      if (rateDelay > 0) {
        if (rateDelay >= remaining(deadline)) throw new Error('dtk 限流等待时间超过解析超时设置')
        await sleep(rateDelay, undefined, { signal: this.controller.signal })
      }
      const response = await this.withRequestSignal(signal => this.ctx.http(`${this.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        data: body,
        headers: {
          Accept: 'application/json',
          ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
        },
        timeout: Math.min(timeout, remaining(deadline)),
        signal,
        validateStatus: () => true,
        responseType: 'text',
      }))
      const envelope = parseEnvelope(response.data)
      const meta = isRecord(envelope.meta) ? envelope.meta : {}
      const requestId = response.headers.get('X-Request-ID') || (typeof meta.request_id === 'string' ? meta.request_id : undefined)
      const rateReset = Number(response.headers.get('X-RateLimit-Reset')) * 1000
      if (response.headers.get('X-RateLimit-Remaining') === '0' && Number.isFinite(rateReset)) {
        this.rateResumeAt = Math.max(this.rateResumeAt, rateReset)
      }
      if (response.status < 400 && envelope.success === true && isRecord(envelope.data)) {
        return { data: envelope.data, requestId }
      }

      if (response.status < 400 && envelope.success !== false) {
        throw new Error(`dtk 返回无效响应${requestId ? ` (request_id=${requestId})` : ''}`)
      }
      const failure = apiFailure(envelope.error, requestId, response.status, response.headers)
      const { code, retryable, retryAfter } = failure
      if (response.status === 429 || code === 'RATE_LIMITED') {
        this.rateResumeAt = Math.max(this.rateResumeAt, Date.now() + retryAfter)
      }
      const error = new DtkApiError(failure)
      if (!retryable || code === 'TASK_NOT_FOUND' || attempt >= 2) throw error
      await this.backoff(error, attempt, deadline)
    }
  }

  private async backoff(error: DtkApiError, attempt: number, deadline: number) {
    const wait = Math.max(error.failure.retryAfter, 2 ** attempt * 1000, this.rateResumeAt - Date.now())
    if (wait >= remaining(deadline)) throw error
    this.logger.warn('dtk 将在 %d 毫秒后重试：%s', wait, describeError(error, this.config.apiKey))
    await sleep(wait, undefined, { signal: this.controller.signal })
  }

  async download(urls: string[]) {
    const deadline = Date.now() + this.config.downloadTimeout * 1000
    for (const [index, url] of urls.entries()) {
      const budget = deadline - Date.now()
      if (budget <= 0) break
      const hasBackup = index + 1 < urls.length
      try {
        const video = await this.withRequestSignal(signal => this.ctx.http.get(url, {
          headers: {
            Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.1',
            Referer: 'https://www.douyin.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          },
          responseType: 'arraybuffer',
          signal,
          timeout: hasBackup ? Math.min(60_000, Math.ceil(budget / 2)) : budget,
        }))
        if (!video?.byteLength) throw new Error('视频下载结果为空')
        return video
      } catch (error) {
        if (this.disposed) throw error
        this.logger.debug('视频地址 %d 下载失败：%s', index + 1, describeError(error, this.config.apiKey))
        if (hasBackup) this.logger.info('视频下载失败，尝试备用地址')
      }
    }
    throw new Error('所有视频下载地址均失败或已超时')
  }
}
