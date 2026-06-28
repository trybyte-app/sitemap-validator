#!/usr/bin/env node
import "./node-input.js";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ParsedRobots } from "@trybyte/robotstxt-parser";
import { evaluateForCi, resolveCiPolicy } from "./ci.js";
import { createLocalSitemapLoader } from "./loaders.js";
import { createDiagnosticSummaryBuilder } from "./report.js";
import { validateSitemapSetEvents } from "./set.js";
import type { CiEvaluation, CiPolicy, CiPolicyPreset } from "./ci.js";
import type { DiagnosticSummary, ReportDetailLevel } from "./report.js";
import type {
  DiagnosticSeverity,
  SitemapInput,
  SitemapDiagnostic,
  SitemapLoadedSource,
  SitemapLoader,
  SitemapSetResult,
  SitemapSetSummary,
  ValidationSummary,
} from "./types.js";

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_SOURCES = 10_000;
const DEFAULT_LOADER_CONCURRENCY = 4;
const DEFAULT_AUDIT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SITEMAP_BYTES = 60 * 1024 * 1024;
const DEFAULT_MAX_PAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ROBOTS_BYTES = 512 * 1024;
const DEFAULT_MAX_AUDIT_URLS = 1_000;
const DEFAULT_MAX_AUDIT_FINDINGS = 1_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DUPLICATE_SHARD_COUNT = 256;
const URL_COLLECTION_LOG_INTERVAL = 100_000;
const AUDIT_URL_LOG_INTERVAL = 10_000;
const SOURCE_LOG_INTERVAL = 25;

const CI_POLICY_PRESET_CHOICES = ["ciDefault", "strict", "protocolOnly", "googleCompatible"] as const;
const DETAIL_CHOICES = ["summary", "grouped", "full"] as const;
const FORMAT_CHOICES = ["text", "json"] as const;
const AUDIT_FAIL_CHOICES = ["none", "error", "warning"] as const;
const STATUS_METHOD_CHOICES = ["head", "get"] as const;
const USER_AGENT_PRESETS = {
  "googlebot-smartphone": {
    requestUserAgent: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    robotsUserAgent: "Googlebot",
  },
  googlebot: {
    requestUserAgent: "Googlebot",
    robotsUserAgent: "Googlebot",
  },
  "googlebot-image": {
    requestUserAgent: "Googlebot-Image",
    robotsUserAgent: "Googlebot-Image",
  },
  "googlebot-news": {
    requestUserAgent: "Googlebot-News",
    robotsUserAgent: "Googlebot-News",
  },
  "googlebot-video": {
    requestUserAgent: "Googlebot-Video",
    robotsUserAgent: "Googlebot-Video",
  },
} as const;
const USER_AGENT_PRESET_CHOICES = Object.keys(USER_AGENT_PRESETS) as Array<keyof typeof USER_AGENT_PRESETS>;

type OutputFormat = "text" | "json";
type AuditSeverity = "error" | "warning" | "info";
type AuditFailOn = "none" | "error" | "warning";
type StatusMethod = "head" | "get";
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ResolveHostLike = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

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

interface LiveProgressLogger {
  info(message: string): void;
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

interface AuditFinding {
  code: string;
  severity: AuditSeverity;
  message: string;
  url?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

interface AuditCounts {
  errors: number;
  warnings: number;
  info: number;
}

interface LiveXmlReport {
  validationSkipped: boolean;
  summary: SitemapSetSummary | undefined;
  sourceSummaries: ValidationSummary[];
  diagnosticSummary: DiagnosticSummary;
  diagnostics: SitemapDiagnostic[];
  evaluation: CiEvaluation | undefined;
}

interface LiveAuditReport {
  enabledChecks: string[];
  totalUrls: number;
  uniqueUrls: number | undefined;
  auditedUrls: number;
  maxAuditUrls: number;
  urlSource: "sitemap" | "urls-file";
  savedUrlsTo: string | undefined;
  savedUrlDetailsTo: string | undefined;
  counts: AuditCounts;
  findings: AuditFinding[];
  omittedFindings: number;
}

interface LiveCliReport {
  target: string | undefined;
  urlsFile: string | undefined;
  validatedAt: string;
  elapsedMs: number;
  xml: LiveXmlReport;
  audits: LiveAuditReport;
  evaluation: {
    passed: boolean;
    exitCode: 0 | 1;
    xmlPassed: boolean;
    auditPassed: boolean;
    failureReasons: string[];
  };
}

interface LiveValidationResult {
  urlDataset: UrlDataset;
  xml: LiveXmlReport;
  cleanup: (() => Promise<void>) | undefined;
}

interface ResolvedSitemapTarget {
  input: SitemapInput;
  sourceId: string;
  sitemapLocation: string | undefined;
  gzip: boolean | undefined;
  loader: SitemapLoader | undefined;
}

interface UrlDataset {
  path: string | undefined;
  recordsPath: string | undefined;
  totalUrls: number;
}

interface WritableUrlDataset {
  writeUrl(record: UrlRecord): Promise<void>;
  finish(): Promise<{ dataset: UrlDataset; cleanup: (() => Promise<void>) | undefined }>;
}

interface UrlRecord {
  url: string;
  sourceSitemap: string | undefined;
}

interface DuplicateShardRecord {
  key: string;
  url: string;
  sourceSitemap: string | undefined;
}

interface FetchResult {
  response: Response;
  finalUrl: string;
  redirects: string[];
}

interface LiveFetchOptions {
  followRedirects: boolean;
}

class LiveCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveCliUsageError";
  }
}

export async function runLiveCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: LiveCliDependencies = {},
): Promise<number> {
  try {
    const args = parseLiveCliArgs(argv);

    if (args.help) {
      writeLiveUsage(io.stdout);
      return 0;
    }

    if (!args.target && !args.urlsFile) {
      writeLiveUsage(io.stderr);
      return 2;
    }

    const logger = createLiveProgressLogger(args, io);
    const report = await runLiveValidation(args, dependencies.fetch ?? fetch, dependencies.resolveHost ?? defaultResolveHost, logger);
    const output = args.format === "json"
      ? `${JSON.stringify(formatJsonLiveReport(report, args), null, 2)}\n`
      : formatTextLiveReport(report);

    if (args.output) {
      await writeFile(args.output, output);
    } else {
      io.stdout.write(output);
    }

    return report.evaluation.exitCode;
  } catch (error) {
    io.stderr.write(`${toErrorMessage(error)}\n`);

    if (error instanceof LiveCliUsageError) {
      io.stderr.write("\n");
      writeLiveUsage(io.stderr);
      return 2;
    }

    return 1;
  }
}

function createLiveProgressLogger(args: LiveCliArgs, io: CliIo): LiveProgressLogger {
  if (args.quiet) {
    return {
      info() {},
    };
  }

  return {
    info(message) {
      io.stderr.write(`[sitemap-validator-live] ${message}\n`);
    },
  };
}

