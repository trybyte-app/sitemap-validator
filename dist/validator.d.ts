import type { SitemapInput, ValidationEvent, ValidationOptions, ValidationResult } from "./types.js";
export declare function validateSitemap(input: SitemapInput, options?: ValidationOptions): Promise<ValidationResult>;
export declare function validateSitemapEvents(input: SitemapInput, options?: ValidationOptions): AsyncGenerator<ValidationEvent, void, void>;
