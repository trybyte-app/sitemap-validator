import type { SitemapInput, SitemapSetOptions, SitemapSetResult, ValidationEvent } from "./types.js";
export declare function validateSitemapSet(input: SitemapInput, options?: SitemapSetOptions): Promise<SitemapSetResult>;
export declare function validateSitemapSetEvents(input: SitemapInput, options?: SitemapSetOptions): AsyncGenerator<ValidationEvent, void, void>;