export function parseLiveCliArgs(argv: readonly string[]): LiveCliArgs {
  const args = defaultLiveCliArgs();

  for (let index = 0; index < argv.length; index += 1) {
    const rawValue = argv[index];

    if (!rawValue) {
      continue;
    }

    if (!rawValue.startsWith("-") || rawValue === "-") {
      if (args.target) {
        throw new LiveCliUsageError(`Unexpected positional argument: ${rawValue}`);
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
      case "--quiet":
        rejectInlineValue(flag, inlineValue);
        args.quiet = true;
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
      case "--detail": {
        const parsed = requireChoice(argv, index, flag, DETAIL_CHOICES, inlineValue);
        args.detail = parsed.value;
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
      case "--fail-on-rule": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.failOnRules.push(...parseList(parsed.value));
        index = parsed.index;
        break;
      }
      case "--allow-rule": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.allowRules.push(...parseList(parsed.value));
        index = parsed.index;
        break;
      }
      case "--max-warnings": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxWarnings = parsed.value;
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
      case "--public-url-prefix": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.publicUrlPrefix = parsed.value;
        index = parsed.index;
        break;
      }
      case "--local-sitemap-root": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.localSitemapRoot = parsed.value;
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
      case "--save-urls": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.saveUrls = parsed.value;
        index = parsed.index;
        break;
      }
      case "--save-url-details": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.saveUrlDetails = parsed.value;
        index = parsed.index;
        break;
      }
      case "--urls-file": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.urlsFile = parsed.value;
        index = parsed.index;
        break;
      }
      case "--check-duplicates":
        rejectInlineValue(flag, inlineValue);
        args.checkDuplicates = true;
        break;
      case "--check-robots":
        rejectInlineValue(flag, inlineValue);
        args.checkRobots = true;
        break;
      case "--check-status":
        rejectInlineValue(flag, inlineValue);
        args.checkStatus = true;
        break;
      case "--check-canonical":
        rejectInlineValue(flag, inlineValue);
        args.checkCanonical = true;
        break;
      case "--require-canonical":
        rejectInlineValue(flag, inlineValue);
        args.checkCanonical = true;
        args.requireCanonical = true;
        break;
      case "--check-noindex":
        rejectInlineValue(flag, inlineValue);
        args.checkNoindex = true;
        break;
      case "--all-audits":
        rejectInlineValue(flag, inlineValue);
        args.checkDuplicates = true;
        args.checkRobots = true;
        args.checkStatus = true;
        args.checkCanonical = true;
        args.checkNoindex = true;
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
      case "--audit-concurrency": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.auditConcurrency = parsed.value;
        index = parsed.index;
        break;
      }
      case "--timeout-ms": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.timeoutMs = parsed.value;
        index = parsed.index;
        break;
      }
      case "--max-sitemap-bytes": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxSitemapBytes = parsed.value;
        index = parsed.index;
        break;
      }
      case "--max-page-bytes": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxPageBytes = parsed.value;
        index = parsed.index;
        break;
      }
      case "--max-robots-bytes": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxRobotsBytes = parsed.value;
        index = parsed.index;
        break;
      }
      case "--max-audit-urls": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxAuditUrls = parsed.value;
        index = parsed.index;
        break;
      }
      case "--max-audit-findings": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxAuditFindings = parsed.value;
        index = parsed.index;
        break;
      }
      case "--max-redirects": {
        const parsed = requireNumber(argv, index, flag, inlineValue);
        args.maxRedirects = parsed.value;
        index = parsed.index;
        break;
      }
      case "--allow-private-hosts":
        rejectInlineValue(flag, inlineValue);
        args.allowPrivateHosts = true;
        break;
      case "--user-agent": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.userAgent = parsed.value;
        args.userAgentPreset = undefined;
        index = parsed.index;
        break;
      }
      case "--robots-user-agent": {
        const parsed = requireValue(argv, index, flag, inlineValue);
        args.robotsUserAgent = parsed.value;
        index = parsed.index;
        break;
      }
      case "--user-agent-preset": {
        const parsed = requireChoice(argv, index, flag, USER_AGENT_PRESET_CHOICES, inlineValue);
        const preset = USER_AGENT_PRESETS[parsed.value];
        args.userAgentPreset = parsed.value;
        args.userAgent = preset.requestUserAgent;
        args.robotsUserAgent = preset.robotsUserAgent;
        index = parsed.index;
        break;
      }
      case "--audit-fail-on": {
        const parsed = requireChoice(argv, index, flag, AUDIT_FAIL_CHOICES, inlineValue);
        args.auditFailOn = parsed.value;
        index = parsed.index;
        break;
      }
      case "--status-method": {
        const parsed = requireChoice(argv, index, flag, STATUS_METHOD_CHOICES, inlineValue);
        args.statusMethod = parsed.value;
        index = parsed.index;
        break;
      }
      default:
        throw new LiveCliUsageError(`Unknown argument: ${rawValue}`);
    }
  }

  if (args.urlsFile && args.target) {
    throw new LiveCliUsageError("Pass either a sitemap URL/file target or --urls-file, not both.");
  }

  if (args.auditConcurrency < 1 || args.loaderConcurrency < 1) {
    throw new LiveCliUsageError("Concurrency values must be at least 1.");
  }

  return args;
}

async function runLiveValidation(
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  logger: LiveProgressLogger,
): Promise<LiveCliReport> {
  const startedAt = performance.now();
  logger.info(`Live sitemap check started for ${args.target ?? args.urlsFile ?? "(unknown target)"}.`);
  const liveValidation = args.urlsFile
    ? {
        urlDataset: await createUrlsFileDataset(args.urlsFile, logger),
        xml: createSkippedXmlReport(),
        cleanup: undefined,
      }
    : await validateSitemapTargetAndCollectUrls(args, fetcher, resolveHost, logger);

  try {
    const audits = await runOptInAudits(liveValidation.urlDataset, args, fetcher, resolveHost, args.urlsFile ? "urls-file" : "sitemap", logger);
    audits.savedUrlsTo = args.saveUrls;
    audits.savedUrlDetailsTo = args.saveUrlDetails;
    const evaluation = createLiveEvaluation(liveValidation.xml.evaluation, audits, args.auditFailOn);
    logger.info(`Live sitemap check finished with ${evaluation.passed ? "passed" : "failed"} status.`);

    return {
      target: args.target,
      urlsFile: args.urlsFile,
      validatedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - startedAt),
      xml: liveValidation.xml,
      audits,
      evaluation,
    };
  } finally {
    await liveValidation.cleanup?.();
  }
}

async function validateSitemapTargetAndCollectUrls(
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  logger: LiveProgressLogger,
): Promise<LiveValidationResult> {
  const root = await resolveSitemapTarget(args, fetcher, resolveHost, logger);
  logger.info("Root sitemap ready; validating XML and collecting sitemap URLs.");
  const needsUrlFile = args.saveUrls !== undefined || args.saveUrlDetails !== undefined || getEnabledChecks(args).length > 0;
  const urlDataset = needsUrlFile ? await createWritableUrlDataset(args.saveUrls, args.saveUrlDetails, getEnabledChecks(args).length > 0) : createUnsavedUrlDataset();
  const diagnostics: SitemapDiagnostic[] = [];
  const sourceSummaries: ValidationSummary[] = [];
  const diagnosticSummaryBuilder = createDiagnosticSummaryBuilder({
    maxGroups: args.detail === "summary" ? 10 : 50,
    maxExamplesPerGroup: args.detail === "summary" ? 0 : 3,
  });
  let summary: SitemapSetSummary | undefined;
  let collectedUrls = 0;
  let discoveredSources = 0;
  let finishedSources = 0;

  for await (const event of validateSitemapSetEvents(root.input, {
    sourceId: root.sourceId,
    sitemapLocation: root.sitemapLocation,
    gzip: root.gzip,
    loader: root.loader,
    loaderConcurrency: args.loaderConcurrency,
    maxDepth: args.maxDepth,
    maxSources: args.maxSources,
  })) {
    if (event.type === "sitemap:url" && event.loc) {
      collectedUrls += 1;
      await urlDataset.writeUrl({
        url: event.loc,
        sourceSitemap: event.sourceId,
      });

      if (shouldLogMilestone(collectedUrls, URL_COLLECTION_LOG_INTERVAL)) {
        logger.info(`Collected ${formatCount(collectedUrls)} sitemap URLs so far.`);
      }
    }

    if (event.type === "diagnostic") {
      diagnostics.push(event.diagnostic);
      diagnosticSummaryBuilder.add(event.diagnostic);
    }

    if (event.type === "source:discover") {
      discoveredSources += 1;

      if (shouldLogEarlyOrInterval(discoveredSources, SOURCE_LOG_INTERVAL)) {
        logger.info(`Discovered child sitemap ${formatCount(discoveredSources)}: ${event.loc}`);
      }
    }

    if (event.type === "source:finish") {
      finishedSources += 1;
      sourceSummaries.push(event.summary);

      if (shouldLogEarlyOrInterval(finishedSources, SOURCE_LOG_INTERVAL)) {
        logger.info(`Validated ${formatCount(finishedSources)} sitemap source${finishedSources === 1 ? "" : "s"}; collected ${formatCount(collectedUrls)} URLs.`);
      }
    }

    if (event.type === "set:summary") {
      summary = event.summary;
    }
  }

  const setSummary = summary ?? createFallbackSummary(sourceSummaries, diagnostics);
  const result: SitemapSetResult = {
    valid: setSummary.valid,
    diagnostics,
    summaries: sourceSummaries,
    summary: setSummary,
  };
  const xmlPolicy = createXmlPolicy(args);

  const finalizedDataset = await urlDataset.finish();

  logger.info(`XML validation finished: ${formatCount(setSummary.sources)} sitemap source${setSummary.sources === 1 ? "" : "s"}, ${formatCount(setSummary.urls)} URLs, ${setSummary.diagnostics.errors} errors, ${setSummary.diagnostics.warnings} warnings.`);

  if (args.saveUrls) {
    logger.info(`Saved sitemap URLs to ${args.saveUrls}.`);
  }

  if (args.saveUrlDetails) {
    logger.info(`Saved sitemap URL details to ${args.saveUrlDetails}.`);
  }

  return {
    urlDataset: finalizedDataset.dataset,
    cleanup: finalizedDataset.cleanup,
    xml: {
      validationSkipped: false,
      summary: setSummary,
      sourceSummaries,
      diagnosticSummary: diagnosticSummaryBuilder.summary(),
      diagnostics,
      evaluation: evaluateForCi(result, xmlPolicy),
    },
  };
}

