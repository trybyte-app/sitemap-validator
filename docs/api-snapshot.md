# Public API Snapshot

Generated from `dist/index.d.ts` and the declaration files it references.
Run `npm run api:snapshot` after intentional public API changes.
Run `npm run api:check` in CI before release.

Entry: `dist/index.d.ts`

## Declaration Files

- `dist/index.d.ts`
- `dist/ci.d.ts`
- `dist/loaders.d.ts`
- `dist/memory-loader.d.ts`
- `dist/report.d.ts`
- `dist/rules.d.ts`
- `dist/set.d.ts`
- `dist/types.d.ts`
- `dist/url.d.ts`
- `dist/validator.d.ts`

## `dist/index.d.ts`

```ts
import "./node-input.js";
export { validateSitemap, validateSitemapEvents, } from "./validator.js";
export { validateSitemapSet, validateSitemapSetEvents, } from "./set.js";
export { createLocalSitemapLoader, createMemorySitemapLoader, } from "./loaders.js";
export { createJsonReport, createTextReport, countDiagnostics, createDiagnosticSummaryBuilder, getDiagnosticFingerprint, groupDiagnosticsByCode, groupDiagnosticsBySeverity, groupDiagnosticsBySource, summarizeDiagnostics, } from "./report.js";
export { assertValidForCi, CI_POLICY_PRESETS, evaluateForCi, getCiPolicyPreset, resolveCiPolicy, SitemapValidationError, } from "./ci.js";
export { getRuleDefinition, listRuleDefinitions, RULE_DEFINITIONS, } from "./rules.js";
export { validateSitemapUrlValue, } from "./url.js";
export { DEFAULT_LIMITS, type DiagnosticSeverity, type HreflangAlternate, type HreflangGraphOptions, type HreflangGraphValidation, type RuleSource, type SitemapDiagnostic, type SitemapInput, type SitemapExtension, type SitemapLoadRequest, type SitemapLoadedSource, type SitemapLoader, type SitemapSetOptions, type SitemapSetResult, type SitemapSetSummary, type SourceLocation, type ValidationEvent, type ValidationLimits, type ValidationOptions, type ValidationResult, type ValidationSummary, } from "./types.js";
export type { LocalSitemapLoaderOptions, MemorySitemapLoaderOptions, } from "./loaders.js";
export type { DiagnosticCounts, DiagnosticGroup, DiagnosticGroupMode, DiagnosticSummary, DiagnosticSummaryBuilder, DiagnosticSummaryGroup, DiagnosticSummaryOptions, JsonReportOptions, ReportDetailLevel, TextReportOptions, } from "./report.js";
export type { CiEvaluation, CiPolicy, CiPolicyPreset, } from "./ci.js";
export type { RuleCode, RuleDefinition, } from "./rules.js";
export type { UrlValidationOptions, UrlValidationLayer, UrlValidationMetadata, UrlValidationResult, } from "./url.js";
```

## `dist/ci.d.ts`

