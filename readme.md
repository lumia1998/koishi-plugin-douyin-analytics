# koishi-plugin-douyin-analytics

Koishi 抖音链接解析插件，使用 [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)（dtk）提供解析服务。

本项目是 Koishi 侧的适配插件，不包含 dtk 服务端。使用前请先按照上游项目的说明部署 dtk API，并在插件配置中填写 API 地址和 API Key。

## 功能

- 识别群聊中的抖音分享链接，包括带有额外分享文案的消息，支持 `douyin.com`、`iesdouyin.com` 和 `amemv.com` 及其子域名。
- 支持视频和图集解析。
- 使用 dtk v5 的 `/api/v1/parse` 接口，并兼容 `202 + task_id` 异步任务。
- 视频解析成功后下载接口返回的媒体，主地址失败时尝试备用地址。
- 支持限制视频发送时长、OneBot 合并转发和图集合并转发。
- 接口限流或临时繁忙时自动退避重试，过期的解析任务会重新提交。
- 解析失败、接口错误和异步超时会写入 Koishi 插件日志，日志中的 API Key 和链接会脱敏，群内仍使用统一的失败提示。

## 安装

在 Koishi 插件市场搜索 `koishi-plugin-douyin-analytics`，或使用包管理器安装：

```bash
npm install koishi-plugin-douyin-analytics
```

## 配置

在 Koishi 控制台中配置：

插件在 Koishi 配置中的实例名使用 `douyin-analytics`，例如 `douyin-analytics:local`；npm 包名为 `koishi-plugin-douyin-analytics`。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiHost` | 空 | dtk API 地址。需要先部署 [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)，再填写实际地址。 |
| `apiKey` | 空 | 通过 `X-API-Key` 请求头发送的 dtk API Key。 |
| `maxDuration` | `90` | 允许发送的视频最大时长，单位为秒。时长超限、未知或设为 `0` 时，仅发送预览。 |
| `forward` | `false` | OneBot 适配器下是否使用合并转发。 |
| `waitSeconds` | `20` | 首次解析请求的同步等待时间，范围 `0-30` 秒。 |
| `pollInterval` | `1` | 异步任务初始轮询间隔，单位为秒，等待期间逐步拉长。 |
| `pollTimeout` | `180` | 异步任务轮询和重试共用的等待时间，单位为秒。 |
| `downloadTimeout` | `180` | 视频主地址和备用地址共用的下载超时，单位为秒。 |

请不要把 API Key 写入源码、README 或提交到 Git 仓库。内网 API 地址也只适用于能访问该内网的 Koishi 实例。

## 异步解析说明

dtk 可能在首次请求等待结束后返回 `202` 和 `task_id`。插件会继续请求：

```text
GET /api/v1/tasks/{task_id}
```

直到任务完成、失败或达到 `pollTimeout`，不会因为首次等待结束就立即判定解析失败。因此，3 分钟视频不会让插件固定等待 3 分钟；等待时间取决于 API 实际解析速度和 `pollTimeout`。需要注意的是，`maxDuration` 默认是 90 秒，3 分钟视频解析完成后默认只发送封面，如需发送可将它调整为 `180` 或更高。

解析成功后，插件会依次尝试 dtk 在 `media.video` 和 `media.streams` 返回的下载地址，再把视频二进制交给 Koishi 的 `h.video()` 发送。图集则使用 `media.images` 逐张发送。

## 相关项目

- [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)：dtk API 部署与接口文档
- V5 解析改进参考上游 [koishi-plugin-douyin 的 PR #10](https://github.com/tediorelee/koishi-plugin-douyin/pull/10)。
- [koishi-plugin-douyin-analytics](https://github.com/lumia1998/koishi-plugin-douyin-analytics)：本插件仓库

## 许可证

本插件采用 [MIT License](./LICENSE) 发布。上游 dtk 项目拥有自己的许可证，本插件仅通过 HTTP API 调用它，不包含其服务端代码。