async function resolveSitemapTarget(
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  logger: LiveProgressLogger,
): Promise<ResolvedSitemapTarget> {
  const target = args.target;

  if (!target) {
    throw new LiveCliUsageError("Missing sitemap target.");
  }

  if (isHttpUrl(target)) {
    logger.info(`Fetching root sitemap: ${target}`);
    const source = await fetchSitemapSource(target, args, fetcher, resolveHost);

    return {
      input: source.input,
      sourceId: source.sourceId ?? target,
      sitemapLocation: source.sitemapLocation,
      gzip: source.gzip,
      loader: createLiveSitemapLoader(args, fetcher, resolveHost),
    };
  }

  logger.info(`Reading root sitemap file: ${target}`);
  const absolutePath = resolveLocalPath(target);
  await access(absolutePath);
  const loader = await resolveLocalChildLoader(args);
  const gzip = args.gzip ?? absolutePath.endsWith(".gz");

  return {
    input: {
      path: absolutePath,
      sourceId: args.sourceId ?? pathToFileURL(absolutePath).href,
      gzip,
    },
    sourceId: args.sourceId ?? absolutePath,
    sitemapLocation: args.sitemapLocation,
    gzip,
    loader,
  };
}

async function resolveLocalChildLoader(args: LiveCliArgs): Promise<SitemapLoader | undefined> {
  if (!args.localSitemapRoot && !args.publicUrlPrefix) {
    return undefined;
  }

  if (!args.localSitemapRoot || !args.publicUrlPrefix) {
    throw new LiveCliUsageError("--local-sitemap-root and --public-url-prefix must be provided together to validate child sitemap files from a local sitemap index.");
  }

  const directory = resolveLocalPath(args.localSitemapRoot);
  await access(directory);

  return createLocalSitemapLoader({
    publicUrlPrefix: args.publicUrlPrefix,
    localDirectory: directory,
  });
}

function createLiveSitemapLoader(args: LiveCliArgs, fetcher: FetchLike, resolveHost: ResolveHostLike): SitemapLoader {
  return async ({ loc }): Promise<SitemapLoadedSource> => fetchSitemapSource(loc, args, fetcher, resolveHost);
}

