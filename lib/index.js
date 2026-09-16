var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  apply: () => apply,
  name: () => name,
  usage: () => usage
});
module.exports = __toCommonJS(index_exports);
var import_koishi = require("koishi");
const name = "douyin-analytics";
const usage = `
## \u89E3\u6790\u7FA4\u804A\u4E2D\u7684\u6296\u97F3\u94FE\u63A5

\u53D1\u9001\u5305\u542B\u6296\u97F3\u94FE\u63A5\u7684\u6D88\u606F\u5373\u53EF\u89E6\u53D1\u89E3\u6790\u3002\u63D2\u4EF6\u4F7F\u7528 dtk \u7684 "/api/v1/parse" \u63A5\u53E3\uFF0C
\u652F\u6301\u5F02\u6B65\u4EFB\u52A1\u8F6E\u8BE2\u3001\u89C6\u9891\u548C\u56FE\u96C6\uFF0C\u5E76\u5728\u4E0B\u8F7D\u5A92\u4F53\u540E\u53D1\u9001\u3002

\u9700\u8981\u90E8\u7F72\u540E\u7AEF [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)\u3002
`;
const Config = import_koishi.Schema.object({
  apiHost: import_koishi.Schema.string().default("").description("dtk API \u5730\u5740\uFF0C\u8BF7\u5148\u90E8\u7F72\u540E\u7AEF\u670D\u52A1"),
  apiKey: import_koishi.Schema.string().role("secret").default("").description("dtk API Key\uFF0C\u4E0D\u8981\u5199\u5165\u6E90\u7801"),
  maxDuration: import_koishi.Schema.number().min(0).default(90).description("\u5141\u8BB8\u53D1\u9001\u7684\u89C6\u9891\u6700\u5927\u957F\u5EA6\uFF08\u79D2\uFF09\uFF0C\u8D85\u51FA\u540E\u53EA\u53D1\u9001\u5C01\u9762"),
  forward: import_koishi.Schema.boolean().default(false).description("\u4EE5\u5408\u5E76\u6D88\u606F\u53D1\u9001\u89E3\u6790\u5185\u5BB9\uFF08\u4EC5\u652F\u6301 OneBot \u9002\u914D\u5668\uFF09"),
  waitSeconds: import_koishi.Schema.number().min(0).max(30).default(20).description("\u9996\u6B21\u8BF7\u6C42\u7B49\u5F85\u65F6\u95F4\uFF08\u79D2\uFF09\uFF0Cdtk \u6700\u5927\u4E3A 30 \u79D2"),
  pollInterval: import_koishi.Schema.number().min(0.2).max(10).default(1).description("\u5F02\u6B65\u4EFB\u52A1\u8F6E\u8BE2\u95F4\u9694\uFF08\u79D2\uFF09"),
  pollTimeout: import_koishi.Schema.number().min(5).max(600).default(180).description("\u5F02\u6B65\u4EFB\u52A1\u6700\u591A\u7B49\u5F85\u65F6\u95F4\uFF08\u79D2\uFF09"),
  downloadTimeout: import_koishi.Schema.number().min(10).max(600).default(180).description("\u89C6\u9891\u5A92\u4F53\u4E0B\u8F7D\u8D85\u65F6\u65F6\u95F4\uFF08\u79D2\uFF09")
});
class DtkApiError extends Error {
  constructor(message, code, requestId) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.name = "DtkApiError";
  }
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function cleanUrl(value) {
  return value.replace(/[)\]}>，。！？；：,.!?]+$/u, "");
}
function extractDouyinUrl(content) {
  const candidates = content.match(/https?:\/\/[^\s]+/gi) || [];
  for (const candidate of candidates) {
    const url = cleanUrl(candidate);
    if (!isHttpUrl(url)) continue;
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "douyin.com" || hostname.endsWith(".douyin.com")) return url;
  }
}
function firstUrl(value, depth = 0) {
  if (depth > 4) return;
  if (isHttpUrl(value)) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item, depth + 1);
      if (url) return url;
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const key of ["url", "src", "download_url", "uri"]) {
    const url = firstUrl(value[key], depth + 1);
    if (url) return url;
  }
  for (const key of ["urls", "url_list"]) {
    const url = firstUrl(value[key], depth + 1);
    if (url) return url;
  }
}
function collectUrls(value, result = [], depth = 0) {
  if (depth > 4 || result.length >= 30) return result;
  if (isHttpUrl(value)) {
    const url = value.trim();
    if (!result.includes(url)) result.push(url);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, result, depth + 1);
    return result;
  }
  if (!isRecord(value)) return result;
  for (const key of ["url", "src", "download_url", "uri", "urls", "url_list"]) {
    collectUrls(value[key], result, depth + 1);
  }
  return result;
}
function formatError(error) {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
function responseError(stage, response) {
  const body = isRecord(response.error) ? response.error : {};
  const code = typeof body.code === "string" ? body.code : void 0;
  const message = typeof body.message === "string" ? body.message : "\u63A5\u53E3\u8FD4\u56DE\u5931\u8D25";
  const requestId = isRecord(response.meta) && typeof response.meta.request_id === "string" ? response.meta.request_id : void 0;
  const suffix = requestId ? ` request_id=${requestId}` : "";
  return new DtkApiError(`${stage}: ${code ? `${code} ` : ""}${message}${suffix}`, code, requestId);
}
function isParsedData(value) {
  return isRecord(value) && (isRecord(value.media) || typeof value.kind === "string");
}
function isParseTask(value) {
  return isRecord(value) && typeof value.task_id === "string" && value.task_id.length > 0;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function apply(ctx, config) {
  const logger = ctx.logger(name);
  const baseUrl = config.apiHost.replace(/\/+$/, "");
  if (!baseUrl) logger.warn("\u672A\u914D\u7F6E dtk API \u5730\u5740\uFF0C\u6296\u97F3\u94FE\u63A5\u89E3\u6790\u5C06\u65E0\u6CD5\u4F7F\u7528");
  if (!config.apiKey) logger.warn("\u672A\u914D\u7F6E dtk API Key\uFF0C\u6296\u97F3\u94FE\u63A5\u89E3\u6790\u5C06\u65E0\u6CD5\u901A\u8FC7\u8BA4\u8BC1");
  function apiUrl(path) {
    return baseUrl + path;
  }
  function httpOptions(timeout) {
    return {
      headers: {
        Accept: "application/json",
        ...config.apiKey ? { "X-API-Key": config.apiKey } : {}
      },
      timeout
    };
  }
  async function waitForTask(taskId) {
    const deadline = Date.now() + config.pollTimeout * 1e3;
    let lastState = "";
    while (Date.now() < deadline) {
      const response = await ctx.http.get(
        apiUrl(`/api/v1/tasks/${encodeURIComponent(taskId)}?lang=zh`),
        httpOptions(15e3)
      );
      if (!response || !response.success) {
        throw response ? responseError("\u67E5\u8BE2\u89E3\u6790\u4EFB\u52A1\u5931\u8D25", response) : new Error("\u67E5\u8BE2\u89E3\u6790\u4EFB\u52A1\u6CA1\u6709\u8FD4\u56DE\u54CD\u5E94");
      }
      const task = response.data;
      if (!isParseTask(task)) throw new Error("\u4EFB\u52A1\u54CD\u5E94\u7F3A\u5C11 task_id");
      const state = String(task.state || task.status || "").toLowerCase();
      if (state !== lastState) {
        logger.info(`\u89E3\u6790\u4EFB\u52A1 ${taskId} \u72B6\u6001\uFF1A${state || "unknown"}`);
        lastState = state;
      }
      if (state === "done" || state === "success" || state === "succeeded") {
        if (isParsedData(task.data)) return task.data;
        throw new Error(`\u89E3\u6790\u4EFB\u52A1 ${taskId} \u5DF2\u5B8C\u6210\uFF0C\u4F46\u6CA1\u6709\u8FD4\u56DE\u5185\u5BB9`);
      }
      if (state === "failed" || state === "error" || state === "cancelled" || state === "canceled") {
        const detail = isRecord(task.error) && typeof task.error.message === "string" ? task.error.message : `\u4EFB\u52A1\u72B6\u6001\u4E3A ${state}`;
        throw new DtkApiError(`\u89E3\u6790\u4EFB\u52A1\u5931\u8D25\uFF1A${detail}`, task.error?.code);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(config.pollInterval * 1e3, remaining));
    }
    throw new Error(`\u89E3\u6790\u4EFB\u52A1\u8D85\u8FC7 ${config.pollTimeout} \u79D2\u4ECD\u672A\u5B8C\u6210`);
  }
  async function parseContent(input) {
    if (!baseUrl) throw new Error("\u672A\u914D\u7F6E dtk API \u5730\u5740");
    const wait = Math.max(0, Math.min(30, config.waitSeconds));
    const response = await ctx.http.post(
      `${apiUrl("/api/v1/parse")}?wait=${wait}&lang=zh`,
      { url: input, include_raw: false },
      httpOptions(Math.max(15e3, (wait + 10) * 1e3))
    );
    if (!response || !response.success) {
      throw response ? responseError("\u63D0\u4EA4\u89E3\u6790\u4EFB\u52A1\u5931\u8D25", response) : new Error("\u89E3\u6790\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u54CD\u5E94");
    }
    if (isParsedData(response.data)) return response.data;
    if (isParseTask(response.data)) return waitForTask(response.data.task_id);
    throw new Error("\u89E3\u6790\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684 data");
  }
  async function downloadVideo(url) {
    const video = await ctx.http.get(url, {
      headers: {
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1",
        Referer: "https://www.douyin.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
      },
      responseType: "arraybuffer",
      timeout: config.downloadTimeout * 1e3
    });
    if (!video || video.byteLength === 0) throw new Error("\u89C6\u9891\u4E0B\u8F7D\u7ED3\u679C\u4E3A\u7A7A");
    return video;
  }
  ctx.middleware(async (session, next) => {
    const content = session.content || "";
    if (!content.toLowerCase().includes("douyin.com")) return next();
    const url = extractDouyinUrl(content);
    if (!url) return next();
    try {
      const data = await parseContent(url);
      const media = isRecord(data.media) ? data.media : {};
      const imageUrls = collectUrls(media.images);
      const videoUrl = firstUrl(media.video);
      const coverUrl = firstUrl(media.covers);
      const durationMs = Number(data.duration_ms);
      const duration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : void 0;
      const title = data.description || data.title || "\u672A\u63D0\u4F9B\u63CF\u8FF0";
      const parts = [`\u6296\u97F3\u89E3\u6790\uFF1A
${title}`];
      if (imageUrls.length > 0) {
        for (const imageUrl of imageUrls) parts.push((0, import_koishi.h)("img", { src: imageUrl }));
      } else if (duration !== void 0 && duration > config.maxDuration * 1e3) {
        parts.push("\u89C6\u9891\u8FC7\u957F~ \u8BF7\u6253\u5F00\u6296\u97F3\u5BA2\u6237\u7AEF\u67E5\u770B");
        if (coverUrl) parts.push((0, import_koishi.h)("img", { src: coverUrl }));
      } else if (videoUrl) {
        const video = await downloadVideo(videoUrl);
        parts.push(import_koishi.h.video(video, "video/mp4"));
      } else if (coverUrl) {
        parts.push("\u63A5\u53E3\u672A\u8FD4\u56DE\u53EF\u7528\u89C6\u9891\uFF0C\u4EE5\u4E0B\u53D1\u9001\u5C01\u9762\u9884\u89C8");
        parts.push((0, import_koishi.h)("img", { src: coverUrl }));
      } else {
        throw new Error(`\u63A5\u53E3\u672A\u8FD4\u56DE\u53EF\u7528\u5A92\u4F53\uFF0Ckind=${data.kind || "unknown"}`);
      }
      if (config.forward && session.platform === "onebot") {
        await session.send((0, import_koishi.h)("message", {
          forward: true,
          children: parts.map((part) => (0, import_koishi.h)("message", part))
        }));
      } else if (imageUrls.length > 3) {
        await session.send(parts[0]);
        await session.send((0, import_koishi.h)("message", { forward: true, children: parts.slice(1) }));
      } else {
        for (const part of parts) await session.send(part);
      }
    } catch (error) {
      logger.error(`\u5904\u7406\u6296\u97F3\u94FE\u63A5\u5931\u8D25\uFF08${url}\uFF09\uFF1A${formatError(error)}`);
      return "\u6296\u97F3\u89E3\u6790\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  name,
  usage
});
