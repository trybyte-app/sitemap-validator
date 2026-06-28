import { validateSitemapEvents } from "./validator.js";
import { resolveHreflangGraphOptions, validateHreflangGraph } from "./hreflang-graph.js";
import { getRuleDefinition } from "./rules.js";
import type { HreflangGraphRecord } from "./hreflang-graph.js";
import type {
  SitemapDiagnostic,
  SitemapInput,
  SitemapLoadedSource,
  SitemapSetOptions,
  SitemapSetResult,
  SitemapSetSummary,
  ValidationEvent,
  ValidationOptions,
  ValidationSummary,
} from "./types.js";

interface LoadedQueueItem {
  kind: "loaded";
  input: SitemapInput;
  options: ValidationOptions;
  depth: number;
}

interface PendingQueueItem extends ChildCandidate {
  kind: "pending";
}

type QueueItem = LoadedQueueItem | PendingQueueItem;

interface ChildCandidate {
  loc: string;
  parentSourceId: string;
  depth: number;
}

interface ChildLoadOutcome extends ChildCandidate {
  loaded?: SitemapLoadedSource | null | undefined;
  diagnostic?: SitemapDiagnostic | undefined;
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_SOURCES = 10_000;
const DEFAULT_LOADER_CONCURRENCY = 1;

export async function validateSitemapSet(input: SitemapInput, options: SitemapSetOptions = {}): Promise<SitemapSetResult> {
  const diagnostics: SitemapDiagnostic[] = [];
  const summaries: ValidationSummary[] = [];
  const setDiagnostics: SitemapDiagnostic[] = [];
  let summary: SitemapSetSummary | undefined;

  for await (const event of validateSitemapSetEvents(input, options)) {
    if (event.type === "diagnostic") {
      diagnostics.push(event.diagnostic);
    }

    if (event.type === "source:finish") {
      summaries.push(event.summary);
    }

    if (event.type === "set:summary") {
      summary = event.summary;
    }
  }

  summary ??= toSetSummary(summaries, setDiagnostics);

  return {
    valid: summary.valid,
    diagnostics,
    summaries,
    summary,
  };
}

export async function* validateSitemapSetEvents(
  input: SitemapInput,
  options: SitemapSetOptions = {},
): AsyncGenerator<ValidationEvent, void, void> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const queue = new WorkQueue<QueueItem>([
    {
      kind: "loaded",
      input,
      options,
      depth: 0,
    },
  ]);
  const summaries: ValidationSummary[] = [];
  const setDiagnostics: SitemapDiagnostic[] = [];
  let processed = 0;
  const visitedLocations = new Set<string>();
  const loaderConcurrency = normalizeConcurrency(options.loaderConcurrency ?? DEFAULT_LOADER_CONCURRENCY);
  const hreflangGraphOptions = resolveHreflangGraphOptions(options.hreflangGraph);
  const hreflangGraphMaxEntries = hreflangGraphOptions?.maxEntries ?? 0;
  const hreflangGraphRecords: HreflangGraphRecord[] = [];
  let hreflangGraphLimitEmitted = false;

  if (options.sitemapLocation) {
    visitedLocations.add(options.sitemapLocation);
  }

