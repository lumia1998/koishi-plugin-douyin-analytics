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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  apply: () => apply,
  name: () => name,
  usage: () => usage
});
module.exports = __toCommonJS(index_exports);
var import_koishi = require("koishi");

// src/api.ts
var import_promises = require("node:timers/promises");
var retryableCodes = /* @__PURE__ */ new Set([
  "RATE_LIMITED",
  "QUEUE_FULL",
  "IDENTITY_POOL_EXHAUSTED",
  "ENDPOINT_CIRCUIT_OPEN",
  "UPSTREAM_RISK_CONTROL",
  "SIGNING_FAILED",
  "INTERNAL",
  "DOWNLOADER_UNAVAILABLE"
]);
var DtkApiError = class extends Error {
  constructor(failure) {
    const { code, message, requestId } = failure;
    super(`${code}\uFF1A${message}${requestId ? ` (request_id=${requestId})` : ""}`);
    this.failure = failure;
    this.name = "DtkApiError";
  }
};
var DtkTaskError = class extends DtkApiError {
};
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseEnvelope(text) {
  try {
    const value = JSON.parse(text);
    if (isRecord(value)) return value;
  } catch {
  }
  return {};
}
function nonNegativeNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return void 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
function apiFailure(error, requestId, status = 0, headers) {
  const data = isRecord(error) ? error : {};
  const defaultCode = status === 429 ? "RATE_LIMITED" : status >= 400 ? `HTTP_${status}` : "PARSE_FAILED";
  const code = typeof data.code === "string" ? data.code : defaultCode;
  const message = typeof data.message === "string" ? data.message : "dtk \u8BF7\u6C42\u6216\u4EFB\u52A1\u5931\u8D25";
  const retryAfter = headers?.get("Retry-After");
  const headerDelay = retryAfter ? nonNegativeNumber(retryAfter) ?? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1e3) : 0;
  return {
    code,
    message,
    requestId,
    retryable: data.retryable !== false && (status === 429 || data.retryable === true || retryableCodes.has(code)),
    retryAfter: Math.max(nonNegativeNumber(data.retry_after) ?? 0, headerDelay || 0) * 1e3
  };
}
function describeError(error, key) {
  const message = error instanceof Error ? error.message : String(error);
  return (key ? message.split(key).join("[\u5DF2\u9690\u85CF]") : message).replace(/dtk_[a-z0-9_-]+/gi, "[\u5DF2\u9690\u85CF]").replace(/https?:\/\/[^\s<>"']+/gi, "[\u94FE\u63A5\u5DF2\u9690\u85CF]");
}
function hasContent(value) {
  return isRecord(value) && (isRecord(value.media) || typeof value.kind === "string");
}
function remaining(deadline) {
  const timeout = deadline - Date.now();
  if (timeout <= 0) throw new Error("dtk \u89E3\u6790\u4EFB\u52A1\u7B49\u5F85\u8D85\u65F6");
  return timeout;
}
var DouyinApi = class {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.baseUrl = config.apiHost.trim().replace(/\/+$/, "");
    this.logger = ctx.logger("douyin-analytics");
    ctx.on("dispose", () => this.controller.abort());
  }
  controller = new AbortController();
  logger;
  rateResumeAt = 0;
  baseUrl;
  get disposed() {
    return this.controller.signal.aborted;
  }
  async parse(url) {
    if (!this.baseUrl) throw new Error("\u672A\u914D\u7F6E dtk API \u5730\u5740");
    const wait = Math.max(0, Math.min(30, this.config.waitSeconds));
    const timeout = Math.max(15e3, (wait + 10) * 1e3);
    let response = await this.submit(url, wait, Date.now() + timeout, timeout);
    const deadline = Date.now() + this.config.pollTimeout * 1e3;
    let refreshedExpired = false;
    for (let attempt = 0; ; attempt++) {
      const taskId = response.data.task_id;
      if (hasContent(response.data) && !taskId) return response.data;
      if (typeof taskId !== "string" || !taskId) throw new Error("dtk \u6CA1\u6709\u8FD4\u56DE\u89E3\u6790\u5185\u5BB9\u6216\u4EFB\u52A1 ID");
      try {
        return await this.collect(response, taskId, deadline);
      } catch (error) {
        if (!(error instanceof DtkApiError) || attempt >= 2) throw error;
        if (error.failure.code === "TASK_NOT_FOUND" && !refreshedExpired) {
          refreshedExpired = true;
          this.logger.info("dtk \u89E3\u6790\u4EFB\u52A1\u5DF2\u8FC7\u671F\uFF0C\u91CD\u65B0\u63D0\u4EA4");
        } else {
          if (!(error instanceof DtkTaskError) || !error.failure.retryable || error.failure.code === "TASK_NOT_FOUND") throw error;
          await this.backoff(error, attempt, deadline);
        }
      }
      response = await this.submit(url, 0, deadline, 15e3, true);
    }
  }
  submit(url, wait, deadline, timeout, refresh = false) {
    const path = `/api/v1/parse?wait=${wait}&lang=zh${refresh ? "&refresh=true" : ""}`;
    return this.request(path, deadline, timeout, { url, include_raw: false });
  }
  async collect(response, taskId, deadline) {
    const path = `/api/v1/tasks/${encodeURIComponent(taskId)}?lang=zh`;
    const initialDelay = this.config.pollInterval * 1e3;
    let delay = initialDelay;
    let lastState = "";
    for (let submitted = true; ; submitted = false) {
      const task = response.data;
      if (task.task_id !== taskId) throw new Error("dtk \u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u4EFB\u52A1 ID");
      const state = String(task.state || task.status || "").toLowerCase();
      if (state !== lastState) {
        this.logger.debug("dtk \u89E3\u6790\u4EFB\u52A1\u72B6\u6001 %s", describeError(state, this.config.apiKey));
        lastState = state;
      }
      const done = ["done", "success", "succeeded"].includes(state);
      const failed = ["failed", "error"].includes(state);
      if (done && hasContent(task.data)) return task.data;
      if (done && !submitted) throw new Error("dtk \u5DF2\u5B8C\u6210\u4EFB\u52A1\u6CA1\u6709\u8FD4\u56DE\u89E3\u6790\u5185\u5BB9");
      if (failed && (isRecord(task.error) || !submitted)) {
        throw new DtkTaskError(apiFailure(task.error, response.requestId));
      }
      if (["cancelled", "canceled"].includes(state)) throw new Error("dtk \u89E3\u6790\u4EFB\u52A1\u5DF2\u53D6\u6D88");
      if (!submitted) {
        await (0, import_promises.setTimeout)(Math.min(delay, remaining(deadline)), void 0, { signal: this.controller.signal });
        delay = Math.min(delay * 2, Math.max(initialDelay, 5e3));
      }
      response = await this.request(path, deadline, 15e3);
    }
  }
  async withRequestSignal(request) {
    const signal = this.controller.signal;
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await request(controller.signal);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async request(path, deadline, timeout, body) {
    for (let attempt = 0; ; attempt++) {
      const rateDelay = this.rateResumeAt - Date.now();
      if (rateDelay > 0) {
        if (rateDelay >= remaining(deadline)) throw new Error("dtk \u9650\u6D41\u7B49\u5F85\u65F6\u95F4\u8D85\u8FC7\u89E3\u6790\u8D85\u65F6\u8BBE\u7F6E");
        await (0, import_promises.setTimeout)(rateDelay, void 0, { signal: this.controller.signal });
      }
      const response = await this.withRequestSignal((signal) => this.ctx.http(`${this.baseUrl}${path}`, {
        method: body ? "POST" : "GET",
        data: body,
        headers: {
          Accept: "application/json",
          ...this.config.apiKey ? { "X-API-Key": this.config.apiKey } : {}
        },
        timeout: Math.min(timeout, remaining(deadline)),
        signal,
        validateStatus: () => true,
        responseType: "text"
      }));
      const envelope = parseEnvelope(response.data);
      const meta = isRecord(envelope.meta) ? envelope.meta : {};
      const requestId = response.headers.get("X-Request-ID") || (typeof meta.request_id === "string" ? meta.request_id : void 0);
      const rateReset = Number(response.headers.get("X-RateLimit-Reset")) * 1e3;
      if (response.headers.get("X-RateLimit-Remaining") === "0" && Number.isFinite(rateReset)) {
        this.rateResumeAt = Math.max(this.rateResumeAt, rateReset);
      }
      if (response.status < 400 && envelope.success === true && isRecord(envelope.data)) {
        return { data: envelope.data, requestId };
      }
      if (response.status < 400 && envelope.success !== false) {
        throw new Error(`dtk \u8FD4\u56DE\u65E0\u6548\u54CD\u5E94${requestId ? ` (request_id=${requestId})` : ""}`);
      }
      const failure = apiFailure(envelope.error, requestId, response.status, response.headers);
      const { code, retryable, retryAfter } = failure;
      if (response.status === 429 || code === "RATE_LIMITED") {
        this.rateResumeAt = Math.max(this.rateResumeAt, Date.now() + retryAfter);
      }
      const error = new DtkApiError(failure);
      if (!retryable || code === "TASK_NOT_FOUND" || attempt >= 2) throw error;
      await this.backoff(error, attempt, deadline);
    }
  }
  async backoff(error, attempt, deadline) {
    const wait = Math.max(error.failure.retryAfter, 2 ** attempt * 1e3, this.rateResumeAt - Date.now());
    if (wait >= remaining(deadline)) throw error;
    this.logger.warn("dtk \u5C06\u5728 %d \u6BEB\u79D2\u540E\u91CD\u8BD5\uFF1A%s", wait, describeError(error, this.config.apiKey));
    await (0, import_promises.setTimeout)(wait, void 0, { signal: this.controller.signal });
  }
  async download(urls) {
    const deadline = Date.now() + this.config.downloadTimeout * 1e3;
    for (const [index, url] of urls.entries()) {
      const budget = deadline - Date.now();
      if (budget <= 0) break;
      const hasBackup = index + 1 < urls.length;
      try {
        const video = await this.withRequestSignal((signal) => this.ctx.http.get(url, {
          headers: {
            Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1",
            Referer: "https://www.douyin.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
          },
          responseType: "arraybuffer",
          signal,
          timeout: hasBackup ? Math.min(6e4, Math.ceil(budget / 2)) : budget
        }));
        if (!video?.byteLength) throw new Error("\u89C6\u9891\u4E0B\u8F7D\u7ED3\u679C\u4E3A\u7A7A");
        return video;
      } catch (error) {
        if (this.disposed) throw error;
        this.logger.debug("\u89C6\u9891\u5730\u5740 %d \u4E0B\u8F7D\u5931\u8D25\uFF1A%s", index + 1, describeError(error, this.config.apiKey));
        if (hasBackup) this.logger.info("\u89C6\u9891\u4E0B\u8F7D\u5931\u8D25\uFF0C\u5C1D\u8BD5\u5907\u7528\u5730\u5740");
      }
    }
    throw new Error("\u6240\u6709\u89C6\u9891\u4E0B\u8F7D\u5730\u5740\u5747\u5931\u8D25\u6216\u5DF2\u8D85\u65F6");
  }
};

// src/index.ts
var name = "douyin-analytics";
var usage = `
## \u89E3\u6790\u7FA4\u804A\u4E2D\u7684\u6296\u97F3\u94FE\u63A5

\u53D1\u9001\u5305\u542B\u6296\u97F3\u94FE\u63A5\u7684\u6D88\u606F\u5373\u53EF\u89E6\u53D1\u89E3\u6790\u3002\u63D2\u4EF6\u4F7F\u7528 dtk \u7684 "/api/v1/parse" \u63A5\u53E3\uFF0C
\u652F\u6301\u5F02\u6B65\u4EFB\u52A1\u8F6E\u8BE2\u3001\u89C6\u9891\u548C\u56FE\u96C6\uFF0C\u5E76\u5728\u4E0B\u8F7D\u5A92\u4F53\u540E\u53D1\u9001\u3002

\u9700\u8981\u90E8\u7F72\u540E\u7AEF [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)\u3002
`;
var Config = import_koishi.Schema.object({
  apiHost: import_koishi.Schema.string().default("").description("dtk API \u5730\u5740\uFF0C\u8BF7\u5148\u90E8\u7F72\u540E\u7AEF\u670D\u52A1"),
  apiKey: import_koishi.Schema.string().role("secret").default("").description("dtk API Key\uFF0C\u4E0D\u8981\u5199\u5165\u6E90\u7801"),
  maxDuration: import_koishi.Schema.number().min(0).default(90).description("\u89C6\u9891\u65F6\u957F\u4E0A\u9650\uFF08\u79D2\uFF09\uFF0C\u8D85\u51FA\u3001\u65F6\u957F\u672A\u77E5\u6216\u8BBE\u4E3A 0 \u65F6\u4EC5\u53D1\u9001\u9884\u89C8"),
  forward: import_koishi.Schema.boolean().default(false).description("\u4EE5\u5408\u5E76\u6D88\u606F\u53D1\u9001\u89E3\u6790\u5185\u5BB9\uFF08\u4EC5\u652F\u6301 OneBot \u9002\u914D\u5668\uFF09"),
  waitSeconds: import_koishi.Schema.number().min(0).max(30).default(20).description("\u9996\u6B21\u8BF7\u6C42\u7B49\u5F85\u65F6\u95F4\uFF08\u79D2\uFF09\uFF0Cdtk \u6700\u5927\u4E3A 30 \u79D2"),
  pollInterval: import_koishi.Schema.number().min(0.2).max(10).default(1).description("\u5F02\u6B65\u4EFB\u52A1\u8F6E\u8BE2\u521D\u59CB\u95F4\u9694\uFF08\u79D2\uFF09"),
  pollTimeout: import_koishi.Schema.number().min(5).max(600).default(180).description("\u5F02\u6B65\u4EFB\u52A1\u6700\u591A\u7B49\u5F85\u65F6\u95F4\uFF08\u79D2\uFF09"),
  downloadTimeout: import_koishi.Schema.number().min(10).max(600).default(180).description("\u89C6\u9891\u4E0B\u8F7D\u53CA\u5907\u7528\u5730\u5740\u7684\u603B\u8D85\u65F6\u65F6\u95F4\uFF08\u79D2\uFF09")
});
var shareDomains = ["douyin.com", "iesdouyin.com", "amemv.com"];
var mediaUrlFields = ["url", "src", "download_url", "uri", "urls", "url_list"];
function httpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url;
  } catch {
  }
}
function extractDouyinUrl(content) {
  const candidates = content.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const candidate of candidates) {
    const value = candidate.replace(/&amp;/gi, "&").replace(/[)\]}>，。！？；：,.!?]+$/u, "");
    const url = httpUrl(value);
    if (url && shareDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
      return value;
    }
  }
}
function collectUrls(value, limit = 30, result = /* @__PURE__ */ new Set(), depth = 0) {
  if (depth > 4 || result.size >= limit) return result;
  if (typeof value === "string") {
    const url = value.trim();
    if (httpUrl(url)) result.add(url);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, limit, result, depth + 1);
      if (result.size >= limit) break;
    }
  } else if (isRecord(value)) {
    for (const key of mediaUrlFields) {
      collectUrls(value[key], limit, result, depth + 1);
      if (result.size >= limit) break;
    }
  }
  return result;
}
function firstUrl(value) {
  return collectUrls(value, 1).values().next().value;
}
function albumImageUrls(images) {
  const selected = /* @__PURE__ */ new Map();
  for (const image of Array.isArray(images) ? images : [images]) {
    const value = firstUrl(image);
    if (!value) continue;
    const url = new URL(value);
    const object = /(?:^|\.)(?:douyinpic\.com|byteimg\.com|ibyteimg\.com|pstatp\.com)$/.test(url.hostname) && /^\/(tos-[\w-]+\/[\w-]+)(?:~tplv-[^/]+|\.(?:jpeg|jpg|png|webp|heic|gif))?$/i.exec(url.pathname)?.[1];
    const key = object ? `tos:${object}` : value;
    if (!selected.has(key)) selected.set(key, value);
    if (selected.size >= 30) break;
  }
  return [...selected.values()];
}
function apply(ctx, config) {
  const logger = ctx.logger(name);
  const api = new DouyinApi(ctx, config);
  if (!api.baseUrl) logger.warn("\u672A\u914D\u7F6E dtk API \u5730\u5740\uFF0C\u6296\u97F3\u94FE\u63A5\u89E3\u6790\u5C06\u65E0\u6CD5\u4F7F\u7528");
  if (!config.apiKey) logger.warn("\u672A\u914D\u7F6E dtk API Key\uFF0C\u6296\u97F3\u94FE\u63A5\u89E3\u6790\u5C06\u65E0\u6CD5\u901A\u8FC7\u8BA4\u8BC1");
  ctx.middleware(async (session, next) => {
    const url = extractDouyinUrl(session.content || "");
    if (!url) return next();
    try {
      const data = await api.parse(url);
      if (data.platform && data.platform !== "douyin") throw new Error("\u63A5\u53E3\u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u5C5E\u4E8E\u6296\u97F3");
      const media = isRecord(data.media) ? data.media : {};
      const imageUrls = albumImageUrls(media.images);
      const title = data.description || data.title || "\u672A\u63D0\u4F9B\u63CF\u8FF0";
      const parts = [`\u6296\u97F3\u89E3\u6790\uFF1A
${title}`];
      if (imageUrls.length) {
        for (const imageUrl of imageUrls) parts.push((0, import_koishi.h)("img", { src: imageUrl }));
      } else {
        const cover = firstUrl(media.covers);
        const videoUrls = [...collectUrls([media.video, media.streams])];
        const rawDuration = data.duration_ms;
        const duration = typeof rawDuration === "number" || typeof rawDuration === "string" ? Number(rawDuration) : NaN;
        let preview;
        if (!videoUrls.length) {
          if (!cover) throw new Error("\u63A5\u53E3\u672A\u8FD4\u56DE\u53EF\u7528\u5A92\u4F53");
          preview = "\u63A5\u53E3\u672A\u8FD4\u56DE\u53EF\u7528\u89C6\u9891\uFF0C\u4EE5\u4E0B\u53D1\u9001\u5C01\u9762\u9884\u89C8";
        } else if (config.maxDuration === 0) {
          preview = "\u5F53\u524D\u4EC5\u53D1\u9001\u89C6\u9891\u9884\u89C8";
        } else if (!Number.isFinite(duration) || duration <= 0) {
          preview = "\u65E0\u6CD5\u786E\u8BA4\u89C6\u9891\u65F6\u957F~ \u8BF7\u6253\u5F00\u6296\u97F3\u5BA2\u6237\u7AEF\u67E5\u770B";
        } else if (duration > config.maxDuration * 1e3) {
          preview = "\u89C6\u9891\u8FC7\u957F~ \u8BF7\u6253\u5F00\u6296\u97F3\u5BA2\u6237\u7AEF\u67E5\u770B";
        } else {
          const video = await api.download(videoUrls);
          parts.push(import_koishi.h.video(video, "video/mp4"));
        }
        if (preview) {
          parts.push(preview);
          if (cover) parts.push((0, import_koishi.h)("img", { src: cover }));
        }
      }
      if (api.disposed) return;
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
      if (api.disposed) return;
      logger.error("\u5904\u7406\u6296\u97F3\u94FE\u63A5\u5931\u8D25\uFF1A%s", describeError(error, config.apiKey));
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
