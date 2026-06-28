export const CI_POLICY_PRESETS = {
    ciDefault: {
        failOn: ["error"],
    },
    strict: {
        failOn: ["error", "warning"],
        maxWarnings: 0,
    },
    protocolOnly: {
        failOn: ["error"],
        allowRules: [
            "GOOGLE_IGNORES_CHANGEFREQ",
            "GOOGLE_IGNORES_PRIORITY",
            "GOOGLE_IMAGE_TAG_DEPRECATED",
            "GOOGLE_IMAGE_UNKNOWN_TAG",
            "GOOGLE_NEWS_UNKNOWN_TAG",
            "GOOGLE_VIDEO_UNKNOWN_TAG",
        ],
    },
    googleCompatible: {
        failOn: ["error"],
        failOnRules: [
            "GOOGLE_IGNORES_CHANGEFREQ",
            "GOOGLE_IGNORES_PRIORITY",
            "GOOGLE_IMAGE_TAG_DEPRECATED",
            "GOOGLE_NEWS_PUBLICATION_DATE_STALE",
            "GOOGLE_VIDEO_TITLE_TOO_LONG",
        ],
    },
};
export class SitemapValidationError extends Error {
    result;
    evaluation;
    constructor(result, evaluation) {
        super(`Sitemap validation failed with ${evaluation.errors} errors and ${evaluation.warnings} warnings.`);
        this.name = "SitemapValidationError";
        this.result = result;
        this.evaluation = evaluation;
    }
}
export function evaluateForCi(result, policy = "ciDefault") {
    const resolvedPolicy = resolveCiPolicy(policy);
    const failOn = new Set(resolvedPolicy.failOn ?? ["error"]);
    const failOnRules = new Set(resolvedPolicy.failOnRules ?? []);
    const allowRules = new Set(resolvedPolicy.allowRules ?? []);
    const policyDiagnostics = result.diagnostics.filter((diagnostic) => !allowRules.has(diagnostic.code));
    const failingDiagnostics = policyDiagnostics.filter((diagnostic) => failOn.has(diagnostic.severity) || failOnRules.has(diagnostic.code));
    const warnings = policyDiagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
    const errors = policyDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warningLimitExceeded = resolvedPolicy.maxWarnings !== undefined && warnings > resolvedPolicy.maxWarnings;
    const failureReasons = [
        failingDiagnostics.length > 0 ? `${failingDiagnostics.length} diagnostics matched the CI failure policy.` : undefined,
        warningLimitExceeded ? `Warning count ${warnings} exceeded the configured maxWarnings ${resolvedPolicy.maxWarnings}.` : undefined,
    ].filter((reason) => typeof reason === "string");
    const passed = failingDiagnostics.length === 0 && !warningLimitExceeded;
    return {
        passed,
        exitCode: passed ? 0 : 1,
        failingDiagnostics,
        warnings,
        errors,
        warningLimitExceeded,
        failureReasons,
    };
}
export function getCiPolicyPreset(preset) {
    return CI_POLICY_PRESETS[preset];
}
export function resolveCiPolicy(policy = "ciDefault") {
    if (typeof policy === "string") {
        return CI_POLICY_PRESETS[policy];
    }
    return policy;
}
export function assertValidForCi(result, policy = "ciDefault") {
    const evaluation = evaluateForCi(result, policy);
    if (!evaluation.passed) {
        throw new SitemapValidationError(result, evaluation);
    }
}
