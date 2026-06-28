#!/usr/bin/env node
import "./node-input.js";
import type { CiPolicyPreset } from "./ci.js";
import type { ReportDetailLevel } from "./report.js";
import type { DiagnosticSeverity } from "./types.js";
type OutputFormat = "text" | "json";
interface WritableLike {
    write(chunk: string): unknown;
}
interface CliIo {
    stdout: WritableLike;
    stderr: WritableLike;
}
interface CliArgs {
    target: string | undefined;
    help: boolean;
    format: OutputFormat;
    output: string | undefined;
    sourceId: string | undefined;
    sitemapLocation: string | undefined;
    gzip: boolean | undefined;
    detail: ReportDetailLevel;
    maxGroups: number;
    maxExamplesPerGroup: number;
    maxPrintedDiagnostics: number;
    policy: CiPolicyPreset;
    failOn: readonly DiagnosticSeverity[] | undefined;
    failOnRules: string[];
    allowRules: string[];
    maxWarnings: number | undefined;
    localSitemapRoot: string | undefined;
    publicUrlPrefix: string | undefined;
    maxDepth: number;
    maxSources: number;
    loaderConcurrency: number;
    hreflangGraph: boolean;
}
export declare class CliUsageError extends Error {
    constructor(message: string);
}
export declare function runCli(argv?: readonly string[], io?: CliIo): Promise<number>;
export declare function parseCliArgs(argv: readonly string[]): CliArgs;
export {};