```ts
import type { DiagnosticSeverity, SitemapDiagnostic, SitemapSetResult, ValidationResult } from "./types.js";
export interface CiPolicy {
    failOn?: readonly DiagnosticSeverity[] | undefined;
    failOnRules?: readonly string[] | undefined;
    allowRules?: readonly string[] | undefined;
    maxWarnings?: number | undefined;
}
export type CiPolicyPreset = "ciDefault" | "strict" | "protocolOnly" | "googleCompatible";
export declare const CI_POLICY_PRESETS: {
    readonly ciDefault: {
        readonly failOn: readonly ["error"];
    };
    readonly strict: {
        readonly failOn: readonly ["error", "warning"];
        readonly maxWarnings: 0;
    };
    readonly protocolOnly: {
        readonly failOn: readonly ["error"];
        readonly allowRules: readonly ["GOOGLE_IGNORES_CHANGEFREQ", "GOOGLE_IGNORES_PRIORITY", "GOOGLE_IMAGE_TAG_DEPRECATED", "GOOGLE_IMAGE_UNKNOWN_TAG", "GOOGLE_NEWS_UNKNOWN_TAG", "GOOGLE_VIDEO_UNKNOWN_TAG"];
    };
    readonly googleCompatible: {
        readonly failOn: readonly ["error"];
        readonly failOnRules: readonly ["GOOGLE_IGNORES_CHANGEFREQ", "GOOGLE_IGNORES_PRIORITY", "GOOGLE_IMAGE_TAG_DEPRECATED", "GOOGLE_NEWS_PUBLICATION_DATE_STALE", "GOOGLE_VIDEO_TITLE_TOO_LONG"];
    };
};
export interface CiEvaluation {
    passed: boolean;
    exitCode: 0 | 1;
    failingDiagnostics: SitemapDiagnostic[];
    warnings: number;
    errors: number;
    warningLimitExceeded: boolean;
    failureReasons: string[];
}
export declare class SitemapValidationError extends Error {
    readonly result: ValidationResult | SitemapSetResult;
    readonly evaluation: CiEvaluation;
    constructor(result: ValidationResult | SitemapSetResult, evaluation: CiEvaluation);
}
export declare function evaluateForCi(result: ValidationResult | SitemapSetResult, policy?: CiPolicy | CiPolicyPreset): CiEvaluation;
export declare function getCiPolicyPreset(preset: CiPolicyPreset): CiPolicy;
export declare function resolveCiPolicy(policy?: CiPolicy | CiPolicyPreset): CiPolicy;
export declare function assertValidForCi(result: ValidationResult | SitemapSetResult, policy?: CiPolicy | CiPolicyPreset): void;
```

## `dist/loaders.d.ts`

```ts
export { createMemorySitemapLoader } from "./memory-loader.js";
export type { MemorySitemapLoaderOptions } from "./memory-loader.js";
import type { SitemapLoader } from "./types.js";
export interface LocalSitemapLoaderOptions {
    publicUrlPrefix: string;
    localDirectory: string;
}
export declare function createLocalSitemapLoader(options: LocalSitemapLoaderOptions): SitemapLoader;
```

## `dist/memory-loader.d.ts`

```ts
import type { SitemapLoadedSource, SitemapLoader } from "./types.js";
export interface MemorySitemapLoaderOptions {
    sources: ReadonlyMap<string, SitemapLoadedSource> | Readonly<Record<string, SitemapLoadedSource>>;
}
export declare function createMemorySitemapLoader(options: MemorySitemapLoaderOptions): SitemapLoader;
```

## `dist/report.d.ts`

```ts
import type { DiagnosticSeverity, RuleSource, SitemapDiagnostic, SitemapSetResult, SourceLocation, ValidationResult } from "./types.js";
export interface DiagnosticCounts {
    errors: number;
    warnings: number;
    info: number;
}
export interface DiagnosticGroup {
    key: string;
    diagnostics: SitemapDiagnostic[];
    counts: DiagnosticCounts;
}
export type ReportDetailLevel = "summary" | "grouped" | "full";
export type DiagnosticGroupMode = "fingerprint" | "code" | "source" | "severity";
export interface DiagnosticSummaryOptions {
    groupBy?: DiagnosticGroupMode | undefined;
    maxGroups?: number | undefined;
    maxExamplesPerGroup?: number | undefined;
    maxSourcesPerGroup?: number | undefined;
}
export interface DiagnosticSummaryGroup {
    key: string;
    code: string;
    severity: DiagnosticSeverity;
    source: RuleSource;
    message: string;
    count: number;
    counts: DiagnosticCounts;
    examples: SitemapDiagnostic[];
    omittedExamples: number;
    sources: string[];
    omittedSources: number;
    firstLocation?: SourceLocation | undefined;
    spec?: string | undefined;
}
export interface DiagnosticSummary {
    total: number;
    counts: DiagnosticCounts;
    groups: DiagnosticSummaryGroup[];
    omittedGroups: number;
}
export interface DiagnosticSummaryBuilder {
    add(diagnostic: SitemapDiagnostic): void;
    addMany(diagnostics: readonly SitemapDiagnostic[]): void;
    summary(): DiagnosticSummary;
}
export interface TextReportOptions extends DiagnosticSummaryOptions {
    detail?: ReportDetailLevel | undefined;
    maxDiagnostics?: number | undefined;
    includeContext?: boolean | undefined;
    includeSpecs?: boolean | undefined;
}
export interface JsonReportOptions extends DiagnosticSummaryOptions {
    detail?: ReportDetailLevel | undefined;
    maxDiagnostics?: number | undefined;
}
export declare function countDiagnostics(diagnostics: readonly SitemapDiagnostic[]): DiagnosticCounts;
export declare function groupDiagnosticsByCode(diagnostics: readonly SitemapDiagnostic[]): DiagnosticGroup[];
export declare function groupDiagnosticsBySource(diagnostics: readonly SitemapDiagnostic[]): DiagnosticGroup[];
export declare function groupDiagnosticsBySeverity(diagnostics: readonly SitemapDiagnostic[]): DiagnosticGroup[];
export declare function summarizeDiagnostics(diagnostics: readonly SitemapDiagnostic[], options?: DiagnosticSummaryOptions): DiagnosticSummary;
export declare function createDiagnosticSummaryBuilder(options?: DiagnosticSummaryOptions): DiagnosticSummaryBuilder;
export declare function getDiagnosticFingerprint(diagnostic: SitemapDiagnostic, groupBy?: DiagnosticGroupMode): string;
export declare function createJsonReport(result: ValidationResult | SitemapSetResult, options?: JsonReportOptions): string;
export declare function createTextReport(result: ValidationResult | SitemapSetResult, options?: TextReportOptions): string;
```

