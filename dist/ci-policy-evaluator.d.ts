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
export declare function createCiPolicyEvaluator(policy: CiPolicy, options?: CiPolicyEvaluatorOptions): CiPolicyEvaluator;
export {};
