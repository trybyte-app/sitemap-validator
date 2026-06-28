import type { DiagnosticSeverity, RuleSource, SitemapDiagnostic, SitemapSetResult, SourceLocation, ValidationResult } from "./types.js";
export interface DiagnosticCounts {
    errors: number;
    warnings: number;
    info: number;
}
export interface DiagnosticGroup {
    key: string;
    diagnostics: SitemapDiagnostic[];
    counts: DiagnosticCounts;
}
export type ReportDetailLevel = "summary" | "grouped" | "full";
export type DiagnosticGroupMode = "fingerprint" | "code" | "source" | "severity";
export interface DiagnosticSummaryOptions {
    groupBy?: DiagnosticGroupMode | undefined;
    maxGroups?: number | undefined;
    maxExamplesPerGroup?: number | undefined;
    maxSourcesPerGroup?: number | undefined;
}
export interface DiagnosticSummaryGroup {
    key: string;
    code: string;
    severity: DiagnosticSeverity;
    source: RuleSource;
    message: string;
    count: number;
    counts: DiagnosticCounts;
    examples: SitemapDiagnostic[];
    omittedExamples: number;
    sources: string[];
    omittedSources: number;
    firstLocation?: SourceLocation | undefined;
    spec?: string | undefined;
}
export interface DiagnosticSummary {
    total: number;
    counts: DiagnosticCounts;
    groups: DiagnosticSummaryGroup[];
    omittedGroups: number;
}
export interface DiagnosticSummaryBuilder {
    add(diagnostic: SitemapDiagnostic): void;
    addMany(diagnostics: readonly SitemapDiagnostic[]): void;
    summary(): DiagnosticSummary;
}
export interface TextReportOptions extends DiagnosticSummaryOptions {
    detail?: ReportDetailLevel | undefined;
    maxDiagnostics?: number | undefined;
    includeContext?: boolean | undefined;
    includeSpecs?: boolean | undefined;
}
export interface JsonReportOptions extends DiagnosticSummaryOptions {
    detail?: ReportDetailLevel | undefined;
    maxDiagnostics?: number | undefined;
}
export declare function countDiagnostics(diagnostics: readonly SitemapDiagnostic[]): DiagnosticCounts;
export declare function groupDiagnosticsByCode(diagnostics: readonly SitemapDiagnostic[]): DiagnosticGroup[];
export declare function groupDiagnosticsBySource(diagnostics: readonly SitemapDiagnostic[]): DiagnosticGroup[];
export declare function groupDiagnosticsBySeverity(diagnostics: readonly SitemapDiagnostic[]): DiagnosticGroup[];
export declare function summarizeDiagnostics(diagnostics: readonly SitemapDiagnostic[], options?: DiagnosticSummaryOptions): DiagnosticSummary;
export declare function createDiagnosticSummaryBuilder(options?: DiagnosticSummaryOptions): DiagnosticSummaryBuilder;
export declare function getDiagnosticFingerprint(diagnostic: SitemapDiagnostic, groupBy?: DiagnosticGroupMode): string;
export declare function createJsonReport(result: ValidationResult | SitemapSetResult, options?: JsonReportOptions): string;
export declare function createTextReport(result: ValidationResult | SitemapSetResult, options?: TextReportOptions): string;