## `dist/rules.d.ts`

```ts
import type { DiagnosticSeverity, RuleSource } from "./types.js";
export interface RuleDefinition {
    code: string;
    defaultSeverity: DiagnosticSeverity;
    source: RuleSource;
    spec?: string | undefined;
    title: string;
}
export declare const RULE_DEFINITIONS: {
    readonly SITEMAP_FILE_TOO_LARGE: RuleDefinition;
    readonly XML_PARSE_ERROR: RuleDefinition;
    readonly XML_INVALID_UTF8: RuleDefinition;
    readonly XML_ENCODING_NOT_UTF8: RuleDefinition;
    readonly MISSING_ROOT_ELEMENT: RuleDefinition;
    readonly XML_VERSION_UNSUPPORTED: RuleDefinition;
    readonly XML_DOCTYPE_NOT_ALLOWED: RuleDefinition;
    readonly INVALID_SITEMAP_NAMESPACE: RuleDefinition;
    readonly INVALID_ROOT_ELEMENT: RuleDefinition;
    readonly UNEXPECTED_SITEMAP_ELEMENT: RuleDefinition;
    readonly SITEMAP_ELEMENT_DUPLICATE: RuleDefinition;
    readonly SITEMAP_ELEMENT_OUT_OF_ORDER: RuleDefinition;
    readonly SITEMAP_URL_LIMIT_EXCEEDED: RuleDefinition;
    readonly SITEMAP_URL_ENTRY_REQUIRED: RuleDefinition;
    readonly SITEMAP_LOC_REQUIRED: RuleDefinition;
    readonly SITEMAP_INDEX_LIMIT_EXCEEDED: RuleDefinition;
    readonly SITEMAP_INDEX_ENTRY_REQUIRED: RuleDefinition;
    readonly SITEMAP_INDEX_LOC_REQUIRED: RuleDefinition;
    readonly INVALID_CHANGEFREQ: RuleDefinition;
    readonly INVALID_PRIORITY: RuleDefinition;
    readonly INVALID_LASTMOD: RuleDefinition;
    readonly LOC_TOO_SHORT: RuleDefinition;
    readonly LOC_TOO_LONG: RuleDefinition;
    readonly SITEMAP_MULTIPLE_HOSTS: RuleDefinition;
    readonly URL_OUTSIDE_SITEMAP_HOST: RuleDefinition;
    readonly URL_OUTSIDE_SITEMAP_PATH: RuleDefinition;
    readonly SITEMAP_ATTRIBUTE_UNEXPECTED: RuleDefinition;
    readonly SITEMAP_SET_SOURCE_LIMIT_EXCEEDED: RuleDefinition;
    readonly SITEMAP_CHILD_NOT_LOADED: RuleDefinition;
    readonly SITEMAP_CHILD_LOAD_FAILED: RuleDefinition;
    readonly URL_CONTROL_CHARACTER: RuleDefinition;
    readonly INVALID_ABSOLUTE_URL: RuleDefinition;
    readonly INVALID_RFC3986_URI: RuleDefinition;
    readonly INVALID_RFC3987_IRI: RuleDefinition;
    readonly URI_MISSING_SCHEME: RuleDefinition;
    readonly URI_MISSING_HOST: RuleDefinition;
    readonly UNSUPPORTED_URL_SCHEME: RuleDefinition;
    readonly INVALID_PERCENT_ENCODING: RuleDefinition;
    readonly URL_PERCENT_ENCODED_CONTROL_CHARACTER: RuleDefinition;
    readonly URL_PERCENT_ENCODING_INVALID_UTF8: RuleDefinition;
    readonly URL_SUSPICIOUS_DOUBLE_ENCODING: RuleDefinition;
    readonly URL_UNSAFE_CHARACTER: RuleDefinition;
    readonly URL_INVALID_IDN_HOSTNAME: RuleDefinition;
    readonly URL_HOSTNAME_TOO_LONG: RuleDefinition;
    readonly URL_HOST_LABEL_TOO_LONG: RuleDefinition;
    readonly URL_IDN_NORMALIZED: RuleDefinition;
    readonly URL_FRAGMENT_PRESENT: RuleDefinition;
    readonly URL_CREDENTIALS_PRESENT: RuleDefinition;
    readonly GOOGLE_IGNORES_CHANGEFREQ: RuleDefinition;
    readonly GOOGLE_IGNORES_PRIORITY: RuleDefinition;
    readonly EXTENSION_OUTSIDE_URL: RuleDefinition;
    readonly GOOGLE_IMAGE_LIMIT_EXCEEDED: RuleDefinition;
    readonly GOOGLE_IMAGE_TAG_DEPRECATED: RuleDefinition;
    readonly GOOGLE_IMAGE_UNKNOWN_TAG: RuleDefinition;
    readonly GOOGLE_IMAGE_LOC_REQUIRED: RuleDefinition;
    readonly GOOGLE_IMAGE_LOC_DUPLICATE: RuleDefinition;
    readonly GOOGLE_IMAGE_ELEMENT_DUPLICATE: RuleDefinition;
    readonly GOOGLE_IMAGE_ELEMENT_OUT_OF_ORDER: RuleDefinition;
    readonly GOOGLE_IMAGE_ELEMENT_PLACEMENT_INVALID: RuleDefinition;
    readonly GOOGLE_IMAGE_ATTRIBUTE_UNEXPECTED: RuleDefinition;
    readonly GOOGLE_NEWS_ENTRY_LIMIT_EXCEEDED: RuleDefinition;
    readonly GOOGLE_NEWS_ENTRY_DUPLICATE: RuleDefinition;
    readonly GOOGLE_NEWS_TAG_DEPRECATED: RuleDefinition;
    readonly GOOGLE_NEWS_UNKNOWN_TAG: RuleDefinition;
    readonly GOOGLE_NEWS_ELEMENT_DUPLICATE: RuleDefinition;
    readonly GOOGLE_NEWS_ELEMENT_OUT_OF_ORDER: RuleDefinition;
    readonly GOOGLE_NEWS_ELEMENT_PLACEMENT_INVALID: RuleDefinition;
    readonly GOOGLE_NEWS_ATTRIBUTE_UNEXPECTED: RuleDefinition;
    readonly GOOGLE_NEWS_REQUIRED_FIELD: RuleDefinition;
    readonly GOOGLE_NEWS_PUBLICATION_DATE_INVALID: RuleDefinition;
    readonly GOOGLE_NEWS_PUBLICATION_DATE_STALE: RuleDefinition;
    readonly GOOGLE_NEWS_LANGUAGE_INVALID: RuleDefinition;
    readonly GOOGLE_NEWS_TITLE_TOO_LONG: RuleDefinition;
    readonly GOOGLE_NEWS_ACCESS_INVALID: RuleDefinition;
    readonly GOOGLE_NEWS_GENRES_INVALID: RuleDefinition;
    readonly GOOGLE_NEWS_STOCK_TICKERS_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_UNKNOWN_TAG: RuleDefinition;
    readonly GOOGLE_VIDEO_TAG_DEPRECATED: RuleDefinition;
    readonly GOOGLE_VIDEO_ELEMENT_DUPLICATE: RuleDefinition;
    readonly GOOGLE_VIDEO_ELEMENT_OUT_OF_ORDER: RuleDefinition;
    readonly GOOGLE_VIDEO_ELEMENT_PLACEMENT_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_REQUIRED_FIELD: RuleDefinition;
    readonly GOOGLE_VIDEO_EXPIRATION_DATE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_PUBLICATION_DATE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_LOCATION_REQUIRED: RuleDefinition;
    readonly GOOGLE_VIDEO_CONTENT_LOC_FORMAT_UNSUPPORTED: RuleDefinition;
    readonly GOOGLE_VIDEO_CONTENT_LOC_EQUALS_PAGE_LOC: RuleDefinition;
    readonly GOOGLE_VIDEO_PLAYER_LOC_EQUALS_PAGE_LOC: RuleDefinition;
    readonly GOOGLE_VIDEO_TITLE_TOO_LONG: RuleDefinition;
    readonly GOOGLE_VIDEO_DESCRIPTION_TOO_LONG: RuleDefinition;
    readonly GOOGLE_VIDEO_CATEGORY_TOO_LONG: RuleDefinition;
    readonly GOOGLE_VIDEO_DURATION_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_RATING_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_VIEW_COUNT_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_FAMILY_FRIENDLY_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_LIVE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_REQUIRES_SUBSCRIPTION_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_RESTRICTION_COUNTRY_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_RESTRICTION_RELATIONSHIP_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_PLATFORM_VALUE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_PLATFORM_RELATIONSHIP_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_UPLOADER_TOO_LONG: RuleDefinition;
    readonly GOOGLE_VIDEO_UPLOADER_INFO_DOMAIN_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_TAG_LIMIT_EXCEEDED: RuleDefinition;
    readonly GOOGLE_VIDEO_CONTENT_SEGMENT_DURATION_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_CONTENT_SEGMENT_REQUIRES_PLAYER_LOC: RuleDefinition;
    readonly GOOGLE_VIDEO_ID_TYPE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_PLAYER_ALLOW_EMBED_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_PRICE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_ATTRIBUTE_UNEXPECTED: RuleDefinition;
    readonly GOOGLE_VIDEO_TVSHOW_NUMBER_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_TVSHOW_PREMIER_DATE_INVALID: RuleDefinition;
    readonly GOOGLE_VIDEO_TVSHOW_REQUIRED_FIELD: RuleDefinition;
    readonly GOOGLE_VIDEO_TVSHOW_VIDEO_TYPE_INVALID: RuleDefinition;
    readonly GOOGLE_PAGEMAP_UNKNOWN_TAG: RuleDefinition;
    readonly GOOGLE_PAGEMAP_ELEMENT_DUPLICATE: RuleDefinition;
    readonly GOOGLE_PAGEMAP_ELEMENT_OUT_OF_ORDER: RuleDefinition;
    readonly GOOGLE_PAGEMAP_ELEMENT_PLACEMENT_INVALID: RuleDefinition;
    readonly GOOGLE_PAGEMAP_REQUIRED_ATTRIBUTE: RuleDefinition;
    readonly GOOGLE_PAGEMAP_ATTRIBUTE_UNEXPECTED: RuleDefinition;
    readonly GOOGLE_PAGEMAP_ATTRIBUTE_VALUE_INVALID: RuleDefinition;
    readonly GOOGLE_HREFLANG_DUPLICATE: RuleDefinition;
    readonly GOOGLE_HREFLANG_SELF_REFERENCE_MISSING: RuleDefinition;
    readonly GOOGLE_HREFLANG_REL_INVALID: RuleDefinition;
    readonly GOOGLE_HREFLANG_ELEMENT_PLACEMENT_INVALID: RuleDefinition;
    readonly GOOGLE_HREFLANG_ATTRIBUTE_UNEXPECTED: RuleDefinition;
    readonly GOOGLE_HREFLANG_REQUIRED: RuleDefinition;
    readonly GOOGLE_HREFLANG_INVALID: RuleDefinition;
    readonly GOOGLE_HREFLANG_UNSUPPORTED_CODE: RuleDefinition;
    readonly GOOGLE_HREFLANG_HREF_REQUIRED: RuleDefinition;
    readonly GOOGLE_HREFLANG_GRAPH_LIMIT_EXCEEDED: RuleDefinition;
    readonly GOOGLE_HREFLANG_ALTERNATE_URL_MISSING: RuleDefinition;
    readonly GOOGLE_HREFLANG_RETURN_LINK_MISSING: RuleDefinition;
    readonly GOOGLE_HREFLANG_ALTERNATE_SET_MISMATCH: RuleDefinition;
};
export type RuleCode = keyof typeof RULE_DEFINITIONS;
export declare function getRuleDefinition(code: string): RuleDefinition | undefined;
export declare function listRuleDefinitions(): RuleDefinition[];
```

