import { createCiPolicyEvaluator } from "./ci-policy-evaluator.js";
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
    const evaluator = createCiPolicyEvaluator(resolveCiPolicy(policy));
    evaluator.addMany(result.diagnostics);
    return evaluator.evaluation();
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
