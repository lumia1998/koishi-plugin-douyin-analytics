import { Context, Schema } from 'koishi';
export declare const name = "douyin-analytics";
export declare const usage = "\n## \u89E3\u6790\u7FA4\u804A\u4E2D\u7684\u6296\u97F3\u94FE\u63A5\n\n\u53D1\u9001\u5305\u542B\u6296\u97F3\u94FE\u63A5\u7684\u6D88\u606F\u5373\u53EF\u89E6\u53D1\u89E3\u6790\u3002\u63D2\u4EF6\u9ED8\u8BA4\u4F7F\u7528 dtk V5\uFF0C\u652F\u6301\u5F02\u6B65\u4EFB\u52A1\u8F6E\u8BE2\u3001\u89C6\u9891\u548C\u56FE\u96C6\u3002\n\u8FDE\u63A5\u65E7\u7248 dtk \u670D\u52A1\u65F6\uFF0C\u5C06 API \u7248\u672C\u8BBE\u4E3A V4\u3002\n\n\u9700\u8981\u90E8\u7F72\u540E\u7AEF [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)\u3002\n";
export interface Config {
    apiHost: string;
    apiVersion?: 'v4' | 'v5';
    apiKey: string;
    maxDuration: number;
    forward: boolean;
    waitSeconds: number;
    pollInterval: number;
    pollTimeout: number;
    downloadTimeout: number;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    apiHost: Schema<string, string>;
    apiVersion: Schema<"v4" | "v5", "v4" | "v5">;
    apiKey: Schema<string, string>;
    maxDuration: Schema<number, number>;
    forward: Schema<boolean, boolean>;
    waitSeconds: Schema<number, number>;
    pollInterval: Schema<number, number>;
    pollTimeout: Schema<number, number>;
    downloadTimeout: Schema<number, number>;
}>, Schemastery.ObjectT<{
    apiHost: Schema<string, string>;
    apiVersion: Schema<"v4" | "v5", "v4" | "v5">;
    apiKey: Schema<string, string>;
    maxDuration: Schema<number, number>;
    forward: Schema<boolean, boolean>;
    waitSeconds: Schema<number, number>;
    pollInterval: Schema<number, number>;
    pollTimeout: Schema<number, number>;
    downloadTimeout: Schema<number, number>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