## `dist/set.d.ts`

```ts
import type { SitemapInput, SitemapSetOptions, SitemapSetResult, ValidationEvent } from "./types.js";
export declare function validateSitemapSet(input: SitemapInput, options?: SitemapSetOptions): Promise<SitemapSetResult>;
export declare function validateSitemapSetEvents(input: SitemapInput, options?: SitemapSetOptions): AsyncGenerator<ValidationEvent, void, void>;
```

## `dist/types.d.ts`

```ts
export type DiagnosticSeverity = "error" | "warning" | "info";
export type RuleSource = "xml" | "xml-namespaces" | "rfc3986" | "rfc3987" | "sitemaps.org" | "google";
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
export type SitemapInput = string | Uint8Array | ArrayBuffer | Iterable<string | Uint8Array | ArrayBuffer> | AsyncIterable<string | Uint8Array | ArrayBuffer> | {
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
export type ValidationEvent = {
    type: "source:start";
    sourceId: string;
} | {
    type: "source:bytes";
    sourceId: string;
    bytes: number;
} | {
    type: "sitemap:url";
    sourceId: string;
    count: number;
    loc?: string | undefined;
    hreflangs?: readonly HreflangAlternate[] | undefined;
} | {
    type: "sitemap:entry";
    sourceId: string;
    count: number;
    loc?: string | undefined;
} | {
    type: "diagnostic";
    sourceId: string;
    diagnostic: SitemapDiagnostic;
} | {
    type: "source:discover";
    sourceId: string;
    parentSourceId: string;
    loc: string;
    depth: number;
} | {
    type: "source:finish";
    sourceId: string;
    summary: ValidationSummary;
} | {
    type: "summary";
    sourceId: string;
    summary: ValidationSummary;
} | {
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
export declare const DEFAULT_LIMITS: ValidationLimits;
```