async function fetchSitemapSource(
  url: string,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
): Promise<SitemapLoadedSource> {
  const { response, finalUrl } = await fetchLive(fetcher, url, {
    method: "GET",
    headers: {
      "user-agent": args.userAgent,
      "accept": "application/xml,text/xml,*/*",
    },
  }, args, resolveHost, { followRedirects: true });

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap ${finalUrl}: HTTP ${response.status}`);
  }

  const bytes = await readResponseBytes(response, args.maxSitemapBytes);

  return {
    input: bytes,
    sourceId: finalUrl,
    sitemapLocation: finalUrl,
    gzip: shouldTreatAsGzip(finalUrl, response),
  };
}

async function runOptInAudits(
  urlDataset: UrlDataset,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  urlSource: "sitemap" | "urls-file",
  logger: LiveProgressLogger,
): Promise<LiveAuditReport> {
  const enabledChecks = getEnabledChecks(args);
  const accumulator = new AuditFindingAccumulator(args.maxAuditFindings);
  let uniqueUrls: number | undefined;
  let auditedUrls = 0;

  if (enabledChecks.length === 0) {
    logger.info("No opt-in live URL audits enabled.");
    return createLiveAuditReport(urlDataset, enabledChecks, uniqueUrls, auditedUrls, args, urlSource, accumulator);
  }

  logger.info(`Live URL audits started: ${enabledChecks.join(", ")}.`);

  if (!urlDataset.path && !urlDataset.recordsPath) {
    accumulator.add({
      code: "LIVE_URL_DATASET_UNAVAILABLE",
      severity: "error",
      message: "Live audits require a saved or temporary sitemap URL list.",
    });

    return createLiveAuditReport(urlDataset, enabledChecks, uniqueUrls, auditedUrls, args, urlSource, accumulator);
  }

  if (args.checkDuplicates) {
    uniqueUrls = await auditDuplicateUrls(urlDataset, accumulator, logger);
  }

  const needsUrlAudit = args.checkRobots || args.checkStatus || args.checkCanonical || args.checkNoindex || args.requireCanonical;
  const selectedUrls = needsUrlAudit && args.maxAuditUrls > 0
    ? await collectAuditUrlSample(urlDataset, args.maxAuditUrls)
    : undefined;

  if (selectedUrls) {
    auditedUrls = selectedUrls.records.length;
    logger.info(`Selected ${formatCount(auditedUrls)} unique URL${auditedUrls === 1 ? "" : "s"} for page-level audits.`);

    if (selectedUrls.limitReached) {
      accumulator.add({
        code: "LIVE_AUDIT_URL_LIMIT_EXCEEDED",
        severity: "warning",
        message: `Live audit checked the first ${selectedUrls.records.length} unique URLs it found. Increase --max-audit-urls or set it to 0 to audit all URL entries.`,
        context: {
          maxAuditUrls: args.maxAuditUrls,
          totalUrls: urlDataset.totalUrls,
        },
      });
    }
  } else if (needsUrlAudit) {
    auditedUrls = urlDataset.totalUrls;
    logger.info(`Page-level audits will stream all ${formatCount(auditedUrls)} URL entries.`);
  }

  if (args.checkRobots) {
    const records = selectedUrls ? urlRecordsFromArray(selectedUrls.records) : iterateUrlRecords(urlDataset);
    await auditRobots(records, args, fetcher, resolveHost, accumulator, logger);
  }

  if (args.checkStatus || args.checkCanonical || args.checkNoindex || args.requireCanonical) {
    const records = selectedUrls ? urlRecordsFromArray(selectedUrls.records) : iterateUrlRecords(urlDataset);
    await auditPageUrls(records, args, fetcher, resolveHost, accumulator, logger);
  }

  logger.info(`Live URL audits finished: ${accumulator.counts.errors} errors, ${accumulator.counts.warnings} warnings.`);

  return createLiveAuditReport(urlDataset, enabledChecks, uniqueUrls, auditedUrls, args, urlSource, accumulator);
}

function createLiveAuditReport(
  urlDataset: UrlDataset,
  enabledChecks: string[],
  uniqueUrls: number | undefined,
  auditedUrls: number,
  args: LiveCliArgs,
  urlSource: "sitemap" | "urls-file",
  accumulator: AuditFindingAccumulator,
): LiveAuditReport {
  return {
    enabledChecks,
    totalUrls: urlDataset.totalUrls,
    uniqueUrls,
    auditedUrls,
    maxAuditUrls: args.maxAuditUrls,
    urlSource,
    savedUrlsTo: undefined,
    savedUrlDetailsTo: undefined,
    counts: accumulator.counts,
    findings: accumulator.findings,
    omittedFindings: accumulator.omittedFindings,
  };
}

class AuditFindingAccumulator {
  readonly counts: AuditCounts = { errors: 0, warnings: 0, info: 0 };
  readonly findings: AuditFinding[] = [];
  omittedFindings = 0;

  constructor(private readonly maxFindings: number) {}

  add(finding: AuditFinding): void {
    if (finding.severity === "error") this.counts.errors += 1;
    if (finding.severity === "warning") this.counts.warnings += 1;
    if (finding.severity === "info") this.counts.info += 1;

    if (this.findings.length < this.maxFindings) {
      this.findings.push(finding);
    } else {
      this.omittedFindings += 1;
    }
  }

  addMany(findings: readonly AuditFinding[]): void {
    for (const finding of findings) {
      this.add(finding);
    }
  }
}

async function auditDuplicateUrls(
  urlDataset: UrlDataset,
  accumulator: AuditFindingAccumulator,
  logger: LiveProgressLogger,
): Promise<number | undefined> {
  if (!urlDataset.path && !urlDataset.recordsPath) {
    return undefined;
  }

  logger.info("Duplicate URL audit started.");
  const tempDirectory = await mkdtemp(join(tmpdir(), "sitemap-live-duplicates-"));
  const writers = new Map<number, ReturnType<typeof createWriteStream>>();
  let processedUrls = 0;

  try {
    for await (const record of iterateUrlRecords(urlDataset)) {
      processedUrls += 1;
      const key = normalizeUrlKey(record.url);
      const shard = duplicateShardForKey(key);
      const shardPath = join(tempDirectory, `${shard}.txt`);
      let writer = writers.get(shard);

      if (!writer) {
        writer = createWriteStream(shardPath, { flags: "a" });
        writers.set(shard, writer);
      }

      await writeStreamLine(writer, `${JSON.stringify({
        key,
        url: record.url,
        sourceSitemap: record.sourceSitemap,
      })}\n`);

      if (shouldLogMilestone(processedUrls, URL_COLLECTION_LOG_INTERVAL)) {
        logger.info(`Duplicate URL audit indexed ${formatCount(processedUrls)} URL entries.`);
      }
    }

    await closeWriters(writers);
    let uniqueUrls = 0;

    for (let shard = 0; shard < DUPLICATE_SHARD_COUNT; shard += 1) {
      const shardPath = join(tempDirectory, `${shard}.txt`);
      const seen = new Map<string, { firstRecord: UrlRecord; count: number; sourceSitemapSamples: string[] }>();

      for await (const line of iterateLines(shardPath, { missingOk: true })) {
        const duplicateRecord = parseDuplicateShardRecord(line);
        const entry = seen.get(duplicateRecord.key);

        if (entry) {
          entry.count += 1;
          addSourceSitemapSample(entry.sourceSitemapSamples, duplicateRecord.sourceSitemap);
        } else {
          seen.set(duplicateRecord.key, {
            firstRecord: {
              url: duplicateRecord.url,
              sourceSitemap: duplicateRecord.sourceSitemap,
            },
            count: 1,
            sourceSitemapSamples: duplicateRecord.sourceSitemap ? [duplicateRecord.sourceSitemap] : [],
          });
        }
      }

      uniqueUrls += seen.size;

      for (const entry of seen.values()) {
        if (entry.count > 1) {
          accumulator.add({
            code: "LIVE_DUPLICATE_URL",
            severity: "warning",
            message: `URL appears ${entry.count} times in the collected sitemap URL list.`,
            url: entry.firstRecord.url,
            context: {
              count: entry.count,
              ...urlRecordContext(entry.firstRecord),
              sourceSitemapSamples: entry.sourceSitemapSamples,
            },
          });
        }
      }
    }

    logger.info(`Duplicate URL audit finished: ${formatCount(uniqueUrls)} unique URLs from ${formatCount(processedUrls)} entries.`);
    return uniqueUrls;
  } finally {
    await closeWriters(writers);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function collectAuditUrlSample(urlDataset: UrlDataset, maxAuditUrls: number): Promise<{ records: UrlRecord[]; limitReached: boolean }> {
  const records: UrlRecord[] = [];
  const seen = new Set<string>();
  let limitReached = false;

  for await (const record of iterateUrlRecords(urlDataset)) {
    const key = normalizeUrlKey(record.url);

    if (seen.has(key)) {
      continue;
    }

    if (records.length >= maxAuditUrls) {
      limitReached = true;
      break;
    }

    seen.add(key);
    records.push(record);
  }

  return {
    records,
    limitReached,
  };
}

async function* urlRecordsFromArray(records: readonly UrlRecord[]): AsyncGenerator<UrlRecord, void, void> {
  for (const record of records) {
    yield record;
  }
}

async function writeStreamLine(stream: ReturnType<typeof createWriteStream>, line: string): Promise<void> {
  if (!stream.write(line)) {
    await once(stream, "drain");
  }
}

async function closeWriters(writers: Map<number, ReturnType<typeof createWriteStream>>): Promise<void> {
  const streams = [...writers.values()];
  writers.clear();

  await Promise.all(streams.map(async (stream) => {
    if (!stream.closed) {
      stream.end();
      await finished(stream);
    }
  }));
}

function duplicateShardForKey(key: string): number {
  return createHash("sha256").update(key).digest()[0] ?? 0;
}

async function createUrlsFileDataset(path: string, logger: LiveProgressLogger): Promise<UrlDataset> {
  logger.info(`Reading saved URL list: ${path}`);
  const recordsPath = await isJsonLinesRecordFile(path) ? path : undefined;

  return {
    path: recordsPath ? undefined : path,
    recordsPath,
    totalUrls: recordsPath ? await countUrlRecordsFile(recordsPath, logger) : await countUrlsFile(path, logger),
  };
}

function createUnsavedUrlDataset(): WritableUrlDataset {
  let totalUrls = 0;

  return {
    async writeUrl() {
      totalUrls += 1;
    },
    async finish() {
      return {
        dataset: {
          path: undefined,
          recordsPath: undefined,
          totalUrls,
        },
        cleanup: undefined,
      };
    },
  };
}

async function createWritableUrlDataset(
  savePath: string | undefined,
  saveRecordPath: string | undefined,
  needsRecords: boolean,
): Promise<WritableUrlDataset> {
  const temporaryDirectory = !savePath || (needsRecords && !saveRecordPath)
    ? await mkdtemp(join(tmpdir(), "sitemap-live-urls-"))
    : undefined;
  const path = savePath ?? (needsRecords ? undefined : join(temporaryDirectory ?? tmpdir(), "urls.txt"));
  const recordsPath = saveRecordPath ?? (needsRecords ? join(temporaryDirectory ?? tmpdir(), "url-details.jsonl") : undefined);
  const writer = path ? createWriteStream(path, { flags: "w" }) : undefined;
  const recordWriter = recordsPath ? createWriteStream(recordsPath, { flags: "w" }) : undefined;
  let totalUrls = 0;

  return {
    async writeUrl(record) {
      totalUrls += 1;

      if (writer) {
        await writeStreamLine(writer, `${record.url}\n`);
      }

      if (recordWriter) {
        await writeStreamLine(recordWriter, `${serializeUrlRecord(record)}\n`);
      }
    },
    async finish() {
      if (writer) {
        writer.end();
        await finished(writer);
      }

      if (recordWriter) {
        recordWriter.end();
        await finished(recordWriter);
      }

      return {
        dataset: {
          path,
          recordsPath,
          totalUrls,
        },
        cleanup: temporaryDirectory
          ? async () => {
              await rm(temporaryDirectory, { recursive: true, force: true });
            }
          : undefined,
      };
    },
  };
}

function serializeUrlRecord(record: UrlRecord): string {
  const payload: { url: string; sourceSitemap?: string } = {
    url: record.url,
  };

  if (record.sourceSitemap) {
    payload.sourceSitemap = record.sourceSitemap;
  }

  return JSON.stringify(payload);
}

function parseUrlRecordJson(line: string): UrlRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    throw new LiveCliUsageError("--urls-file JSONL records must contain one JSON object per line.");
  }

  if (!isObjectRecord(parsed) || typeof parsed.url !== "string") {
    throw new LiveCliUsageError("--urls-file JSONL records must include a string url field.");
  }

  if ("sourceSitemap" in parsed && parsed.sourceSitemap !== undefined && typeof parsed.sourceSitemap !== "string") {
    throw new LiveCliUsageError("--urls-file JSONL sourceSitemap fields must be strings when present.");
  }

  return {
    url: parsed.url,
    sourceSitemap: typeof parsed.sourceSitemap === "string" ? parsed.sourceSitemap : undefined,
  };
}

function parseDuplicateShardRecord(line: string): DuplicateShardRecord {
  const parsed = JSON.parse(line) as unknown;

  if (!isObjectRecord(parsed) || typeof parsed.key !== "string" || typeof parsed.url !== "string") {
    throw new Error("Duplicate URL shard record is malformed.");
  }

  if ("sourceSitemap" in parsed && parsed.sourceSitemap !== undefined && typeof parsed.sourceSitemap !== "string") {
    throw new Error("Duplicate URL shard sourceSitemap is malformed.");
  }

  return {
    key: parsed.key,
    url: parsed.url,
    sourceSitemap: typeof parsed.sourceSitemap === "string" ? parsed.sourceSitemap : undefined,
  };
}

function addSourceSitemapSample(samples: string[], sourceSitemap: string | undefined): void {
  if (!sourceSitemap || samples.includes(sourceSitemap) || samples.length >= 10) {
    return;
  }

  samples.push(sourceSitemap);
}

function urlRecordContext(record: UrlRecord): Record<string, unknown> {
  return record.sourceSitemap
    ? { sourceSitemap: record.sourceSitemap }
    : {};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function countUrlsFile(path: string, logger: LiveProgressLogger): Promise<number> {
  let count = 0;

  for await (const _url of iterateUrlsFile(path)) {
    count += 1;

    if (shouldLogMilestone(count, URL_COLLECTION_LOG_INTERVAL)) {
      logger.info(`Read ${formatCount(count)} URLs from saved URL list.`);
    }
  }

  logger.info(`Saved URL list ready: ${formatCount(count)} URL entries.`);
  return count;
}

async function countUrlRecordsFile(path: string, logger: LiveProgressLogger): Promise<number> {
  let count = 0;

  for await (const _record of iterateUrlRecordsFile(path)) {
    count += 1;

    if (shouldLogMilestone(count, URL_COLLECTION_LOG_INTERVAL)) {
      logger.info(`Read ${formatCount(count)} URL detail records.`);
    }
  }

  logger.info(`URL detail file ready: ${formatCount(count)} URL records.`);
  return count;
}

async function* iterateUrlRecords(dataset: UrlDataset): AsyncGenerator<UrlRecord, void, void> {
  if (dataset.recordsPath) {
    yield* iterateUrlRecordsFile(dataset.recordsPath);
    return;
  }

  if (!dataset.path) {
    return;
  }

  for await (const url of iterateUrlsFile(dataset.path)) {
    yield {
      url,
      sourceSitemap: undefined,
    };
  }
}

async function* iterateUrlRecordsFile(path: string): AsyncGenerator<UrlRecord, void, void> {
  for await (const line of iterateLines(path)) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    yield parseUrlRecordJson(trimmed);
  }
}

async function* iterateUrlsFile(path: string): AsyncGenerator<string, void, void> {
  if (await isJsonArrayFile(path)) {
    for (const url of await readJsonUrlsFile(path)) {
      yield url;
    }

    return;
  }

  for await (const line of iterateLines(path)) {
    const url = line.trim();

    if (url.length > 0 && !url.startsWith("#")) {
      yield url;
    }
  }
}

async function* iterateLines(path: string, options: { missingOk?: boolean } = {}): AsyncGenerator<string, void, void> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      yield line;
    }
  } catch (error) {
    if (!options.missingOk || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function isJsonArrayFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").trimStart().startsWith("[");
  } finally {
    await handle.close();
  }
}

async function isJsonLinesRecordFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").trimStart().startsWith("{");
  } finally {
    await handle.close();
  }
}

async function readJsonUrlsFile(path: string): Promise<string[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new LiveCliUsageError("--urls-file JSON must be an array of URL strings.");
  }

  return parsed;
}

async function auditRobots(
  records: AsyncIterable<UrlRecord>,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  accumulator: AuditFindingAccumulator,
  logger: LiveProgressLogger,
): Promise<void> {
  const robotsCache = new Map<string, Promise<ParsedRobots | null>>();
  let checkedUrls = 0;

  logger.info("Robots.txt audit started.");
  for await (const record of records) {
    checkedUrls += 1;
    logAuditUrlProgress(logger, "Robots.txt audit", checkedUrls, checkedUrls - 1);
    const url = record.url;
    const parsed = parseUrl(url);

    if (!parsed) {
      accumulator.add(invalidAuditUrlFinding(record));
      continue;
    }

    const parsedRobots = await getRobotsForOrigin(parsed.origin, args, fetcher, resolveHost, accumulator);

    if (!parsedRobots) {
      continue;
    }

    for (const result of parsedRobots.checkUrls(args.robotsUserAgent, [url])) {
      if (!result.allowed) {
        accumulator.add({
          code: "LIVE_ROBOTS_DISALLOWED",
          severity: "warning",
          message: "URL is disallowed by robots.txt for the configured user-agent.",
          url: result.url,
          context: {
            ...urlRecordContext(record),
            robotsUrl: `${parsed.origin}/robots.txt`,
            userAgent: args.robotsUserAgent,
            matchingLine: result.matchingLine,
            matchedPattern: result.matchedPattern,
            matchedRuleType: result.matchedRuleType,
          },
        });
      }
    }

  }

  logger.info(`Robots.txt audit finished: ${formatCount(checkedUrls)} URLs checked.`);

  async function getRobotsForOrigin(
    origin: string,
    liveArgs: LiveCliArgs,
    liveFetcher: FetchLike,
    liveResolveHost: ResolveHostLike,
    liveAccumulator: AuditFindingAccumulator,
  ): Promise<ParsedRobots | null> {
    const cached = robotsCache.get(origin);

    if (cached) {
      return cached;
    }

    const promise = fetchRobotsForOrigin(origin, liveArgs, liveFetcher, liveResolveHost, liveAccumulator);
    robotsCache.set(origin, promise);
    return promise;
  }
}

async function fetchRobotsForOrigin(
  origin: string,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  accumulator: AuditFindingAccumulator,
): Promise<ParsedRobots | null> {
  const robotsUrl = `${origin}/robots.txt`;
  let fetchResult: FetchResult;

  try {
    fetchResult = await fetchLive(fetcher, robotsUrl, {
      method: "GET",
      headers: {
        "user-agent": args.userAgent,
        "accept": "text/plain,*/*",
      },
    }, args, resolveHost, { followRedirects: true });
  } catch (error) {
    accumulator.add({
      code: "LIVE_ROBOTS_UNREACHABLE",
      severity: "warning",
      message: `Could not fetch robots.txt for ${origin}.`,
      context: {
        robotsUrl,
        cause: toErrorMessage(error),
      },
    });
    return null;
  }

  const { response, finalUrl } = fetchResult;

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    accumulator.add({
      code: "LIVE_ROBOTS_UNAVAILABLE",
      severity: "warning",
      message: `robots.txt for ${origin} returned HTTP ${response.status}.`,
      context: {
        robotsUrl,
        finalUrl,
        status: response.status,
      },
    });
    return null;
  }

  const robotsTxt = new TextDecoder().decode(await readResponseBytes(response, args.maxRobotsBytes));
  return ParsedRobots.parse(robotsTxt);
}

async function auditPageUrls(
  records: AsyncIterable<UrlRecord>,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
  accumulator: AuditFindingAccumulator,
  logger: LiveProgressLogger,
): Promise<void> {
  let chunk: UrlRecord[] = [];
  const chunkSize = Math.max(args.auditConcurrency * 4, 1);
  let checkedUrls = 0;

  logger.info("Page URL audit started.");
  for await (const record of records) {
    chunk.push(record);

    if (chunk.length >= chunkSize) {
      accumulator.addMany((await auditPageUrlChunk(chunk, args, fetcher, resolveHost)).flat());
      const previousCheckedUrls = checkedUrls;
      checkedUrls += chunk.length;
      logAuditUrlProgress(logger, "Page URL audit", checkedUrls, previousCheckedUrls);
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    accumulator.addMany((await auditPageUrlChunk(chunk, args, fetcher, resolveHost)).flat());
    const previousCheckedUrls = checkedUrls;
    checkedUrls += chunk.length;
    logAuditUrlProgress(logger, "Page URL audit", checkedUrls, previousCheckedUrls);
  }

  logger.info(`Page URL audit finished: ${formatCount(checkedUrls)} URLs checked.`);
}

async function auditPageUrlChunk(
  records: readonly UrlRecord[],
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
): Promise<AuditFinding[][]> {
  return mapConcurrent(records, args.auditConcurrency, async (record) => auditPageUrl(record, args, fetcher, resolveHost));
}

async function auditPageUrl(
  record: UrlRecord,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const url = record.url;

  if (!parseUrl(url)) {
    return [invalidAuditUrlFinding(record)];
  }

  if (args.checkStatus) {
    findings.push(...await auditStatus(record, args, fetcher, resolveHost));
  }

  if (args.checkCanonical || args.requireCanonical || args.checkNoindex) {
    findings.push(...await auditPageBody(record, args, fetcher, resolveHost));
  }

  return findings;
}

async function auditStatus(
  record: UrlRecord,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
): Promise<AuditFinding[]> {
  let fetchResult: FetchResult;
  const url = record.url;

  try {
    fetchResult = await fetchLive(fetcher, url, {
      method: args.statusMethod === "head" ? "HEAD" : "GET",
      headers: {
        "user-agent": args.userAgent,
        "accept": "*/*",
      },
    }, args, resolveHost, { followRedirects: false });

    if (args.statusMethod === "head" && (fetchResult.response.status === 405 || fetchResult.response.status === 501)) {
      fetchResult = await fetchLive(fetcher, url, {
        method: "GET",
        headers: {
          "user-agent": args.userAgent,
          "accept": "*/*",
        },
      }, args, resolveHost, { followRedirects: false });
    }

    await fetchResult.response.body?.cancel();
  } catch (error) {
    return [{
      code: "LIVE_STATUS_UNREACHABLE",
      severity: "error",
      message: "URL could not be reached for status check.",
      url,
      context: {
        ...urlRecordContext(record),
        cause: toErrorMessage(error),
      },
    }];
  }

  const { response } = fetchResult;

  if (response.status >= 200 && response.status < 300) {
    return [];
  }

  return [{
    code: response.status >= 300 && response.status < 400 ? "LIVE_STATUS_REDIRECT" : "LIVE_STATUS_BAD",
    severity: "error",
    message: `URL returned HTTP ${response.status}.`,
    url,
    context: {
      ...urlRecordContext(record),
      status: response.status,
      location: response.headers.get("location") ?? undefined,
    },
  }];
}

async function auditPageBody(
  record: UrlRecord,
  args: LiveCliArgs,
  fetcher: FetchLike,
  resolveHost: ResolveHostLike,
): Promise<AuditFinding[]> {
  let fetchResult: FetchResult;
  const url = record.url;

  try {
    fetchResult = await fetchLive(fetcher, url, {
      method: "GET",
      headers: {
        "user-agent": args.userAgent,
        "accept": "text/html,application/xhtml+xml,*/*",
      },
    }, args, resolveHost, { followRedirects: true });
  } catch (error) {
    return [{
      code: "LIVE_PAGE_UNREACHABLE",
      severity: "error",
      message: "URL could not be reached for page metadata audit.",
      url,
      context: {
        ...urlRecordContext(record),
        cause: toErrorMessage(error),
      },
    }];
  }

  const { response, finalUrl, redirects } = fetchResult;

  if (!response.ok) {
    await response.body?.cancel();
    return [{
      code: "LIVE_PAGE_STATUS_BAD",
      severity: "error",
      message: `URL returned HTTP ${response.status}; page metadata audit was skipped.`,
      url,
      context: {
        ...urlRecordContext(record),
        status: response.status,
        finalUrl,
        redirects,
      },
    }];
  }

  const bytes = await readResponseBytes(response, args.maxPageBytes);
  const html = new TextDecoder().decode(bytes);
  const findings: AuditFinding[] = [];

  if (args.checkCanonical || args.requireCanonical) {
    findings.push(...auditCanonical(record, response.headers, html, args.requireCanonical, finalUrl, redirects));
  }

  if (args.checkNoindex) {
    findings.push(...auditNoindex(record, response.headers, html, finalUrl, redirects));
  }

  return findings;
}

function auditCanonical(
  record: UrlRecord,
  headers: Headers,
  html: string,
  requireCanonical: boolean,
  finalUrl: string,
  redirects: readonly string[],
): AuditFinding[] {
  const url = record.url;
  const canonicalUrls = [
    ...extractCanonicalFromLinkHeader(headers.get("link")),
    ...extractCanonicalFromHtml(html),
  ];

  if (canonicalUrls.length === 0) {
    return requireCanonical
      ? [{
          code: "LIVE_CANONICAL_MISSING",
          severity: "warning",
          message: "URL does not declare a canonical URL.",
          url,
          context: metadataAuditContext(record, finalUrl, redirects),
        }]
      : [];
  }

  const findings: AuditFinding[] = [];
  const normalizedUrl = normalizeUrlKey(url);

  for (const canonical of canonicalUrls) {
    const resolved = resolveMaybeRelativeUrl(canonical, url);

    if (!resolved) {
      findings.push({
        code: "LIVE_CANONICAL_INVALID",
        severity: "warning",
        message: "Canonical URL could not be parsed.",
        url,
        context: {
          ...metadataAuditContext(record, finalUrl, redirects),
          canonical,
        },
      });
      continue;
    }

    if (normalizeUrlKey(resolved) !== normalizedUrl) {
      findings.push({
        code: "LIVE_CANONICAL_MISMATCH",
        severity: "warning",
        message: "Canonical URL points somewhere other than the sitemap URL.",
        url,
        context: {
          ...metadataAuditContext(record, finalUrl, redirects),
          canonical: resolved,
        },
      });
    }
  }

  return findings;
}

function auditNoindex(
  record: UrlRecord,
  headers: Headers,
  html: string,
  finalUrl: string,
  redirects: readonly string[],
): AuditFinding[] {
  const url = record.url;
  const header = headers.get("x-robots-tag");

  if (containsNoindex(header) || htmlHasNoindex(html)) {
    return [{
      code: "LIVE_NOINDEX",
      severity: "warning",
      message: "URL declares noindex in an X-Robots-Tag header or robots meta tag.",
      url,
      context: {
        ...metadataAuditContext(record, finalUrl, redirects),
        xRobotsTag: header ?? undefined,
      },
    }];
  }

  return [];
}

function metadataAuditContext(record: UrlRecord, finalUrl: string, redirects: readonly string[]): Record<string, unknown> {
  return redirects.length > 0
    ? { ...urlRecordContext(record), finalUrl, redirects }
    : urlRecordContext(record);
}

function extractCanonicalFromLinkHeader(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const canonicals: string[] = [];
  const linkPattern = /<([^>]+)>\s*;\s*([^,]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(value)) !== null) {
    const href = match[1];
    const params = match[2]?.toLowerCase() ?? "";

    if (href && /\brel\s*=\s*"?canonical"?/.test(params)) {
      canonicals.push(href);
    }
  }

  return canonicals;
}

function extractCanonicalFromHtml(html: string): string[] {
  const canonicals: string[] = [];
  const linkPattern = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const tag = match[0];
    const attrs = parseTagAttributes(tag);
    const rel = attrs.get("rel")?.toLowerCase();
    const href = attrs.get("href");

    if (href && rel?.split(/\s+/).includes("canonical")) {
      canonicals.push(href);
    }
  }

  return canonicals;
}

function htmlHasNoindex(html: string): boolean {
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const name = attrs.get("name")?.toLowerCase();
    const httpEquiv = attrs.get("http-equiv")?.toLowerCase();
    const content = attrs.get("content");

    if ((name === "robots" || name === "googlebot" || httpEquiv === "x-robots-tag") && containsNoindex(content)) {
      return true;
    }
  }

  return false;
}

function parseTagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(tag)) !== null) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    if (name) {
      attrs.set(name, value);
    }
  }

  return attrs;
}

async function fetchLive(
  fetcher: FetchLike,
  rawUrl: string,
  init: RequestInit,
  args: LiveCliArgs,
  resolveHost: ResolveHostLike,
  options: LiveFetchOptions,
): Promise<FetchResult> {
  let currentUrl = parseHttpUrlForFetch(rawUrl);
  const redirects: string[] = [];

  while (true) {
    await assertLiveFetchAllowed(currentUrl, args, resolveHost);

    const response = await fetchWithTimeout(fetcher, currentUrl.href, {
      ...init,
      redirect: "manual",
    }, args.timeoutMs);

    if (!options.followRedirects || !isRedirectStatus(response.status)) {
      return {
        response,
        finalUrl: currentUrl.href,
        redirects,
      };
    }

    const location = response.headers.get("location");

    if (!location) {
      return {
        response,
        finalUrl: currentUrl.href,
        redirects,
      };
    }

    await response.body?.cancel();

    if (redirects.length >= args.maxRedirects) {
      throw new Error(`Fetch exceeded ${args.maxRedirects} redirects while loading ${rawUrl}.`);
    }

    currentUrl = parseHttpUrlForFetch(new URL(location, currentUrl).href);
    redirects.push(currentUrl.href);
  }
}

function parseHttpUrlForFetch(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Live fetch URL is not valid: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Live fetch URL must use http:// or https://: ${rawUrl}`);
  }

  if (!parsed.hostname) {
    throw new Error(`Live fetch URL must include a hostname: ${rawUrl}`);
  }

  return parsed;
}