  while (queue.length > 0) {
    options.signal?.throwIfAborted();

    if (processed >= maxSources) {
      const parent = queue.peek();
      const sourceId = parent ? queueItemSourceId(parent) : "sitemap-set";
      const diagnostic = createSetDiagnostic(
        sourceId,
        "SITEMAP_SET_SOURCE_LIMIT_EXCEEDED",
        "error",
        `Sitemap set validation stopped after reaching the ${maxSources} source limit.`,
        undefined,
        options,
      );
      if (isSetDiagnosticEnabled(options, diagnostic)) {
        setDiagnostics.push(diagnostic);
        yield emitSetEvent(options, {
          type: "diagnostic",
          sourceId,
          diagnostic,
        });
      }
      break;
    }

    const item = queue.shift();

    if (!item) {
      break;
    }

    if (item.kind === "pending") {
      const pendingBatch = takePendingBatch(item, queue, loaderConcurrency);
      const loadedBatch = await loadPendingBatch(pendingBatch, options);
      const loadedQueueItems: LoadedQueueItem[] = [];

      for (const outcome of loadedBatch) {
        options.signal?.throwIfAborted();

        if (outcome.diagnostic) {
          setDiagnostics.push(outcome.diagnostic);
          yield emitSetEvent(options, {
            type: "diagnostic",
            sourceId: outcome.parentSourceId,
            diagnostic: outcome.diagnostic,
          });
          continue;
        }

        if (!outcome.loaded) {
          continue;
        }

        const childOptions = toChildOptions(options, outcome.loaded, outcome.loc);
        yield emitSetEvent(options, {
          type: "source:discover",
          sourceId: childOptions.sourceId ?? outcome.loc,
          parentSourceId: outcome.parentSourceId,
          loc: outcome.loc,
          depth: outcome.depth,
        });

        loadedQueueItems.push({
          kind: "loaded",
          input: outcome.loaded.input,
          options: childOptions,
          depth: outcome.depth,
        });
      }

      queue.prepend(loadedQueueItems);
      continue;
    }

    processed += 1;

    let itemSummary: ValidationSummary | undefined;
    for await (const event of validateSitemapEvents(item.input, item.options)) {
      if (event.type === "summary") {
        itemSummary = event.summary;
      }

      yield event;

      if (event.type === "sitemap:url" && event.loc) {
        if (hreflangGraphOptions) {
          if (hreflangGraphRecords.length < hreflangGraphMaxEntries) {
            hreflangGraphRecords.push({
              sourceId: event.sourceId,
              loc: event.loc,
              alternates: event.hreflangs ?? [],
            });
          } else if (!hreflangGraphLimitEmitted) {
            hreflangGraphLimitEmitted = true;
            const diagnostic = createSetDiagnostic(
              event.sourceId,
              "GOOGLE_HREFLANG_GRAPH_LIMIT_EXCEEDED",
              "warning",
              `Hreflang graph validation stopped collecting entries after ${hreflangGraphMaxEntries} URLs.`,
              { maxEntries: hreflangGraphMaxEntries },
              options,
            );
            if (isSetDiagnosticEnabled(options, diagnostic)) {
              setDiagnostics.push(diagnostic);
              yield emitSetEvent(options, {
                type: "diagnostic",
                sourceId: event.sourceId,
                diagnostic,
              });
            }
          }
        }
      }
    }

    if (!itemSummary) {
      continue;
    }

    summaries.push(itemSummary);

    if (itemSummary.rootType !== "sitemapindex" || item.depth >= maxDepth || !options.loader) {
      continue;
    }

    const childOutcomes = discoverChildSitemaps(itemSummary, item.depth, {
      options,
      visitedLocations,
      maxDepth,
    });

    for (const outcome of childOutcomes) {
      options.signal?.throwIfAborted();

      if (outcome.diagnostic) {
        setDiagnostics.push(outcome.diagnostic);
        yield emitSetEvent(options, {
          type: "diagnostic",
          sourceId: itemSummary.sourceId,
          diagnostic: outcome.diagnostic,
        });
        continue;
      }

      queue.push({
        kind: "pending",
        loc: outcome.loc,
        parentSourceId: outcome.parentSourceId,
        depth: outcome.depth,
      });
    }
  }

  if (hreflangGraphOptions) {
    for (const diagnostic of validateHreflangGraph(hreflangGraphRecords, hreflangGraphOptions, options)) {
      setDiagnostics.push(diagnostic);
      yield emitSetEvent(options, {
        type: "diagnostic",
        sourceId: diagnostic.sourceId ?? options.sourceId ?? "sitemap-set",
        diagnostic,
      });
    }
  }

  const summary = toSetSummary(summaries, setDiagnostics);
  yield emitSetEvent(options, {
    type: "set:summary",
    sourceId: options.sourceId ?? "sitemap-set",
    summary,
  });
}

function emitSetEvent(options: SitemapSetOptions, event: ValidationEvent): ValidationEvent {
  options.onProgress?.(event);
  return event;
}

interface LoadChildrenContext {
  options: SitemapSetOptions;
  visitedLocations: Set<string>;
  maxDepth: number;
}

function discoverChildSitemaps(
  summary: ValidationSummary,
  parentDepth: number,
  context: LoadChildrenContext,
): ChildLoadOutcome[] {
  const outcomes: ChildLoadOutcome[] = [];
  const depth = parentDepth + 1;

  if (parentDepth >= context.maxDepth || !context.options.loader) {
    return outcomes;
  }

  for (const loc of summary.sitemapLocations) {
    if (context.visitedLocations.has(loc)) {
      continue;
    }

    context.visitedLocations.add(loc);
    outcomes.push({
      loc,
      parentSourceId: summary.sourceId,
      depth,
    });
  }

  return outcomes;
}

function takePendingBatch(first: PendingQueueItem, queue: WorkQueue<QueueItem>, concurrency: number): PendingQueueItem[] {
  const batch = [first];

  while (batch.length < concurrency && queue.peek()?.kind === "pending") {
    const item = queue.shift();
    if (item?.kind === "pending") {
      batch.push(item);
    }
  }

  return batch;
}

class WorkQueue<T> {
  private readonly front: T[] = [];
  private readonly back: T[];
  private backHead = 0;

  constructor(items: readonly T[]) {
    this.back = [...items];
  }

  get length(): number {
    return this.front.length + this.back.length - this.backHead;
  }

  shift(): T | undefined {
    const frontItem = this.front.pop();

    if (frontItem !== undefined) {
      return frontItem;
    }

    const item = this.back[this.backHead];

    if (item === undefined) {
      return undefined;
    }

    this.backHead += 1;
    this.compactBackIfNeeded();

    return item;
  }

  push(item: T): void {
    this.back.push(item);
  }

