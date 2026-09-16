import { Context, Schema, h } from 'koishi'

export const name = 'douyin'

export const usage = `
## 解析群聊中的抖音链接

发送包含抖音链接的消息即可触发解析。插件使用 dtk 的 "/api/v1/parse" 接口，
支持异步任务轮询、视频和图集，并在下载媒体后发送。

请在配置中填写 dtk API 地址和 API Key。API 的同步等待上限为 30 秒；如果任务
在此时间内没有完成，插件会继续轮询，不会把 202 当成解析失败。
`

export interface Config {
  apiHost: string
  apiKey: string
  maxDuration: number
  forward: boolean
  waitSeconds: number
  pollInterval: number
  pollTimeout: number
  downloadTimeout: number
}

export const Config = Schema.object({
  apiHost: Schema.string().default('http://10.1.2.30:60080').description('dtk API 地址'),
  apiKey: Schema.string().role('secret').default('').description('dtk API Key，不要写入源码'),
  maxDuration: Schema.number().min(0).default(90).description('允许发送的视频最大长度（秒），超出后只发送封面'),
  forward: Schema.boolean().default(false).description('以合并消息发送解析内容（仅支持 OneBot 适配器）'),
  waitSeconds: Schema.number().min(0).max(30).default(20).description('首次请求等待时间（秒），dtk 最大为 30 秒'),
  pollInterval: Schema.number().min(0.2).max(10).default(1).description('异步任务轮询间隔（秒）'),
  pollTimeout: Schema.number().min(5).max(600).default(180).description('异步任务最多等待时间（秒）'),
  downloadTimeout: Schema.number().min(10).max(600).default(180).description('视频媒体下载超时时间（秒）'),
})

type RecordValue = Record<string, any>

interface DtkErrorBody {
  code?: string
  message?: string
  retry_after?: number | null
  retryable?: boolean
  [key: string]: any
}

interface DtkResponse<T> {
  success: boolean
  data: T | null
  error?: DtkErrorBody | null
  meta?: RecordValue
}

interface ParseTask {
  task_id: string
  state?: string
  status?: string
  data?: ParsedData | null
  error?: DtkErrorBody | null
  [key: string]: any
}

interface ParsedData {
  kind?: string
  title?: string
  description?: string
  duration_ms?: number | string | null
  media?: RecordValue | null
  [key: string]: any
}

class DtkApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'DtkApiError'
  }
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function cleanUrl(value: string) {
  return value.replace(/[)\]}>，。！？；：,.!?]+$/u, '')
}

function extractDouyinUrl(content: string) {
  const candidates = content.match(/https?:\/\/[^\s]+/gi) || []
  for (const candidate of candidates) {
    const url = cleanUrl(candidate)
    if (!isHttpUrl(url)) continue
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname === 'douyin.com' || hostname.endsWith('.douyin.com')) return url
  }
}

function firstUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return
  if (isHttpUrl(value)) return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item, depth + 1)
      if (url) return url
    }
    return
  }
  if (!isRecord(value)) return
  for (const key of ['url', 'src', 'download_url', 'uri']) {
    const url = firstUrl(value[key], depth + 1)
    if (url) return url
  }
  for (const key of ['urls', 'url_list']) {
    const url = firstUrl(value[key], depth + 1)
    if (url) return url
  }
}

function collectUrls(value: unknown, result: string[] = [], depth = 0) {
  if (depth > 4 || result.length >= 30) return result
  if (isHttpUrl(value)) {
    const url = value.trim()
    if (!result.includes(url)) result.push(url)
    return result
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, result, depth + 1)
    return result
  }
  if (!isRecord(value)) return result
  for (const key of ['url', 'src', 'download_url', 'uri', 'urls', 'url_list']) {
    collectUrls(value[key], result, depth + 1)
  }
  return result
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.stack || error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function responseError<T>(stage: string, response: DtkResponse<T>) {
  const body = isRecord(response.error) ? response.error : {}
  const code = typeof body.code === 'string' ? body.code : undefined
  const message = typeof body.message === 'string' ? body.message : '接口返回失败'
  const requestId = isRecord(response.meta) && typeof response.meta.request_id === 'string'
    ? response.meta.request_id
    : undefined
  const suffix = requestId ? ` request_id=${requestId}` : ''
  return new DtkApiError(`${stage}: ${code ? `${code} ` : ''}${message}${suffix}`, code, requestId)
}

function isParsedData(value: unknown): value is ParsedData {
  return isRecord(value) && (isRecord(value.media) || typeof value.kind === 'string')
}

