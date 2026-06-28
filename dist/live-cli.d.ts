#!/usr/bin/env node
import "./node-input.js";
import type { CiPolicyPreset } from "./ci.js";
import type { ReportDetailLevel } from "./report.js";
import type { DiagnosticSeverity } from "./types.js";
declare const USER_AGENT_PRESETS: {
    readonly "googlebot-smartphone": {
        readonly requestUserAgent: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
        readonly robotsUserAgent: "Googlebot";
    };
    readonly googlebot: {
        readonly requestUserAgent: "Googlebot";
        readonly robotsUserAgent: "Googlebot";
    };
    readonly "googlebot-image": {
        readonly requestUserAgent: "Googlebot-Image";
        readonly robotsUserAgent: "Googlebot-Image";
    };
    readonly "googlebot-news": {
        readonly requestUserAgent: "Googlebot-News";
        readonly robotsUserAgent: "Googlebot-News";
    };
    readonly "googlebot-video": {
        readonly requestUserAgent: "Googlebot-Video";
        readonly robotsUserAgent: "Googlebot-Video";
    };
};
type OutputFormat = "text" | "json";
type AuditFailOn = "none" | "error" | "warning";
type StatusMethod = "head" | "get";
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ResolveHostLike = (hostname: string) => Promise<readonly {
    address: string;
    family: number;
}[]>;
interface WritableLike {
    write(chunk: string): unknown;
}
interface CliIo {
    stdout: WritableLike;
    stderr: WritableLike;
}
interface LiveCliDependencies {
    fetch?: FetchLike | undefined;
    resolveHost?: ResolveHostLike | undefined;
}
interface LiveCliArgs {
    target: string | undefined;
    urlsFile: string | undefined;
    sourceId: string | undefined;
    sitemapLocation: string | undefined;
    gzip: boolean | undefined;
    localSitemapRoot: string | undefined;
    publicUrlPrefix: string | undefined;
    saveUrls: string | undefined;
    saveUrlDetails: string | undefined;
    help: boolean;
    quiet: boolean;
    format: OutputFormat;
    output: string | undefined;
    detail: ReportDetailLevel;
    policy: CiPolicyPreset;
    failOn: readonly DiagnosticSeverity[] | undefined;
    failOnRules: string[];
    allowRules: string[];
    maxWarnings: number | undefined;
    maxDepth: number;
    maxSources: number;
    loaderConcurrency: number;
    auditConcurrency: number;
    timeoutMs: number;
    maxSitemapBytes: number;
    maxPageBytes: number;
    maxRobotsBytes: number;
    maxAuditUrls: number;
    maxAuditFindings: number;
    maxRedirects: number;
    userAgent: string;
    robotsUserAgent: string;
    userAgentPreset: keyof typeof USER_AGENT_PRESETS | undefined;
    auditFailOn: AuditFailOn;
    statusMethod: StatusMethod;
    allowPrivateHosts: boolean;
    checkDuplicates: boolean;
    checkRobots: boolean;
    checkStatus: boolean;
    checkCanonical: boolean;
    requireCanonical: boolean;
    checkNoindex: boolean;
}
export declare function runLiveCli(argv?: readonly string[], io?: CliIo, dependencies?: LiveCliDependencies): Promise<number>;
export declare function parseLiveCliArgs(argv: readonly string[]): LiveCliArgs;
export {};
