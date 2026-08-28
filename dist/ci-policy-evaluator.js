export function createCiPolicyEvaluator(policy) {
    const failOn = new Set(policy.failOn ?? ["error"]);
    const failOnRules = new Set(policy.failOnRules ?? []);
    const allowRules = new Set(policy.allowRules ?? []);
    const failingDiagnostics = [];
    let warnings = 0;
    let errors = 0;
    return {
        add(diagnostic) {
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
                failingDiagnostics.push(diagnostic);
            }
        },
        addMany(diagnostics) {
            for (const diagnostic of diagnostics) {
                this.add(diagnostic);
            }
        },
        evaluation() {
            const warningLimitExceeded = policy.maxWarnings !== undefined && warnings > policy.maxWarnings;
            const passed = failingDiagnostics.length === 0 && !warningLimitExceeded;
            const failureReasons = [
                failingDiagnostics.length > 0
                    ? `${failingDiagnostics.length} diagnostic${failingDiagnostics.length === 1 ? "" : "s"} matched the CI failure policy.`
                    : undefined,
                warningLimitExceeded
                    ? `Warning count ${warnings} exceeded the configured maxWarnings ${policy.maxWarnings}.`
                    : undefined,
            ].filter((reason) => typeof reason === "string");
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
