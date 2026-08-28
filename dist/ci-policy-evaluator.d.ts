import type { CiEvaluation, CiPolicy } from "./ci.js";
import type { SitemapDiagnostic } from "./types.js";
export interface CiPolicyEvaluator {
    add(diagnostic: SitemapDiagnostic): void;
    addMany(diagnostics: readonly SitemapDiagnostic[]): void;
    evaluation(): CiEvaluation;
}
export declare function createCiPolicyEvaluator(policy: CiPolicy): CiPolicyEvaluator;