  prepend(items: readonly T[]): void {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];

      if (item !== undefined) {
        this.front.push(item);
      }
    }
  }

  peek(): T | undefined {
    return this.front.at(-1) ?? this.back[this.backHead];
  }

  private compactBackIfNeeded(): void {
    if (this.backHead < 1_024 || this.backHead * 2 < this.back.length) {
      return;
    }

    this.back.splice(0, this.backHead);
    this.backHead = 0;
  }
}

function queueItemSourceId(item: QueueItem): string {
  return item.kind === "loaded"
    ? item.options.sourceId ?? "sitemap-set"
    : item.parentSourceId;
}

async function loadPendingBatch(pending: readonly PendingQueueItem[], options: SitemapSetOptions): Promise<ChildLoadOutcome[]> {
  return Promise.all(pending.map((candidate) => loadChildSitemap(candidate, options)));
}

async function loadChildSitemap(candidate: ChildCandidate, options: SitemapSetOptions): Promise<ChildLoadOutcome> {
  if (!options.loader) {
    return candidate;
  }

  let loaded: SitemapLoadedSource | null | undefined;
  try {
    loaded = await options.loader({
      loc: candidate.loc,
      parentSourceId: candidate.parentSourceId,
      depth: candidate.depth,
    });
  } catch (error) {
    const diagnostic = createSetDiagnostic(
      candidate.parentSourceId,
      "SITEMAP_CHILD_LOAD_FAILED",
      "error",
      "A sitemap index child loader threw while loading a child sitemap.",
      {
        loc: candidate.loc,
        depth: candidate.depth,
        cause: error instanceof Error ? error.message : String(error),
      },
      options,
    );

    return isSetDiagnosticEnabled(options, diagnostic)
      ? { ...candidate, diagnostic }
      : candidate;
  }

  if (!loaded) {
    const diagnostic = createSetDiagnostic(
      candidate.parentSourceId,
      "SITEMAP_CHILD_NOT_LOADED",
      "warning",
      "A sitemap index child location was discovered but the loader did not return a source.",
      { loc: candidate.loc, depth: candidate.depth },
      options,
    );

    return isSetDiagnosticEnabled(options, diagnostic)
      ? { ...candidate, diagnostic }
      : candidate;
  }

  return {
    ...candidate,
    loaded,
  };
}

function createSetDiagnostic(
  sourceId: string,
  code: string,
  severity: SitemapDiagnostic["severity"],
  message: string,
  context?: Record<string, unknown>,
  options?: SitemapSetOptions,
): SitemapDiagnostic {
  const definition = getRuleDefinition(code);
  const severityOverride = options?.severityOverrides?.[code];

  return {
    code,
    severity: severityOverride ?? severity,
    source: definition?.source ?? "sitemaps.org",
    message,
    sourceId,
    spec: definition?.spec,
    context,
  };
}

function isSetDiagnosticEnabled(options: SitemapSetOptions, diagnostic: SitemapDiagnostic): boolean {
  if (options.disabledRules?.includes(diagnostic.code)) {
    return false;
  }

  if (diagnostic.source === "google" && options.google === false) {
    return false;
  }

  if (diagnostic.code.startsWith("GOOGLE_HREFLANG_") && options.extensions && !options.extensions.includes("hreflang")) {
    return false;
  }

  return true;
}

function toChildOptions(options: SitemapSetOptions, loaded: SitemapLoadedSource, loc: string): ValidationOptions {
  return {
    sourceId: loaded.sourceId ?? loc,
    sitemapLocation: loaded.sitemapLocation ?? loc,
    gzip: loaded.gzip ?? loc.endsWith(".gz"),
    google: options.google,
    extensions: options.extensions,
    disabledRules: options.disabledRules,
    severityOverrides: options.severityOverrides,
    limits: options.limits,
    signal: options.signal,
    onProgress: options.onProgress,
  };
}

function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

function toSetSummary(summaries: ValidationSummary[], extraDiagnostics: SitemapDiagnostic[] = []): SitemapSetSummary {
  const diagnostics = summaries.reduce(
    (total, summary) => ({
      errors: total.errors + summary.diagnostics.errors,
      warnings: total.warnings + summary.diagnostics.warnings,
      info: total.info + summary.diagnostics.info,
    }),
    { errors: 0, warnings: 0, info: 0 },
  );

  for (const diagnostic of extraDiagnostics) {
    if (diagnostic.severity === "error") diagnostics.errors += 1;
    if (diagnostic.severity === "warning") diagnostics.warnings += 1;
    if (diagnostic.severity === "info") diagnostics.info += 1;
  }

  return {
    valid: diagnostics.errors === 0,
    sources: summaries.length,
    urls: summaries.reduce((total, summary) => total + summary.urls, 0),
    sitemaps: summaries.reduce((total, summary) => total + summary.sitemaps, 0),
    bytes: summaries.reduce((total, summary) => total + summary.bytes, 0),
    diagnostics,
  };
}
