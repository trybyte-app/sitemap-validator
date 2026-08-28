import { createCiPolicyEvaluator } from "./ci-policy-evaluator.js";
import type { DiagnosticSeverity, SitemapDiagnostic, SitemapSetResult, ValidationResult } from "./types.js";

export interface CiPolicy {
  failOn?: readonly DiagnosticSeverity[] | undefined;
  failOnRules?: readonly string[] | undefined;
  allowRules?: readonly string[] | undefined;
  maxWarnings?: number | undefined;
}

export type CiPolicyPreset = "ciDefault" | "strict" | "protocolOnly" | "googleCompatible";

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
} as const satisfies Record<CiPolicyPreset, CiPolicy>;

export interface CiEvaluation {
  passed: boolean;
  exitCode: 0 | 1;
  failingDiagnostics: SitemapDiagnostic[];
  warnings: number;
  errors: number;
  warningLimitExceeded: boolean;
  failureReasons: string[];
}

export class SitemapValidationError extends Error {
  readonly result: ValidationResult | SitemapSetResult;
  readonly evaluation: CiEvaluation;

  constructor(result: ValidationResult | SitemapSetResult, evaluation: CiEvaluation) {
    super(`Sitemap validation failed with ${evaluation.errors} errors and ${evaluation.warnings} warnings.`);
    this.name = "SitemapValidationError";
    this.result = result;
    this.evaluation = evaluation;
  }
}

export function evaluateForCi(result: ValidationResult | SitemapSetResult, policy: CiPolicy | CiPolicyPreset = "ciDefault"): CiEvaluation {
  const evaluator = createCiPolicyEvaluator(resolveCiPolicy(policy));
  evaluator.addMany(result.diagnostics);
  return evaluator.evaluation();
}

export function getCiPolicyPreset(preset: CiPolicyPreset): CiPolicy {
  return CI_POLICY_PRESETS[preset];
}

export function resolveCiPolicy(policy: CiPolicy | CiPolicyPreset = "ciDefault"): CiPolicy {
  if (typeof policy === "string") {
    return CI_POLICY_PRESETS[policy];
  }

  return policy;
}

export function assertValidForCi(result: ValidationResult | SitemapSetResult, policy: CiPolicy | CiPolicyPreset = "ciDefault"): void {
  const evaluation = evaluateForCi(result, policy);

  if (!evaluation.passed) {
    throw new SitemapValidationError(result, evaluation);
  }
}
