import { Context, Schema, h } from 'koishi'
import { describeError, DouyinApi, isRecord } from './api'

export const name = 'douyin-analytics'

export const usage = `
## 解析群聊中的抖音链接

发送包含抖音链接的消息即可触发解析。插件使用 dtk 的 "/api/v1/parse" 接口，
支持异步任务轮询、视频和图集，并在下载媒体后发送。

需要部署后端 [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)。
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
  apiHost: Schema.string().default('').description('dtk API 地址，请先部署后端服务'),
  apiKey: Schema.string().role('secret').default('').description('dtk API Key，不要写入源码'),
  maxDuration: Schema.number().min(0).default(90).description('视频时长上限（秒），超出、时长未知或设为 0 时仅发送预览'),
  forward: Schema.boolean().default(false).description('以合并消息发送解析内容（仅支持 OneBot 适配器）'),
  waitSeconds: Schema.number().min(0).max(30).default(20).description('首次请求等待时间（秒），dtk 最大为 30 秒'),
  pollInterval: Schema.number().min(0.2).max(10).default(1).description('异步任务轮询初始间隔（秒）'),
  pollTimeout: Schema.number().min(5).max(600).default(180).description('异步任务最多等待时间（秒）'),
  downloadTimeout: Schema.number().min(10).max(600).default(180).description('视频下载及备用地址的总超时时间（秒）'),
})

const shareDomains = ['douyin.com', 'iesdouyin.com', 'amemv.com']
const mediaUrlFields = ['url', 'src', 'download_url', 'uri', 'urls', 'url_list']

function httpUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url
  } catch {
    // Malformed links are ignored.
  }
}

function extractDouyinUrl(content: string) {
  const candidates = content.match(/https?:\/\/[^\s<>"']+/gi) || []
  for (const candidate of candidates) {
    const value = candidate.replace(/&amp;/gi, '&').replace(/[)\]}>，。！？；：,.!?]+$/u, '')
    const url = httpUrl(value)
    if (url && shareDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
      return value
    }
  }
}

function collectUrls(value: unknown, limit = 30, result = new Set<string>(), depth = 0) {
  if (depth > 4 || result.size >= limit) return result
  if (typeof value === 'string') {
    const url = value.trim()
    if (httpUrl(url)) result.add(url)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, limit, result, depth + 1)
      if (result.size >= limit) break
    }
  } else if (isRecord(value)) {
    for (const key of mediaUrlFields) {
      collectUrls(value[key], limit, result, depth + 1)
      if (result.size >= limit) break
    }
  }
  return result
}

function firstUrl(value: unknown): string | undefined {
  return collectUrls(value, 1).values().next().value
}

function albumImageUrls(images: unknown) {
  const selected = new Map<string, string>()
  for (const image of Array.isArray(images) ? images : [images]) {
    const value = firstUrl(image)
    if (!value) continue
    const url = new URL(value)
    // CDN mirrors can share a storage object while using different hosts, signatures and formats.
    const object = /(?:^|\.)(?:douyinpic\.com|byteimg\.com|ibyteimg\.com|pstatp\.com)$/.test(url.hostname)
      && /^\/(tos-[\w-]+\/[\w-]+)(?:~tplv-[^/]+|\.(?:jpeg|jpg|png|webp|heic|gif))?$/i.exec(url.pathname)?.[1]
    const key = object ? `tos:${object}` : value
    if (!selected.has(key)) selected.set(key, value)
    if (selected.size >= 30) break
  }
  return [...selected.values()]
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  const api = new DouyinApi(ctx, config)
  if (!api.baseUrl) logger.warn('未配置 dtk API 地址，抖音链接解析将无法使用')
  if (!config.apiKey) logger.warn('未配置 dtk API Key，抖音链接解析将无法通过认证')

  ctx.middleware(async (session, next) => {
    const url = extractDouyinUrl(session.content || '')
    if (!url) return next()

    try {
      const data = await api.parse(url)
      if (data.platform && data.platform !== 'douyin') throw new Error('接口返回的内容不属于抖音')
      const media = isRecord(data.media) ? data.media : {}
      const imageUrls = albumImageUrls(media.images)
      const title = data.description || data.title || '未提供描述'
      const parts: (string | h)[] = [`抖音解析：\n${title}`]

      if (imageUrls.length) {
        for (const imageUrl of imageUrls) parts.push(h('img', { src: imageUrl }))
      } else {
        const cover = firstUrl(media.covers)
        const videoUrls = [...collectUrls([media.video, media.streams])]
        const rawDuration = data.duration_ms
        const duration = typeof rawDuration === 'number' || typeof rawDuration === 'string' ? Number(rawDuration) : NaN
        let preview: string | undefined
        if (!videoUrls.length) {
          if (!cover) throw new Error('接口未返回可用媒体')
          preview = '接口未返回可用视频，以下发送封面预览'
        } else if (config.maxDuration === 0) {
          preview = '当前仅发送视频预览'
        } else if (!Number.isFinite(duration) || duration <= 0) {
          preview = '无法确认视频时长~ 请打开抖音客户端查看'
        } else if (duration > config.maxDuration * 1000) {
          preview = '视频过长~ 请打开抖音客户端查看'
        } else {
          const video = await api.download(videoUrls)
          parts.push(h.video(video, 'video/mp4'))
        }
        if (preview) {
          parts.push(preview)
          if (cover) parts.push(h('img', { src: cover }))
        }
      }

      if (api.disposed) return
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
      if (api.disposed) return
      logger.error('处理抖音链接失败：%s', describeError(error, config.apiKey))
      return '抖音解析失败，请稍后重试'
    }
  })
}
