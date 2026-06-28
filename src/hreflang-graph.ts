import { getRuleDefinition } from "./rules.js";
import type { HreflangAlternate, HreflangGraphOptions, SitemapDiagnostic, SitemapSetOptions } from "./types.js";

export interface HreflangGraphRecord {
  sourceId: string;
  loc: string;
  alternates: readonly HreflangAlternate[];
}

export const DEFAULT_HREFLANG_GRAPH_OPTIONS: Required<HreflangGraphOptions> = {
  requireAllAlternateUrls: true,
  requireReturnLinks: true,
  requireConsistentAlternates: true,
  maxEntries: 100_000,
  maxDiagnostics: 1_000,
};

export function resolveHreflangGraphOptions(
  value: SitemapSetOptions["hreflangGraph"],
): Required<HreflangGraphOptions> | undefined {
  if (!value) {
    return undefined;
  }

  if (value === true) {
    return DEFAULT_HREFLANG_GRAPH_OPTIONS;
  }

  return {
    ...DEFAULT_HREFLANG_GRAPH_OPTIONS,
    ...value,
  };
}

export function validateHreflangGraph(
  records: readonly HreflangGraphRecord[],
  graphOptions: Required<HreflangGraphOptions>,
  options: SitemapSetOptions,
): SitemapDiagnostic[] {
  const diagnostics: SitemapDiagnostic[] = [];
  const byLoc = new Map<string, HreflangGraphRecord>();
  const maxDiagnostics = graphOptions.maxDiagnostics ?? 1_000;

  for (const record of records) {
    byLoc.set(normalizeUrlKey(record.loc), record);
  }

  const emitted = new Set<string>();

  for (const record of records) {
    if (record.alternates.length === 0) {
      continue;
    }

    if (diagnostics.length >= maxDiagnostics) {
      break;
    }

    const sourceLoc = normalizeUrlKey(record.loc);
    const sourceSet = alternateUrlSignature(record);

    for (const alternate of record.alternates) {
      if (diagnostics.length >= maxDiagnostics) {
        break;
      }

      const alternateLoc = normalizeUrlKey(alternate.href);
      const target = byLoc.get(alternateLoc);

      if (!target) {
        if (graphOptions.requireAllAlternateUrls) {
          addGraphDiagnostic(
            diagnostics,
            emitted,
            createGraphDiagnostic(
              record.sourceId,
              "GOOGLE_HREFLANG_ALTERNATE_URL_MISSING",
              "An hreflang alternate URL was not present as a url entry in the validated sitemap set.",
              { loc: record.loc, hreflang: alternate.hreflang, href: alternate.href },
              options,
            ),
            options,
          );
        }
        continue;
      }

      if (graphOptions.requireReturnLinks && !hasAlternateHref(target, sourceLoc)) {
        addGraphDiagnostic(
          diagnostics,
          emitted,
          createGraphDiagnostic(
            record.sourceId,
            "GOOGLE_HREFLANG_RETURN_LINK_MISSING",
            "An hreflang alternate URL does not include a return link to the source URL.",
            { loc: record.loc, href: alternate.href, targetSourceId: target.sourceId },
            options,
          ),
          options,
        );
      }

      if (graphOptions.requireConsistentAlternates && alternateUrlSignature(target) !== sourceSet) {
        addGraphDiagnostic(
          diagnostics,
          emitted,
          createGraphDiagnostic(
            record.sourceId,
            "GOOGLE_HREFLANG_ALTERNATE_SET_MISMATCH",
            "Localized URL entries should list the same complete hreflang alternate URL set.",
            { loc: record.loc, href: alternate.href, targetSourceId: target.sourceId },
            options,
          ),
          options,
        );
      }
    }
  }

  return diagnostics;
}

function createGraphDiagnostic(
  sourceId: string,
  code: string,
  message: string,
  context: Record<string, unknown>,
  options: SitemapSetOptions,
): SitemapDiagnostic {
  const definition = getRuleDefinition(code);
  const severity = options.severityOverrides?.[code] ?? "error";

  return {
    code,
    severity,
    source: definition?.source ?? "google",
    message,
    sourceId,
    spec: definition?.spec,
    context,
  };
}

function addGraphDiagnostic(
  diagnostics: SitemapDiagnostic[],
  emitted: Set<string>,
  diagnostic: SitemapDiagnostic,
  options: SitemapSetOptions,
): void {
  const key = `${diagnostic.code}:${diagnostic.context?.loc ?? ""}:${diagnostic.context?.href ?? ""}`;

  if (emitted.has(key) || !isGraphDiagnosticEnabled(options, diagnostic)) {
    return;
  }

  emitted.add(key);
  diagnostics.push(diagnostic);
}

function isGraphDiagnosticEnabled(options: SitemapSetOptions, diagnostic: SitemapDiagnostic): boolean {
  if (options.disabledRules?.includes(diagnostic.code)) {
    return false;
  }

  if (options.google === false) {
    return false;
  }

  return !options.extensions || options.extensions.includes("hreflang");
}

function alternateUrlSignature(record: HreflangGraphRecord): string {
  return [...new Set(record.alternates.map((alternate) => normalizeUrlKey(alternate.href)))].sort().join("\n");
}

function hasAlternateHref(record: HreflangGraphRecord, href: string): boolean {
  return record.alternates.some((alternate) => normalizeUrlKey(alternate.href) === href);
}

function normalizeUrlKey(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}