function isParseTask(value: unknown): value is ParseTask {
  return isRecord(value) && typeof value.task_id === 'string' && value.task_id.length > 0
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  const baseUrl = config.apiHost.replace(/\/+$/, '')

  if (!config.apiKey) logger.warn('未配置 dtk API Key，抖音链接解析将无法通过认证')

  function apiUrl(path: string) {
    return baseUrl + path
  }

  function httpOptions(timeout: number) {
    return {
      headers: {
        Accept: 'application/json',
        ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
      },
      timeout,
    }
  }

  async function waitForTask(taskId: string): Promise<ParsedData> {
    const deadline = Date.now() + config.pollTimeout * 1000
    let lastState = ''

    while (Date.now() < deadline) {
      const response = await ctx.http.get<DtkResponse<ParseTask>>(
        apiUrl(`/api/v1/tasks/${encodeURIComponent(taskId)}?lang=zh`),
        httpOptions(15_000),
      )
      if (!response || !response.success) {
        throw response ? responseError('查询解析任务失败', response) : new Error('查询解析任务没有返回响应')
      }

      const task = response.data
      if (!isParseTask(task)) throw new Error('任务响应缺少 task_id')

      const state = String(task.state || task.status || '').toLowerCase()
      if (state !== lastState) {
        logger.info(`解析任务 ${taskId} 状态：${state || 'unknown'}`)
        lastState = state
      }

      if (state === 'done' || state === 'success' || state === 'succeeded') {
        if (isParsedData(task.data)) return task.data
        throw new Error(`解析任务 ${taskId} 已完成，但没有返回内容`)
      }
      if (state === 'failed' || state === 'error' || state === 'cancelled' || state === 'canceled') {
        const detail = isRecord(task.error) && typeof task.error.message === 'string'
          ? task.error.message
          : `任务状态为 ${state}`
        throw new DtkApiError(`解析任务失败：${detail}`, task.error?.code)
      }

      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await sleep(Math.min(config.pollInterval * 1000, remaining))
    }

    throw new Error(`解析任务超过 ${config.pollTimeout} 秒仍未完成`)
  }

  async function parseContent(input: string): Promise<ParsedData> {
    const wait = Math.max(0, Math.min(30, config.waitSeconds))
    const response = await ctx.http.post<DtkResponse<ParsedData | ParseTask>>(
      `${apiUrl('/api/v1/parse')}?wait=${wait}&lang=zh`,
      { url: input, include_raw: false },
      httpOptions(Math.max(15_000, (wait + 10) * 1000)),
    )

    if (!response || !response.success) {
      throw response ? responseError('提交解析任务失败', response) : new Error('解析接口没有返回响应')
    }
    if (isParsedData(response.data)) return response.data
    if (isParseTask(response.data)) return waitForTask(response.data.task_id)
    throw new Error('解析接口返回了无法识别的 data')
  }

  async function downloadVideo(url: string) {
    const video = await ctx.http.get<ArrayBuffer>(url, {
      headers: { Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.1' },
      responseType: 'arraybuffer',
      timeout: config.downloadTimeout * 1000,
    })
    if (!video || video.byteLength === 0) throw new Error('视频下载结果为空')
    return video
  }

  ctx.middleware(async (session, next) => {
    const content = session.content || ''
    if (!content.toLowerCase().includes('douyin.com')) return next()

    const url = extractDouyinUrl(content)
    if (!url) return next()

    try {
      const data = await parseContent(url)
      const media = isRecord(data.media) ? data.media : {}
      const imageUrls = collectUrls(media.images)
      const videoUrl = firstUrl(media.video)
      const coverUrl = firstUrl(media.covers)
      const durationMs = Number(data.duration_ms)
      const duration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined
      const title = data.description || data.title || '未提供描述'
      const parts: (string | h)[] = [`抖音解析：\n${title}`]

      if (imageUrls.length > 0) {
        for (const imageUrl of imageUrls) parts.push(h('img', { src: imageUrl }))
      } else if (duration !== undefined && duration > config.maxDuration * 1000) {
        parts.push('视频过长~ 请打开抖音客户端查看')
        if (coverUrl) parts.push(h('img', { src: coverUrl }))
      } else if (videoUrl) {
        const video = await downloadVideo(videoUrl)
        parts.push(h.video(video, 'video/mp4'))
      } else if (coverUrl) {
        parts.push('接口未返回可用视频，以下发送封面预览')
        parts.push(h('img', { src: coverUrl }))
      } else {
        throw new Error(`接口未返回可用媒体，kind=${data.kind || 'unknown'}`)
      }

      if (config.forward && session.platform === 'onebot') {
        await session.send(h('message', {
          forward: true,
          children: parts.map(part => h('message', part)),
        }))
      } else if (imageUrls.length > 3) {
        await session.send(parts[0])
        await session.send(h('message', { forward: true, children: parts.slice(1) }))
      } else {
        for (const part of parts) await session.send(part)
      }
    } catch (error) {
      logger.error(`处理抖音链接失败（${url}）：${formatError(error)}`)
      return '抖音解析失败，请稍后重试'
    }
  })
}