async function assertLiveFetchAllowed(url: URL, args: LiveCliArgs, resolveHost: ResolveHostLike): Promise<void> {
  if (args.allowPrivateHosts) {
    return;
  }

  const hostname = stripIpv6Brackets(url.hostname);

  if (isLocalHostname(hostname)) {
    throw new Error(`Refusing to fetch local hostname ${url.hostname}. Pass --allow-private-hosts only when you trust the target.`);
  }

  if (isIP(hostname)) {
    assertPublicIp(hostname, url.href);
    return;
  }

  const records = await resolveHost(hostname);

  if (records.length === 0) {
    throw new Error(`Hostname ${hostname} did not resolve.`);
  }

  for (const record of records) {
    assertPublicIp(record.address, url.href);
  }
}

async function defaultResolveHost(hostname: string): Promise<readonly { address: string; family: number }[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

function assertPublicIp(address: string, url: string): void {
  if (isNonPublicIp(address)) {
    throw new Error(`Refusing to fetch ${url} because ${address} is private, local, reserved, or non-public. Pass --allow-private-hosts only when you trust the target.`);
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

function isNonPublicIp(address: string): boolean {
  const normalized = normalizeIpAddress(address);
  const version = isIP(normalized);

  if (version === 4) {
    return isNonPublicIpv4(normalized);
  }

  if (version === 6) {
    return isNonPublicIpv6(normalized);
  }

  return true;
}

function normalizeIpAddress(address: string): string {
  const withoutBrackets = stripIpv6Brackets(address.toLowerCase());
  const zoneIndex = withoutBrackets.indexOf("%");
  return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}

function isNonPublicIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  const [first, second, third] = octets;

  if (
    first === undefined
    || second === undefined
    || third === undefined
    || octets.length !== 4
    || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113);
}

function isNonPublicIpv6(address: string): boolean {
  if (address.startsWith("::ffff:")) {
    return isNonPublicIp(address.slice("::ffff:".length));
  }

  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || address.startsWith("fe8")
    || address.startsWith("fe9")
    || address.startsWith("fea")
    || address.startsWith("feb")
    || address.startsWith("ff")
    || address.startsWith("2001:db8");
}

function isRedirectStatus(status: number): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}

async function fetchWithTimeout(fetcher: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetcher(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();

  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > maxBytes) {
      throw new Error(`Response exceeded ${maxBytes} bytes.`);
    }

    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded ${maxBytes} bytes.`);
      }

      chunks.push(value);
    }
  }

  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function shouldTreatAsGzip(url: string, response: Response): boolean {
  const encoding = response.headers.get("content-encoding")?.toLowerCase();

  if (encoding?.includes("gzip")) {
    return false;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  return new URL(url).pathname.endsWith(".gz") || contentType.includes("gzip");
}

function createXmlPolicy(args: LiveCliArgs): CiPolicy {
  const basePolicy = resolveCiPolicy(args.policy);

  return {
    failOn: args.failOn ?? basePolicy.failOn ?? ["error"],
    failOnRules: uniqueList([...(basePolicy.failOnRules ?? []), ...args.failOnRules]),
    allowRules: uniqueList([...(basePolicy.allowRules ?? []), ...args.allowRules]),
    maxWarnings: args.maxWarnings ?? basePolicy.maxWarnings,
  };
}

function createLiveEvaluation(
  xmlEvaluation: CiEvaluation | undefined,
  audits: LiveAuditReport,
  auditFailOn: AuditFailOn,
): LiveCliReport["evaluation"] {
  const xmlPassed = xmlEvaluation?.passed ?? true;
  const auditPassed = isAuditPassed(audits, auditFailOn);
  const failureReasons = [
    ...(xmlEvaluation?.failureReasons ?? []),
    ...auditFailureReasons(audits, auditFailOn),
  ];
  const passed = xmlPassed && auditPassed;

  return {
    passed,
    exitCode: passed ? 0 : 1,
    xmlPassed,
    auditPassed,
    failureReasons,
  };
}

function isAuditPassed(audits: LiveAuditReport, auditFailOn: AuditFailOn): boolean {
  if (auditFailOn === "none") {
    return true;
  }

  if (auditFailOn === "error") {
    return audits.counts.errors === 0;
  }

  return audits.counts.errors === 0 && audits.counts.warnings === 0;
}

function auditFailureReasons(audits: LiveAuditReport, auditFailOn: AuditFailOn): string[] {
  if (auditFailOn === "none") {
    return [];
  }

  const failed = auditFailOn === "error"
    ? audits.counts.errors
    : audits.counts.errors + audits.counts.warnings;

  return failed > 0
    ? [`${failed} live audit finding${failed === 1 ? "" : "s"} matched the audit failure policy.`]
    : [];
}

function formatJsonLiveReport(report: LiveCliReport, args: LiveCliArgs): LiveCliReport | Omit<LiveCliReport, "xml" | "audits"> & {
  xml: Omit<LiveXmlReport, "diagnostics"> & { diagnostics?: SitemapDiagnostic[]; omittedDiagnostics?: number };
  audits: Omit<LiveAuditReport, "findings"> & { findings?: AuditFinding[]; omittedFindings?: number };
} {
  if (args.detail === "full") {
    return report;
  }

  const { diagnostics, ...xml } = report.xml;
  const { findings, ...audits } = report.audits;

  return {
    ...report,
    xml: {
      ...xml,
      omittedDiagnostics: diagnostics.length,
    },
    audits: {
      ...audits,
      omittedFindings: findings.length + audits.omittedFindings,
    },
  };
}

function formatTextLiveReport(report: LiveCliReport): string {
  const xmlSummary = report.xml.summary;
  const lines = [
    `Status: ${report.evaluation.passed ? "passed" : "failed"}`,
    `Target: ${report.target ?? report.urlsFile ?? "(none)"}`,
    `Elapsed: ${report.elapsedMs}ms`,
  ];

  if (report.xml.validationSkipped) {
    lines.push("XML validation: skipped (--urls-file mode)");
  } else if (xmlSummary) {
    lines.push(`XML validation: ${report.xml.evaluation?.passed ? "passed" : "failed"}`);
    lines.push(`Sitemap sources: ${xmlSummary.sources}; URLs: ${xmlSummary.urls}; sitemap entries: ${xmlSummary.sitemaps}`);
    lines.push(`XML diagnostics: ${xmlSummary.diagnostics.errors} errors, ${xmlSummary.diagnostics.warnings} warnings, ${xmlSummary.diagnostics.info} info`);
  }

  const uniqueText = report.audits.uniqueUrls === undefined ? "not measured" : String(report.audits.uniqueUrls);
  lines.push(`Collected URLs: ${report.audits.totalUrls} total, ${uniqueText} unique`);
  lines.push(`Audited URLs: ${report.audits.auditedUrls}`);

  if (report.audits.savedUrlsTo) {
    lines.push(`Saved URLs: ${report.audits.savedUrlsTo}`);
  }

  if (report.audits.savedUrlDetailsTo) {
    lines.push(`Saved URL details: ${report.audits.savedUrlDetailsTo}`);
  }

  lines.push(`Live checks: ${report.audits.enabledChecks.length === 0 ? "(none)" : report.audits.enabledChecks.join(", ")}`);
  lines.push(`Live findings: ${report.audits.counts.errors} errors, ${report.audits.counts.warnings} warnings, ${report.audits.counts.info} info`);

  for (const finding of report.audits.findings.slice(0, 50)) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.code}${finding.url ? ` ${finding.url}` : ""}: ${finding.message}`);
  }

  if (report.audits.findings.length > 50) {
    lines.push(`... ${report.audits.findings.length - 50} more live audit findings omitted.`);
  }

  if (report.audits.omittedFindings > 0) {
    lines.push(`... ${report.audits.omittedFindings} additional live audit findings were not stored. Increase --max-audit-findings for a larger report sample.`);
  }

  for (const reason of report.evaluation.failureReasons) {
    lines.push(`Failure: ${reason}`);
  }

  return `${lines.join("\n")}\n`;
}

