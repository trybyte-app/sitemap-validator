import type { SitemapDiagnostic, SourceLocation, ValidationLimits } from "./types.js";
export interface LocRuleState {
    limits: Pick<ValidationLimits, "maxLocLength">;
    sitemapLocation: URL | undefined;
    urlsetHost: string | undefined;
    sitemapIndexHost: string | undefined;
}
export interface LocRuleContext {
    addDiagnostic(diagnostic: Omit<SitemapDiagnostic, "sourceId">): void;
    location(path: string): SourceLocation;
}
export interface LocValidationOptions {
    enforceSitemapLocation: boolean;
    allowedProtocols?: readonly string[] | undefined;
}
export declare function validateLocRule(state: LocRuleState, context: LocRuleContext, value: string, path: string, source: "sitemaps.org" | "google", options: LocValidationOptions): URL | undefined;
export declare function validateSingleHostRule(state: LocRuleState, context: LocRuleContext, url: URL | undefined, path: string, kind: "urlset" | "sitemapindex"): void;
