import type { HreflangAlternate, HreflangGraphOptions, SitemapDiagnostic, SitemapSetOptions } from "./types.js";
export interface HreflangGraphRecord {
    sourceId: string;
    loc: string;
    alternates: readonly HreflangAlternate[];
}
export declare const DEFAULT_HREFLANG_GRAPH_OPTIONS: Required<HreflangGraphOptions>;
export declare function resolveHreflangGraphOptions(value: SitemapSetOptions["hreflangGraph"]): Required<HreflangGraphOptions> | undefined;
export declare function validateHreflangGraph(records: readonly HreflangGraphRecord[], graphOptions: Required<HreflangGraphOptions>, options: SitemapSetOptions): SitemapDiagnostic[];
