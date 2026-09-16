import { Context, Schema } from 'koishi';
export declare const name = "douyin-analytics";
export declare const usage = "\n## \u89E3\u6790\u7FA4\u804A\u4E2D\u7684\u6296\u97F3\u94FE\u63A5\n\n\u53D1\u9001\u5305\u542B\u6296\u97F3\u94FE\u63A5\u7684\u6D88\u606F\u5373\u53EF\u89E6\u53D1\u89E3\u6790\u3002\u63D2\u4EF6\u4F7F\u7528 dtk \u7684 \"/api/v1/parse\" \u63A5\u53E3\uFF0C\n\u652F\u6301\u5F02\u6B65\u4EFB\u52A1\u8F6E\u8BE2\u3001\u89C6\u9891\u548C\u56FE\u96C6\uFF0C\u5E76\u5728\u4E0B\u8F7D\u5A92\u4F53\u540E\u53D1\u9001\u3002\n\n\u9700\u8981\u90E8\u7F72\u540E\u7AEF [Douyin TikTok Download API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)\u3002\n";
export interface Config {
    apiHost: string;
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
    apiKey: Schema<string, string>;
    maxDuration: Schema<number, number>;
    forward: Schema<boolean, boolean>;
    waitSeconds: Schema<number, number>;
    pollInterval: Schema<number, number>;
    pollTimeout: Schema<number, number>;
    downloadTimeout: Schema<number, number>;
}>, Schemastery.ObjectT<{
    apiHost: Schema<string, string>;
    apiKey: Schema<string, string>;
    maxDuration: Schema<number, number>;
    forward: Schema<boolean, boolean>;
    waitSeconds: Schema<number, number>;
    pollInterval: Schema<number, number>;
    pollTimeout: Schema<number, number>;
    downloadTimeout: Schema<number, number>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
