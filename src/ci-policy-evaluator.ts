import type { CiEvaluation, CiPolicy } from "./ci.js";
import type { SitemapDiagnostic } from "./types.js";

export interface CiPolicyEvaluator {
  add(diagnostic: SitemapDiagnostic): void;
  addMany(diagnostics: readonly SitemapDiagnostic[]): void;
  evaluation(): CiEvaluation;
}

interface CiPolicyEvaluatorOptions {
  maxFailingDiagnostics?: number | undefined;
}

export function createCiPolicyEvaluator(policy: CiPolicy, options: CiPolicyEvaluatorOptions = {}): CiPolicyEvaluator {
  const failOn = new Set(policy.failOn ?? ["error"]);
  const failOnRules = new Set(policy.failOnRules ?? []);
  const allowRules = new Set(policy.allowRules ?? []);
  const maxFailingDiagnostics = options.maxFailingDiagnostics ?? Number.POSITIVE_INFINITY;
  const failingDiagnostics: SitemapDiagnostic[] = [];
  let failingDiagnosticCount = 0;
  let warnings = 0;
  let errors = 0;

  return {
    add(diagnostic): void {
      if (allowRules.has(diagnostic.code)) {
        return;
      }

      if (diagnostic.severity === "warning") {
        warnings += 1;
      }

      if (diagnostic.severity === "error") {
        errors += 1;
      }

      if (failOn.has(diagnostic.severity) || failOnRules.has(diagnostic.code)) {
        failingDiagnosticCount += 1;

        if (failingDiagnostics.length < maxFailingDiagnostics) {
          failingDiagnostics.push(diagnostic);
        }
      }
    },
    addMany(diagnostics): void {
      for (const diagnostic of diagnostics) {
        this.add(diagnostic);
      }
    },
    evaluation(): CiEvaluation {
      const warningLimitExceeded = policy.maxWarnings !== undefined && warnings > policy.maxWarnings;
      const passed = failingDiagnosticCount === 0 && !warningLimitExceeded;
      const failureReasons = [
        failingDiagnosticCount > 0
          ? `${failingDiagnosticCount} diagnostic${failingDiagnosticCount === 1 ? "" : "s"} matched the CI failure policy.`
          : undefined,
        warningLimitExceeded
          ? `Warning count ${warnings} exceeded the configured maxWarnings ${policy.maxWarnings}.`
          : undefined,
      ].filter((reason): reason is string => typeof reason === "string");

      return {
        passed,
        exitCode: passed ? 0 : 1,
        failingDiagnostics: [...failingDiagnostics],
        warnings,
        errors,
        warningLimitExceeded,
        failureReasons,
      };
    },
  };
}
