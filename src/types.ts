export type DiagnosticSeverity = "error" | "warning" | "info";

export type RuleSource =
  | "xml"
  | "xml-namespaces"
  | "rfc3986"
  | "rfc3987"
  | "sitemaps.org"
  | "google";

export interface SourceLocation {
  line?: number | undefined;
  column?: number | undefined;
  position?: number | undefined;
  path?: string | undefined;
}

export interface SitemapDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  source: RuleSource;
  message: string;
  sourceId?: string | undefined;
  location?: SourceLocation | undefined;
  spec?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export interface HreflangAlternate {
  hreflang: string;
  href: string;
}

export interface HreflangGraphOptions {
  requireAllAlternateUrls?: boolean | undefined;
  requireReturnLinks?: boolean | undefined;
  requireConsistentAlternates?: boolean | undefined;
  maxEntries?: number | undefined;
  maxDiagnostics?: number | undefined;
}

export type HreflangGraphValidation = boolean | HreflangGraphOptions;

export type SitemapExtension = "image" | "news" | "video" | "pagemap" | "hreflang";

export type SitemapInput =
  | string
  | Uint8Array
  | ArrayBuffer
  | Iterable<string | Uint8Array | ArrayBuffer>
  | AsyncIterable<string | Uint8Array | ArrayBuffer>
  | {
      path: string;
      sourceId?: string;
      gzip?: boolean;
    };

export interface ValidationLimits {
  maxUrlsPerSitemap: number;
  maxSitemapsPerIndex: number;
  maxUncompressedBytes: number;
  maxLocLength: number;
  maxImagesPerUrl: number;
  maxNewsEntriesPerSitemap: number;
}

export interface ValidationOptions {
  sourceId?: string | undefined;
  sitemapLocation?: string | undefined;
  gzip?: boolean | undefined;
  google?: boolean | undefined;
  extensions?: readonly SitemapExtension[] | undefined;
  disabledRules?: readonly string[] | undefined;
  severityOverrides?: Readonly<Record<string, DiagnosticSeverity>> | undefined;
  limits?: Partial<ValidationLimits> | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((event: ValidationEvent) => void) | undefined;
}

export interface ValidationSummary {
  valid: boolean;
  sourceId: string;
  rootType?: "urlset" | "sitemapindex" | undefined;
  urls: number;
  sitemaps: number;
  sitemapLocations: string[];
  bytes: number;
  diagnostics: {
    errors: number;
    warnings: number;
    info: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  sourceId: string;
  diagnostics: SitemapDiagnostic[];
  summary: ValidationSummary;
}

export type ValidationEvent =
  | {
      type: "source:start";
      sourceId: string;
    }
  | {
      type: "source:bytes";
      sourceId: string;
      bytes: number;
    }
  | {
      type: "sitemap:url";
      sourceId: string;
      count: number;
      loc?: string | undefined;
      hreflangs?: readonly HreflangAlternate[] | undefined;
    }
  | {
      type: "sitemap:entry";
      sourceId: string;
      count: number;
      loc?: string | undefined;
    }
  | {
      type: "diagnostic";
      sourceId: string;
      diagnostic: SitemapDiagnostic;
    }
  | {
      type: "source:discover";
      sourceId: string;
      parentSourceId: string;
      loc: string;
      depth: number;
    }
  | {
      type: "source:finish";
      sourceId: string;
      summary: ValidationSummary;
    }
  | {
      type: "summary";
      sourceId: string;
      summary: ValidationSummary;
    }
  | {
      type: "set:summary";
      sourceId: string;
      summary: SitemapSetSummary;
    };

export interface SitemapLoadRequest {
  loc: string;
  parentSourceId: string;
  depth: number;
}

export interface SitemapLoadedSource {
  input: SitemapInput;
  sourceId?: string | undefined;
  sitemapLocation?: string | undefined;
  gzip?: boolean | undefined;
}

export type SitemapLoader = (request: SitemapLoadRequest) => Promise<SitemapLoadedSource | null | undefined>;

export interface SitemapSetOptions extends ValidationOptions {
  loader?: SitemapLoader | undefined;
  maxDepth?: number | undefined;
  maxSources?: number | undefined;
  loaderConcurrency?: number | undefined;
  hreflangGraph?: HreflangGraphValidation | undefined;
}

export interface SitemapSetSummary {
  valid: boolean;
  sources: number;
  urls: number;
  sitemaps: number;
  bytes: number;
  diagnostics: {
    errors: number;
    warnings: number;
    info: number;
  };
}

export interface SitemapSetResult {
  valid: boolean;
  diagnostics: SitemapDiagnostic[];
  summaries: ValidationSummary[];
  summary: SitemapSetSummary;
}

export const DEFAULT_LIMITS: ValidationLimits = {
  maxUrlsPerSitemap: 50_000,
  maxSitemapsPerIndex: 50_000,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxLocLength: 2_048,
  maxImagesPerUrl: 1_000,
  maxNewsEntriesPerSitemap: 1_000,
};
