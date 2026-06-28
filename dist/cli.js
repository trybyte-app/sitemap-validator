#!/usr/bin/env node
import "./node-input.js";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveCiPolicy } from "./ci.js";
import { createLocalSitemapLoader } from "./loaders.js";
import { countDiagnostics, createDiagnosticSummaryBuilder } from "./report.js";
import { validateSitemapSetEvents } from "./set.js";
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_SOURCES = 10_000;
const DEFAULT_LOADER_CONCURRENCY = 4;
const DEFAULT_MAX_PRINTED_DIAGNOSTICS = 100;
const DEFAULT_MAX_GROUPS = 50;
const DEFAULT_MAX_EXAMPLES_PER_GROUP = 3;
const CI_POLICY_PRESET_CHOICES = ["ciDefault", "strict", "protocolOnly", "googleCompatible"];
const DETAIL_CHOICES = ["summary", "grouped", "full"];
const FORMAT_CHOICES = ["text", "json"];
export class CliUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "CliUsageError";
    }
}
export async function runCli(argv = process.argv.slice(2), io = {
    stdout: process.stdout,
    stderr: process.stderr,
}) {
    try {
        const args = parseCliArgs(argv);
        if (args.help) {
            writeUsage(io.stdout);
            return 0;
        }
        if (!args.target) {
            writeUsage(io.stderr);
            return 2;
        }
        const report = await validateFromCliArgs(args);
        const output = args.format === "json"
            ? `${JSON.stringify(createJsonCliReport(report, args), null, 2)}\n`
            : formatTextReport(report, args);
        if (args.output) {
            await writeFile(args.output, output);
        }
        else {
            io.stdout.write(output);
        }
        return report.evaluation.exitCode;
    }
    catch (error) {
        io.stderr.write(`${toErrorMessage(error)}\n`);
        if (error instanceof CliUsageError) {
            io.stderr.write("\n");
            writeUsage(io.stderr);
            return 2;
        }
        return 1;
    }
}
export function parseCliArgs(argv) {
    const args = defaultCliArgs();
    for (let index = 0; index < argv.length; index += 1) {
        const rawValue = argv[index];
        if (!rawValue) {
            continue;
        }
        if (!rawValue.startsWith("-") || rawValue === "-") {
            if (args.target) {
                throw new CliUsageError(`Unexpected positional argument: ${rawValue}`);
            }
            args.target = rawValue;
            continue;
        }
        const { flag, inlineValue } = splitFlag(rawValue);
        switch (flag) {
            case "--help":
            case "-h":
                rejectInlineValue(flag, inlineValue);
                args.help = true;
                break;
            case "--json":
                rejectInlineValue(flag, inlineValue);
                args.format = "json";
                break;
            case "--text":
                rejectInlineValue(flag, inlineValue);
                args.format = "text";
                break;
            case "--format": {
                const parsed = requireChoice(argv, index, flag, FORMAT_CHOICES, inlineValue);
                args.format = parsed.value;
                index = parsed.index;
                break;
            }
            case "--output": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.output = parsed.value;
                index = parsed.index;
                break;
            }
            case "--source-id": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.sourceId = parsed.value;
                index = parsed.index;
                break;
            }
            case "--sitemap-location": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.sitemapLocation = parsed.value;
                index = parsed.index;
                break;
            }
            case "--local-sitemap-root": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.localSitemapRoot = parsed.value;
                index = parsed.index;
                break;
            }
            case "--public-url-prefix": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.publicUrlPrefix = parsed.value;
                index = parsed.index;
                break;
            }
            case "--gzip":
                rejectInlineValue(flag, inlineValue);
                args.gzip = true;
                break;
            case "--no-gzip":
                rejectInlineValue(flag, inlineValue);
                args.gzip = false;
                break;
            case "--hreflang-graph":
                rejectInlineValue(flag, inlineValue);
                args.hreflangGraph = true;
                break;
            case "--no-hreflang-graph":
                rejectInlineValue(flag, inlineValue);
                args.hreflangGraph = false;
                break;
            case "--max-depth": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.maxDepth = parsed.value;
                index = parsed.index;
                break;
            }
            case "--max-sources": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.maxSources = parsed.value;
                index = parsed.index;
                break;
            }
            case "--loader-concurrency": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.loaderConcurrency = parsed.value;
                index = parsed.index;
                break;
            }
            case "--detail": {
                const parsed = requireChoice(argv, index, flag, DETAIL_CHOICES, inlineValue);
                args.detail = parsed.value;
                index = parsed.index;
                break;
            }
            case "--max-groups": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.maxGroups = parsed.value;
                index = parsed.index;
                break;
            }
            case "--examples-per-group": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.maxExamplesPerGroup = parsed.value;
                index = parsed.index;
                break;
            }
            case "--max-diagnostics": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.maxPrintedDiagnostics = parsed.value;
                index = parsed.index;
                break;
            }
            case "--policy": {
                const parsed = requireChoice(argv, index, flag, CI_POLICY_PRESET_CHOICES, inlineValue);
                args.policy = parsed.value;
                index = parsed.index;
                break;
            }
            case "--fail-on": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.failOn = parseFailOn(parsed.value);
                index = parsed.index;
                break;
            }
            case "--fail-on-errors":
                rejectInlineValue(flag, inlineValue);
                args.failOn = ["error"];
                break;
            case "--fail-on-rule": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.failOnRules.push(...parseRuleList(parsed.value));
                index = parsed.index;
                break;
            }
            case "--allow-rule": {
                const parsed = requireValue(argv, index, flag, inlineValue);
                args.allowRules.push(...parseRuleList(parsed.value));
                index = parsed.index;
                break;
            }
            case "--max-warnings": {
                const parsed = requireNumber(argv, index, flag, inlineValue);
                args.maxWarnings = parsed.value;
                index = parsed.index;
                break;
            }
            default:
                throw new CliUsageError(`Unknown argument: ${rawValue}`);
        }
    }
    return args;
}
async function validateFromCliArgs(args) {
    const startedAt = performance.now();
    const target = args.target;
    if (!target) {
        throw new CliUsageError("Missing generated sitemap file path.");
    }
    const root = await resolveRootInput(target, args);
    const progress = createProgressSnapshot();
    const collectDiagnostics = args.detail === "full";
    const diagnostics = [];
    const diagnosticSummaryBuilder = createDiagnosticSummaryBuilder({
        maxGroups: args.maxGroups,
        maxExamplesPerGroup: args.detail === "summary" ? 0 : args.maxExamplesPerGroup,
    });
    const summaries = [];
    const cliPolicy = createCliPolicy(args);
    const policyState = createStreamingPolicyState(cliPolicy);
    let setSummary;
    for await (const event of validateSitemapSetEvents(root.input, {
        sourceId: root.sourceId,
        sitemapLocation: root.sitemapLocation,
        gzip: root.gzip,
        loader: root.loader,
        loaderConcurrency: args.loaderConcurrency,
        maxDepth: args.maxDepth,
        maxSources: args.maxSources,
        hreflangGraph: args.hreflangGraph,
    })) {
        updateProgress(progress, event);
        if (event.type === "diagnostic") {
            diagnosticSummaryBuilder.add(event.diagnostic);
            updatePolicyState(policyState, event.diagnostic);
            if (collectDiagnostics) {
                diagnostics.push(event.diagnostic);
            }
        }
        if (event.type === "source:finish") {
            summaries.push(event.summary);
        }
        if (event.type === "set:summary") {
            setSummary = event.summary;
        }
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    const diagnosticSummary = diagnosticSummaryBuilder.summary();
    const summary = setSummary ?? createFallbackSetSummary(summaries, diagnosticSummary.counts);
    const evaluation = finishPolicyEvaluation(policyState);
    return {
        target,
        validatedAt: new Date().toISOString(),
        elapsedMs,
        options: {
            sitemapLocation: root.sitemapLocation,
            localSitemapRoot: args.localSitemapRoot,
            publicUrlPrefix: args.publicUrlPrefix,
            childSitemapLoading: Boolean(root.loader),
            hreflangGraph: args.hreflangGraph,
            maxDepth: args.maxDepth,
            maxSources: args.maxSources,
            loaderConcurrency: args.loaderConcurrency,
            detail: args.detail,
        },
        policy: createPolicyReport(args, cliPolicy),
        evaluation,
        summary,
        progress,
        sourceSummaries: summaries,
        diagnosticCounts: collectDiagnostics ? countDiagnostics(diagnostics) : diagnosticSummary.counts,
        diagnosticSummary,
        diagnostics,
    };
}
function defaultCliArgs() {
    return {
        target: undefined,
        help: false,
        format: "text",
        output: undefined,
        sourceId: undefined,
        sitemapLocation: undefined,
        gzip: undefined,
        detail: "grouped",
        maxGroups: DEFAULT_MAX_GROUPS,
        maxExamplesPerGroup: DEFAULT_MAX_EXAMPLES_PER_GROUP,
        maxPrintedDiagnostics: DEFAULT_MAX_PRINTED_DIAGNOSTICS,
        policy: "ciDefault",
        failOn: undefined,
        failOnRules: [],
        allowRules: [],
        maxWarnings: undefined,
        localSitemapRoot: undefined,
        publicUrlPrefix: undefined,
        maxDepth: DEFAULT_MAX_DEPTH,
        maxSources: DEFAULT_MAX_SOURCES,
        loaderConcurrency: DEFAULT_LOADER_CONCURRENCY,
        hreflangGraph: false,
    };
}
function writeUsage(output) {
    output.write(`Validate generated XML sitemap files before deploy.

Usage:
  sitemap-validator <generated-file> [options]
  npx sitemap-validator <generated-file> [options]

Examples:
  sitemap-validator ./public/sitemap.xml --sitemap-location https://example.com/sitemap.xml
  sitemap-validator ./public/sitemap-index.xml --sitemap-location https://example.com/sitemap-index.xml --public-url-prefix https://example.com/ --local-sitemap-root ./public
  sitemap-validator ./public/sitemap.xml --policy strict --json --output sitemap-validation.json

Options:
  --json | --text                 Output format. Default: text.
  --format <text|json>            Output format.
  --output <path>                 Write report to a file.
  --policy <preset>               ciDefault, strict, protocolOnly, googleCompatible. Default: ciDefault.
  --fail-on <list|none>           Severity policy, e.g. error or error,warning.
  --fail-on-rule <code[,code]>    Fail when specific rule codes are present. Repeatable.
  --allow-rule <code[,code]>      Ignore specific rule codes for CI policy. Repeatable.
  --max-warnings <n>              Fail when policy-counted warnings exceed this value.
  --sitemap-location <url>        Future public URL of this generated sitemap.
  --public-url-prefix <url>       Public URL prefix used by child sitemap <loc> values.
  --local-sitemap-root <dir>      Local directory containing generated child sitemap files.
  --hreflang-graph                Validate set-level hreflang return links and alternate clusters.
  --max-depth <n>                 Sitemap index traversal depth. Default: ${DEFAULT_MAX_DEPTH}.
  --max-sources <n>               Max generated sitemap files to validate. Default: ${DEFAULT_MAX_SOURCES}.
  --loader-concurrency <n>        Child sitemap file load concurrency. Default: ${DEFAULT_LOADER_CONCURRENCY}.
  --source-id <value>             Override root source id.
  --gzip | --no-gzip              Override gzip detection.
  --detail <summary|grouped|full> Reporting detail. Default: grouped.
  --max-groups <n>                Max grouped diagnostics printed. Default: ${DEFAULT_MAX_GROUPS}.
  --examples-per-group <n>        Sample locations per diagnostic group. Default: ${DEFAULT_MAX_EXAMPLES_PER_GROUP}.
  --max-diagnostics <n>           Max diagnostics printed in full text mode. Default: ${DEFAULT_MAX_PRINTED_DIAGNOSTICS}.
  --help                          Show this help.

Pass generated files, not live sitemap URLs. Use --sitemap-location when you
want sitemap.org host and path-prefix rules checked against the future public URL.

`);
}
function splitFlag(rawValue) {
    const equalsIndex = rawValue.indexOf("=");
    if (equalsIndex < 0) {
        return {
            flag: rawValue,
            inlineValue: undefined,
        };
    }
    return {
        flag: rawValue.slice(0, equalsIndex),
        inlineValue: rawValue.slice(equalsIndex + 1),
    };
}
function rejectInlineValue(flag, inlineValue) {
    if (inlineValue !== undefined) {
        throw new CliUsageError(`${flag} does not accept a value.`);
    }
}
function requireValue(argv, index, flag, inlineValue) {
    if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
            throw new CliUsageError(`${flag} requires a value.`);
        }
        return {
            value: inlineValue,
            index,
        };
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
        throw new CliUsageError(`${flag} requires a value.`);
    }
    return {
        value: next,
        index: index + 1,
    };
}
function requireNumber(argv, index, flag, inlineValue) {
    const parsed = requireValue(argv, index, flag, inlineValue);
    const value = Number(parsed.value);
    if (!Number.isFinite(value) || value < 0) {
        throw new CliUsageError(`${flag} requires a non-negative number.`);
    }
    return {
        value: Math.floor(value),
        index: parsed.index,
    };
}
function requireChoice(argv, index, flag, choices, inlineValue) {
    const parsed = requireValue(argv, index, flag, inlineValue);
    if (!isChoice(parsed.value, choices)) {
        throw new CliUsageError(`${flag} must be one of: ${choices.join(", ")}.`);
    }
    return {
        value: parsed.value,
        index: parsed.index,
    };
}
function isChoice(value, choices) {
    return choices.includes(value);
}
function parseFailOn(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "none") {
        return [];
    }
    if (normalized === "errors") {
        return ["error"];
    }
    if (normalized === "warnings") {
        return ["error", "warning"];
    }
    const severities = normalized.split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const parsed = [];
    for (const severity of severities) {
        if (severity !== "error" && severity !== "warning" && severity !== "info") {
            throw new CliUsageError("--fail-on must be none or a comma-separated list of: error, warning, info.");
        }
        if (!parsed.includes(severity)) {
            parsed.push(severity);
        }
    }
    if (parsed.length === 0) {
        throw new CliUsageError("--fail-on requires at least one severity or none.");
    }
    return parsed;
}
function parseRuleList(value) {
    const rules = value.split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (rules.length === 0) {
        throw new CliUsageError("Rule list must include at least one rule code.");
    }
    return rules;
}
function createCliPolicy(args) {
    const basePolicy = resolveCiPolicy(args.policy);
    return {
        failOn: args.failOn ?? basePolicy.failOn ?? ["error"],
        failOnRules: uniqueList([...(basePolicy.failOnRules ?? []), ...args.failOnRules]),
        allowRules: uniqueList([...(basePolicy.allowRules ?? []), ...args.allowRules]),
        maxWarnings: args.maxWarnings ?? basePolicy.maxWarnings,
    };
}
function createPolicyReport(args, policy) {
    return {
        preset: args.policy,
        failOn: policy.failOn ?? ["error"],
        failOnRules: policy.failOnRules ?? [],
        allowRules: policy.allowRules ?? [],
        maxWarnings: policy.maxWarnings,
    };
}
function uniqueList(values) {
    return [...new Set(values)];
}
function createStreamingPolicyState(policy) {
    return {
        failOn: new Set(policy.failOn ?? ["error"]),
        failOnRules: new Set(policy.failOnRules ?? []),
        allowRules: new Set(policy.allowRules ?? []),
        maxWarnings: policy.maxWarnings,
        warnings: 0,
        errors: 0,
        failingDiagnostics: [],
    };
}
function updatePolicyState(state, diagnostic) {
    if (state.allowRules.has(diagnostic.code)) {
        return;
    }
    if (diagnostic.severity === "error") {
        state.errors += 1;
    }
    if (diagnostic.severity === "warning") {
        state.warnings += 1;
    }
    if (state.failOn.has(diagnostic.severity) || state.failOnRules.has(diagnostic.code)) {
        state.failingDiagnostics.push(diagnostic);
    }
}
function finishPolicyEvaluation(state) {
    const warningLimitExceeded = state.maxWarnings !== undefined && state.warnings > state.maxWarnings;
    const passed = state.failingDiagnostics.length === 0 && !warningLimitExceeded;
    const failureReasons = [
        state.failingDiagnostics.length > 0
            ? `${state.failingDiagnostics.length} diagnostic${state.failingDiagnostics.length === 1 ? "" : "s"} matched the CI failure policy.`
            : undefined,
        warningLimitExceeded
            ? `Warning count ${state.warnings} exceeded the configured maxWarnings ${state.maxWarnings}.`
            : undefined,
    ].filter((reason) => typeof reason === "string");
    return {
        passed,
        exitCode: passed ? 0 : 1,
        failingDiagnostics: state.failingDiagnostics,
        warnings: state.warnings,
        errors: state.errors,
        warningLimitExceeded,
        failureReasons,
    };
}
async function resolveRootInput(target, args) {
    if (isHttpUrl(target)) {
        throw new CliUsageError("Remote sitemap URLs are not accepted by the publish gate. Generate the sitemap first, pass the local file, and use --sitemap-location for its future public URL.");
    }
    const absolutePath = resolveLocalPath(target);
    await access(absolutePath);
    const loader = await resolveLocalChildLoader(args);
    return {
        input: {
            path: absolutePath,
            sourceId: args.sourceId ?? pathToFileURL(absolutePath).href,
            gzip: args.gzip ?? absolutePath.endsWith(".gz"),
        },
        sourceId: args.sourceId ?? absolutePath,
        sitemapLocation: args.sitemapLocation,
        gzip: args.gzip ?? absolutePath.endsWith(".gz"),
        loader,
    };
}
async function resolveLocalChildLoader(args) {
    if (!args.localSitemapRoot && !args.publicUrlPrefix) {
        return undefined;
    }
    if (!args.localSitemapRoot || !args.publicUrlPrefix) {
        throw new CliUsageError("--local-sitemap-root and --public-url-prefix must be provided together to validate child sitemap files from an index.");
    }
    const directory = resolveLocalPath(args.localSitemapRoot);
    await access(directory);
    return createLocalSitemapLoader({
        publicUrlPrefix: args.publicUrlPrefix,
        localDirectory: directory,
    });
}
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
function resolveLocalPath(target) {
    try {
        const url = new URL(target);
        if (url.protocol === "file:") {
            return fileURLToPath(url);
        }
    }
    catch {
        return resolve(target);
    }
    return resolve(target);
}
function createProgressSnapshot() {
    return {
        events: {},
        sourcesStarted: [],
        sourcesFinished: [],
        discoveredSources: [],
        bytesBySource: {},
        urlsBySource: {},
        sitemapsBySource: {},
    };
}
function updateProgress(progress, event) {
    progress.events[event.type] = (progress.events[event.type] ?? 0) + 1;
    if (event.type === "source:start") {
        progress.sourcesStarted.push(event.sourceId);
    }
    if (event.type === "source:finish") {
        progress.sourcesFinished.push(event.sourceId);
    }
    if (event.type === "source:discover") {
        progress.discoveredSources.push({
            sourceId: event.sourceId,
            parentSourceId: event.parentSourceId,
            loc: event.loc,
            depth: event.depth,
        });
    }
    if (event.type === "source:bytes") {
        progress.bytesBySource[event.sourceId] = event.bytes;
    }
    if (event.type === "sitemap:url") {
        progress.urlsBySource[event.sourceId] = event.count;
    }
    if (event.type === "sitemap:entry") {
        progress.sitemapsBySource[event.sourceId] = event.count;
    }
}
function createFallbackSetSummary(summaries, counts) {
    return {
        valid: summaries.every((summary) => summary.valid) && counts.errors === 0,
        sources: summaries.length,
        urls: summaries.reduce((total, summary) => total + summary.urls, 0),
        sitemaps: summaries.reduce((total, summary) => total + summary.sitemaps, 0),
        bytes: summaries.reduce((total, summary) => total + summary.bytes, 0),
        diagnostics: counts,
    };
}
function createJsonCliReport(report, args) {
    if (args.detail === "full") {
        return report;
    }
    const { diagnostics: _diagnostics, ...compactReport } = report;
    return {
        ...compactReport,
        omittedDiagnostics: report.diagnosticSummary.total,
    };
}
function formatTextReport(report, args) {
    const lines = [
        "Sitemap Validation Report",
        "=========================",
        "",
        `Status: ${report.evaluation.passed ? "passed" : "failed"}`,
        `Exit code: ${report.evaluation.exitCode}`,
        `Target: ${report.target}`,
        `Sitemap location: ${report.options.sitemapLocation ?? "not provided"}`,
        `Validated at: ${report.validatedAt}`,
        `Elapsed: ${report.elapsedMs}ms`,
        "",
        "Summary",
        "-------",
        `Valid: ${report.summary.valid ? "yes" : "no"}`,
        `Sources: ${report.summary.sources}`,
        `URLs: ${report.summary.urls}`,
        `Sitemap index entries: ${report.summary.sitemaps}`,
        `Bytes: ${report.summary.bytes}`,
        `Diagnostics: ${report.summary.diagnostics.errors} errors, ${report.summary.diagnostics.warnings} warnings, ${report.summary.diagnostics.info} info`,
        "",
        "Policy",
        "------",
        `Preset: ${report.policy.preset}`,
        `Fail on: ${report.policy.failOn.length === 0 ? "none" : report.policy.failOn.join(", ")}`,
        `Fail on rules: ${report.policy.failOnRules.length === 0 ? "none" : report.policy.failOnRules.join(", ")}`,
        `Allow rules: ${report.policy.allowRules.length === 0 ? "none" : report.policy.allowRules.join(", ")}`,
        `Max warnings: ${report.policy.maxWarnings ?? "none"}`,
    ];
    if (report.evaluation.failureReasons.length > 0) {
        lines.push("", "Failure Reasons", "---------------");
        for (const reason of report.evaluation.failureReasons) {
            lines.push(`- ${reason}`);
        }
    }
    lines.push("", "Options", "-------", ...Object.entries(report.options).map(([key, value]) => `${key}: ${formatValue(value)}`), "", "Sources", "-------");
    if (report.sourceSummaries.length === 0) {
        lines.push("(none)");
    }
    else {
        for (const summary of report.sourceSummaries) {
            lines.push(`${summary.sourceId}: root=${summary.rootType ?? "unknown"}, urls=${summary.urls}, sitemaps=${summary.sitemaps}, bytes=${summary.bytes}, diagnostics=${summary.diagnostics.errors}/${summary.diagnostics.warnings}/${summary.diagnostics.info}`);
        }
    }
    lines.push("", "Diagnostic Groups", "-----------------");
    if (report.diagnosticSummary.groups.length === 0) {
        lines.push("(none)");
    }
    else {
        for (const group of report.diagnosticSummary.groups) {
            lines.push(`[${group.severity}] ${group.code} x${group.count} (${group.source}): ${group.message}`);
            if (args.detail === "grouped") {
                for (const example of group.examples) {
                    lines.push(`  example${formatDiagnosticLocation(example)}: ${example.message}`);
                }
                if (group.omittedExamples > 0) {
                    lines.push(`  ... ${group.omittedExamples} more occurrence${group.omittedExamples === 1 ? "" : "s"} in this group.`);
                }
            }
        }
        if (report.diagnosticSummary.omittedGroups > 0) {
            lines.push(`... ${report.diagnosticSummary.omittedGroups} more diagnostic group${report.diagnosticSummary.omittedGroups === 1 ? "" : "s"} omitted.`);
        }
    }
    if (args.detail !== "full") {
        lines.push("", `Full diagnostics omitted in ${args.detail} mode. Use --detail full for raw diagnostic rows.`, "");
        return lines.join("\n");
    }
    lines.push("", "Diagnostics", "-----------");
    if (report.diagnostics.length === 0) {
        lines.push("(none)");
    }
    else {
        for (const diagnostic of report.diagnostics.slice(0, args.maxPrintedDiagnostics)) {
            const location = formatDiagnosticLocation(diagnostic);
            const context = diagnostic.context ? ` context=${JSON.stringify(diagnostic.context)}` : "";
            lines.push(`[${diagnostic.severity}] ${diagnostic.code}${location}: ${diagnostic.message}${context}`);
            if (diagnostic.spec) {
                lines.push(`  spec: ${diagnostic.spec}`);
            }
        }
        if (report.diagnostics.length > args.maxPrintedDiagnostics) {
            lines.push(`... ${report.diagnostics.length - args.maxPrintedDiagnostics} more diagnostics omitted in text mode. Increase --max-diagnostics or use --json --detail full for all output.`);
        }
    }
    lines.push("");
    return lines.join("\n");
}
function formatValue(value) {
    if (typeof value === "object" && value !== null) {
        return JSON.stringify(value);
    }
    return String(value);
}
function formatDiagnosticLocation(diagnostic) {
    const parts = [
        diagnostic.sourceId,
        diagnostic.location?.path,
        diagnostic.location?.line === undefined ? undefined : `line ${diagnostic.location.line}`,
        diagnostic.location?.column === undefined ? undefined : `column ${diagnostic.location.column}`,
    ].filter((part) => typeof part === "string" && part.length > 0);
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isMainModule() {
    const invokedPath = process.argv[1];
    if (!invokedPath) {
        return false;
    }
    return import.meta.url === pathToFileURL(invokedPath).href;
}
if (isMainModule()) {
    runCli().then((exitCode) => {
        process.exitCode = exitCode;
    }).catch((error) => {
        process.stderr.write(`${toErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}
