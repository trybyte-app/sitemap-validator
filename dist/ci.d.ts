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