function createSkippedXmlReport(): LiveXmlReport {
  return {
    validationSkipped: true,
    summary: undefined,
    sourceSummaries: [],
    diagnosticSummary: {
      total: 0,
      counts: { errors: 0, warnings: 0, info: 0 },
      groups: [],
      omittedGroups: 0,
    },
    diagnostics: [],
    evaluation: undefined,
  };
}

function createFallbackSummary(summaries: readonly ValidationSummary[], diagnostics: readonly SitemapDiagnostic[]): SitemapSetSummary {
  const counts = diagnostics.reduce(
    (total, diagnostic) => {
      if (diagnostic.severity === "error") total.errors += 1;
      if (diagnostic.severity === "warning") total.warnings += 1;
      if (diagnostic.severity === "info") total.info += 1;
      return total;
    },
    { errors: 0, warnings: 0, info: 0 },
  );

  return {
    valid: counts.errors === 0 && summaries.every((summary) => summary.valid),
    sources: summaries.length,
    urls: summaries.reduce((total, summary) => total + summary.urls, 0),
    sitemaps: summaries.reduce((total, summary) => total + summary.sitemaps, 0),
    bytes: summaries.reduce((total, summary) => total + summary.bytes, 0),
    diagnostics: counts,
  };
}

function getEnabledChecks(args: LiveCliArgs): string[] {
  const checks: string[] = [];

  if (args.checkDuplicates) checks.push("duplicates");
  if (args.checkRobots) checks.push("robots");
  if (args.checkStatus) checks.push("status");
  if (args.checkCanonical || args.requireCanonical) checks.push(args.requireCanonical ? "canonical-required" : "canonical");
  if (args.checkNoindex) checks.push("noindex");

  return checks;
}

