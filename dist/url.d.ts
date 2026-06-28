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