## `dist/url.d.ts`

```ts
import type { SitemapDiagnostic } from "./types.js";
export type UrlValidationLayer = "rfc3986" | "rfc3987" | "whatwg" | "sitemap";
export interface UrlValidationMetadata {
    original: string;
    isIri: boolean;
    whatwgHref: string | undefined;
    protocol: string | undefined;
    hostname: string | undefined;
    asciiHostname: string | undefined;
    pathname: string | undefined;
    search: string | undefined;
    hash: string | undefined;
}
export interface UrlValidationResult {
    url: URL | undefined;
    metadata: UrlValidationMetadata;
    diagnostics: Array<Omit<SitemapDiagnostic, "sourceId" | "location"> & {
        layer: UrlValidationLayer;
    }>;
}
export interface UrlValidationOptions {
    allowedProtocols?: readonly string[] | undefined;
}
export declare function validateSitemapUrlValue(value: string, source: "sitemaps.org" | "google", options?: UrlValidationOptions): UrlValidationResult;
```

## `dist/validator.d.ts`

```ts
import type { SitemapInput, ValidationEvent, ValidationOptions, ValidationResult } from "./types.js";
export declare function validateSitemap(input: SitemapInput, options?: ValidationOptions): Promise<ValidationResult>;
export declare function validateSitemapEvents(input: SitemapInput, options?: ValidationOptions): AsyncGenerator<ValidationEvent, void, void>;
```