function shouldLogMilestone(count: number, interval: number): boolean {
  return count > 0 && count % interval === 0;
}

function shouldLogEarlyOrInterval(count: number, interval: number): boolean {
  return count > 0 && (count <= 5 || count % interval === 0);
}

function logAuditUrlProgress(logger: LiveProgressLogger, label: string, count: number, previousCount: number): void {
  if (Math.floor(count / AUDIT_URL_LOG_INTERVAL) > Math.floor(previousCount / AUDIT_URL_LOG_INTERVAL)) {
    logger.info(`${label} checked ${formatCount(count)} URLs.`);
  }
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function invalidAuditUrlFinding(input: string | UrlRecord): AuditFinding {
  const record = typeof input === "string"
    ? { url: input, sourceSitemap: undefined }
    : input;

  return {
    code: "LIVE_URL_INVALID",
    severity: "error",
    message: "URL from sitemap URL list is not a valid absolute URL.",
    url: record.url,
    context: urlRecordContext(record),
  };
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

function resolveMaybeRelativeUrl(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function containsNoindex(value: string | null | undefined): boolean {
  return value?.toLowerCase().split(",").some((part) => part.trim() === "noindex") ?? false;
}

function uniqueList<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];

      if (value !== undefined) {
        results[index] = await mapper(value, index);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function defaultLiveCliArgs(): LiveCliArgs {
  return {
    target: undefined,
    urlsFile: undefined,
    sourceId: undefined,
    sitemapLocation: undefined,
    gzip: undefined,
    localSitemapRoot: undefined,
    publicUrlPrefix: undefined,
    saveUrls: undefined,
    saveUrlDetails: undefined,
    help: false,
    quiet: false,
    format: "text",
    output: undefined,
    detail: "grouped",
    policy: "ciDefault",
    failOn: undefined,
    failOnRules: [],
    allowRules: [],
    maxWarnings: undefined,
    maxDepth: DEFAULT_MAX_DEPTH,
    maxSources: DEFAULT_MAX_SOURCES,
    loaderConcurrency: DEFAULT_LOADER_CONCURRENCY,
    auditConcurrency: DEFAULT_AUDIT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxSitemapBytes: DEFAULT_MAX_SITEMAP_BYTES,
    maxPageBytes: DEFAULT_MAX_PAGE_BYTES,
    maxRobotsBytes: DEFAULT_MAX_ROBOTS_BYTES,
    maxAuditUrls: DEFAULT_MAX_AUDIT_URLS,
    maxAuditFindings: DEFAULT_MAX_AUDIT_FINDINGS,
    maxRedirects: DEFAULT_MAX_REDIRECTS,
    userAgent: USER_AGENT_PRESETS["googlebot-smartphone"].requestUserAgent,
    robotsUserAgent: USER_AGENT_PRESETS["googlebot-smartphone"].robotsUserAgent,
    userAgentPreset: "googlebot-smartphone",
    auditFailOn: "error",
    statusMethod: "head",
    allowPrivateHosts: false,
    checkDuplicates: false,
    checkRobots: false,
    checkStatus: false,
    checkCanonical: false,
    requireCanonical: false,
    checkNoindex: false,
  };
}

function writeLiveUsage(output: WritableLike): void {
  output.write(`Validate a live or local sitemap, then optionally run URL audits.

Usage:
  sitemap-validator-live <sitemap-url-or-file> [options]
  sitemap-validator-live --urls-file <file> [audit options]

Examples:
  sitemap-validator-live ./downloads/sitemap.xml --sitemap-location https://example.com/sitemap.xml --save-urls sitemap-urls.txt
  sitemap-validator-live https://example.com/sitemap.xml --check-status --check-canonical --check-noindex
  sitemap-validator-live --urls-file sitemap-urls.txt --check-status --check-robots --check-duplicates

XML validation options:
  --policy <preset>                 ciDefault, strict, protocolOnly, googleCompatible. Default: ciDefault.
  --fail-on <list|none>             XML diagnostic failure severities.
  --fail-on-rule <code[,code]>      Fail XML validation when specific rule codes are present.
  --allow-rule <code[,code]>        Ignore specific XML rule codes for CI policy.
  --max-warnings <n>                Fail XML validation when warnings exceed this value.
  --sitemap-location <url>          Public location for a local sitemap file.
  --public-url-prefix <url>         Public URL prefix used by local child sitemap <loc> values.
  --local-sitemap-root <dir>        Local directory containing downloaded child sitemap files.
  --source-id <value>               Override local root source id.
  --gzip | --no-gzip                Override gzip detection for the root sitemap.
  --max-depth <n>                   Sitemap index traversal depth. Default: ${DEFAULT_MAX_DEPTH}.
  --max-sources <n>                 Max sitemap files to validate. Default: ${DEFAULT_MAX_SOURCES}.
  --loader-concurrency <n>          Child sitemap load concurrency. Default: ${DEFAULT_LOADER_CONCURRENCY}.

URL list options:
  --save-urls <file>                Save collected sitemap URLs, one per line.
  --save-url-details <file>         Save JSONL records with each URL and source sitemap.
  --urls-file <file>                Run audits from a saved URL list; skips XML validation.

Opt-in live audit options:
  --check-duplicates                Report duplicate URLs in the collected URL list.
  --check-robots                    Check URLs against each origin's robots.txt.
  --check-status                    Check page URL HTTP status.
  --check-canonical                 Check declared canonical URLs when present.
  --require-canonical               Also warn when a page has no canonical URL.
  --check-noindex                   Check X-Robots-Tag and robots meta noindex.
  --all-audits                      Enable duplicates, robots, status, canonical, and noindex.
  --audit-fail-on <none|error|warning>
                                    Default: error.
  --max-audit-urls <n>              Max unique URLs for live audits. Default: ${DEFAULT_MAX_AUDIT_URLS}; 0 means all.
  --max-audit-findings <n>          Max live findings to include in reports. Default: ${DEFAULT_MAX_AUDIT_FINDINGS}.
  --audit-concurrency <n>           Page audit concurrency. Default: ${DEFAULT_AUDIT_CONCURRENCY}.
  --status-method <head|get>        Default: head.

Fetch limits:
  --timeout-ms <n>                  Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}.
  --max-redirects <n>               Max guarded redirects for sitemap/page fetches. Default: ${DEFAULT_MAX_REDIRECTS}.
  --max-sitemap-bytes <n>           Max sitemap response bytes. Default: ${DEFAULT_MAX_SITEMAP_BYTES}.
  --max-page-bytes <n>              Max page body bytes for metadata checks. Default: ${DEFAULT_MAX_PAGE_BYTES}.
  --max-robots-bytes <n>            Max robots.txt bytes. Default: ${DEFAULT_MAX_ROBOTS_BYTES}.
  --allow-private-hosts             Allow private, loopback, link-local, and local hosts.
  --user-agent <value>              Override HTTP request user-agent header.
  --robots-user-agent <value>       Override robots.txt matching token. Default: Googlebot.
  --user-agent-preset <name>        ${USER_AGENT_PRESET_CHOICES.join(", ")}.
                                    Default: googlebot-smartphone.

Report options:
  --json | --text                   Output format. Default: text.
  --format <text|json>              Output format.
  --output <path>                   Write report to a file.
  --detail <summary|grouped|full>   Default: grouped.
  --quiet                           Suppress progress logs on stderr.
  --help                            Show this help.
`);
}

function splitFlag(rawValue: string): { flag: string; inlineValue: string | undefined } {
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

function rejectInlineValue(flag: string, inlineValue: string | undefined): void {
  if (inlineValue !== undefined) {
    throw new LiveCliUsageError(`${flag} does not accept a value.`);
  }
}

function requireValue(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue: string | undefined,
): { value: string; index: number } {
  if (inlineValue !== undefined) {
    if (inlineValue.length === 0) {
      throw new LiveCliUsageError(`${flag} requires a value.`);
    }

    return {
      value: inlineValue,
      index,
    };
  }

  const next = argv[index + 1];

  if (!next || next.startsWith("--")) {
    throw new LiveCliUsageError(`${flag} requires a value.`);
  }

  return {
    value: next,
    index: index + 1,
  };
}

function requireNumber(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue: string | undefined,
): { value: number; index: number } {
  const parsed = requireValue(argv, index, flag, inlineValue);
  const value = Number(parsed.value);

  if (!Number.isFinite(value) || value < 0) {
    throw new LiveCliUsageError(`${flag} requires a non-negative number.`);
  }

  return {
    value: Math.floor(value),
    index: parsed.index,
  };
}

function requireChoice<const T extends readonly string[]>(
  argv: readonly string[],
  index: number,
  flag: string,
  choices: T,
  inlineValue: string | undefined,
): { value: T[number]; index: number } {
  const parsed = requireValue(argv, index, flag, inlineValue);

  if (!isChoice(parsed.value, choices)) {
    throw new LiveCliUsageError(`${flag} must be one of: ${choices.join(", ")}.`);
  }

  return {
    value: parsed.value,
    index: parsed.index,
  };
}

function isChoice<const T extends readonly string[]>(value: string, choices: T): value is T[number] {
  return choices.includes(value);
}

function parseFailOn(value: string): readonly DiagnosticSeverity[] {
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
  const parsed: DiagnosticSeverity[] = [];

  for (const severity of severities) {
    if (severity !== "error" && severity !== "warning" && severity !== "info") {
      throw new LiveCliUsageError("--fail-on must be none or a comma-separated list of: error, warning, info.");
    }

    if (!parsed.includes(severity)) {
      parsed.push(severity);
    }
  }

  if (parsed.length === 0) {
    throw new LiveCliUsageError("--fail-on requires at least one severity or none.");
  }

  return parsed;
}

function parseList(value: string): string[] {
  const parts = value.split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new LiveCliUsageError("List value must contain at least one item.");
  }

  return parts;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveLocalPath(target: string): string {
  try {
    const url = new URL(target);

    if (url.protocol === "file:") {
      return fileURLToPath(url);
    }
  } catch {
    return resolve(target);
  }

  return resolve(target);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveCli().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
