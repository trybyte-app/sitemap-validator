const DEFAULT_MAX_GROUPS = 50;
const DEFAULT_SUMMARY_MAX_GROUPS = 10;
const DEFAULT_MAX_EXAMPLES_PER_GROUP = 3;
const DEFAULT_MAX_SOURCES_PER_GROUP = 5;
export function countDiagnostics(diagnostics) {
    return diagnostics.reduce((counts, diagnostic) => {
        if (diagnostic.severity === "error")
            counts.errors += 1;
        if (diagnostic.severity === "warning")
            counts.warnings += 1;
        if (diagnostic.severity === "info")
            counts.info += 1;
        return counts;
    }, { errors: 0, warnings: 0, info: 0 });
}
export function groupDiagnosticsByCode(diagnostics) {
    return groupDiagnostics(diagnostics, (diagnostic) => diagnostic.code);
}
export function groupDiagnosticsBySource(diagnostics) {
    return groupDiagnostics(diagnostics, (diagnostic) => diagnostic.source);
}
export function groupDiagnosticsBySeverity(diagnostics) {
    return groupDiagnostics(diagnostics, (diagnostic) => diagnostic.severity);
}
export function summarizeDiagnostics(diagnostics, options = {}) {
    const builder = createDiagnosticSummaryBuilder(options);
    builder.addMany(diagnostics);
    return builder.summary();
}
export function createDiagnosticSummaryBuilder(options = {}) {
    const maxGroups = normalizeLimit(options.maxGroups, DEFAULT_MAX_GROUPS);
    const maxExamplesPerGroup = normalizeLimit(options.maxExamplesPerGroup, DEFAULT_MAX_EXAMPLES_PER_GROUP);
    const maxSourcesPerGroup = normalizeLimit(options.maxSourcesPerGroup, DEFAULT_MAX_SOURCES_PER_GROUP);
    const groupBy = options.groupBy ?? "fingerprint";
    const mutableGroups = new Map();
    const counts = { errors: 0, warnings: 0, info: 0 };
    let total = 0;
    return {
        add(diagnostic) {
            total += 1;
            incrementCounts(counts, diagnostic.severity);
            const key = getDiagnosticFingerprint(diagnostic, groupBy);
            let group = mutableGroups.get(key);
            if (!group) {
                group = createMutableSummaryGroup(key, diagnostic);
                mutableGroups.set(key, group);
            }
            addDiagnosticToSummaryGroup(group, diagnostic, maxExamplesPerGroup, maxSourcesPerGroup);
        },
        addMany(diagnosticsToAdd) {
            for (const diagnostic of diagnosticsToAdd) {
                this.add(diagnostic);
            }
        },
        summary() {
            const allGroups = [...mutableGroups.values()]
                .map(toDiagnosticSummaryGroup)
                .sort(compareDiagnosticSummaryGroups);
            return {
                total,
                counts: { ...counts },
                groups: allGroups.slice(0, maxGroups),
                omittedGroups: Math.max(0, allGroups.length - maxGroups),
            };
        },
    };
}
export function getDiagnosticFingerprint(diagnostic, groupBy = "fingerprint") {
    if (groupBy === "code") {
        return diagnostic.code;
    }
    if (groupBy === "source") {
        return diagnostic.source;
    }
    if (groupBy === "severity") {
        return diagnostic.severity;
    }
    return [
        diagnostic.severity,
        diagnostic.source,
        diagnostic.code,
        diagnostic.message,
        diagnostic.location?.path ?? "",
    ].join("|");
}
export function createJsonReport(result, options = {}) {
    const detail = options.detail ?? "full";
    if (detail === "full") {
        const maxDiagnostics = options.maxDiagnostics;
        if (maxDiagnostics === undefined || result.diagnostics.length <= maxDiagnostics) {
            return JSON.stringify(result, null, 2);
        }
        return JSON.stringify({
            ...result,
            diagnostics: result.diagnostics.slice(0, maxDiagnostics),
            omittedDiagnostics: result.diagnostics.length - maxDiagnostics,
        }, null, 2);
    }
    const summary = summarizeDiagnostics(result.diagnostics, {
        groupBy: options.groupBy,
        maxGroups: options.maxGroups ?? (detail === "summary" ? DEFAULT_SUMMARY_MAX_GROUPS : DEFAULT_MAX_GROUPS),
        maxExamplesPerGroup: detail === "summary" ? 0 : options.maxExamplesPerGroup,
        maxSourcesPerGroup: options.maxSourcesPerGroup,
    });
    return JSON.stringify({
        valid: result.valid,
        sourceId: "sourceId" in result ? result.sourceId : undefined,
        summary: result.summary,
        summaries: "summaries" in result ? result.summaries : undefined,
        diagnosticSummary: summary,
    }, null, 2);
}
export function createTextReport(result, options = {}) {
    const detail = options.detail ?? "grouped";
    const diagnostics = result.diagnostics;
    const counts = countDiagnostics(diagnostics);
    const lines = [
        `Valid: ${result.valid ? "yes" : "no"}`,
        `Diagnostics: ${counts.errors} errors, ${counts.warnings} warnings, ${counts.info} info`,
    ];
    if (detail === "full") {
        const maxDiagnostics = options.maxDiagnostics ?? diagnostics.length;
        for (const diagnostic of diagnostics.slice(0, maxDiagnostics)) {
            lines.push(formatDiagnosticLine(diagnostic, options));
        }
        if (diagnostics.length > maxDiagnostics) {
            lines.push(`... ${diagnostics.length - maxDiagnostics} more diagnostics omitted. Increase maxDiagnostics or use JSON full detail for all entries.`);
        }
        return lines.join("\n");
    }
    const summary = summarizeDiagnostics(diagnostics, {
        groupBy: options.groupBy,
        maxGroups: options.maxGroups ?? (detail === "summary" ? DEFAULT_SUMMARY_MAX_GROUPS : DEFAULT_MAX_GROUPS),
        maxExamplesPerGroup: detail === "summary" ? 0 : options.maxExamplesPerGroup,
        maxSourcesPerGroup: options.maxSourcesPerGroup,
    });
    if (summary.groups.length === 0) {
        return lines.join("\n");
    }
    lines.push("Diagnostic groups:");
    for (const group of summary.groups) {
        lines.push(formatDiagnosticSummaryGroup(group));
        for (const example of group.examples) {
            const location = formatLocation(example);
            const context = options.includeContext && example.context ? ` context=${JSON.stringify(example.context)}` : "";
            lines.push(`  example${location}: ${example.message}${context}`);
        }
        if (group.omittedExamples > 0) {
            lines.push(`  ... ${group.omittedExamples} more occurrence${group.omittedExamples === 1 ? "" : "s"} in this group.`);
        }
        if (options.includeSpecs && group.spec) {
            lines.push(`  spec: ${group.spec}`);
        }
    }
    if (summary.omittedGroups > 0) {
        lines.push(`... ${summary.omittedGroups} more diagnostic group${summary.omittedGroups === 1 ? "" : "s"} omitted.`);
    }
    return lines.join("\n");
}
function groupDiagnostics(diagnostics, getKey) {
    const groups = new Map();
    for (const diagnostic of diagnostics) {
        const key = getKey(diagnostic);
        const group = groups.get(key);
        if (group) {
            group.push(diagnostic);
        }
        else {
            groups.set(key, [diagnostic]);
        }
    }
    return [...groups.entries()].map(([key, groupedDiagnostics]) => ({
        key,
        diagnostics: groupedDiagnostics,
        counts: countDiagnostics(groupedDiagnostics),
    }));
}
function createMutableSummaryGroup(key, diagnostic) {
    return {
        key,
        code: diagnostic.code,
        severity: diagnostic.severity,
        source: diagnostic.source,
        message: diagnostic.message,
        count: 0,
        counts: { errors: 0, warnings: 0, info: 0 },
        examples: [],
        omittedExamples: 0,
        sourceSet: new Set(),
        sources: [],
        omittedSources: 0,
        firstLocation: diagnostic.location,
        spec: diagnostic.spec,
    };
}
function addDiagnosticToSummaryGroup(group, diagnostic, maxExamplesPerGroup, maxSourcesPerGroup) {
    group.count += 1;
    incrementCounts(group.counts, diagnostic.severity);
    if (group.examples.length < maxExamplesPerGroup) {
        group.examples.push(diagnostic);
    }
    else {
        group.omittedExamples += 1;
    }
    if (!diagnostic.sourceId || group.sourceSet.has(diagnostic.sourceId)) {
        return;
    }
    group.sourceSet.add(diagnostic.sourceId);
    if (group.sources.length < maxSourcesPerGroup) {
        group.sources.push(diagnostic.sourceId);
    }
    else {
        group.omittedSources += 1;
    }
}
function toDiagnosticSummaryGroup(group) {
    return {
        key: group.key,
        code: group.code,
        severity: group.severity,
        source: group.source,
        message: group.message,
        count: group.count,
        counts: { ...group.counts },
        examples: [...group.examples],
        omittedExamples: group.omittedExamples,
        sources: [...group.sources],
        omittedSources: group.omittedSources,
        firstLocation: group.firstLocation,
        spec: group.spec,
    };
}
function incrementCounts(counts, severity) {
    if (severity === "error")
        counts.errors += 1;
    if (severity === "warning")
        counts.warnings += 1;
    if (severity === "info")
        counts.info += 1;
}
function compareDiagnosticSummaryGroups(left, right) {
    const severityDifference = getSeverityRank(left.severity) - getSeverityRank(right.severity);
    if (severityDifference !== 0) {
        return severityDifference;
    }
    const countDifference = right.count - left.count;
    if (countDifference !== 0) {
        return countDifference;
    }
    return left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}
function getSeverityRank(severity) {
    if (severity === "error")
        return 0;
    if (severity === "warning")
        return 1;
    return 2;
}
function normalizeLimit(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
}
function formatDiagnosticSummaryGroup(group) {
    const sourceSummary = group.sources.length === 0
        ? ""
        : ` sources=${group.sources.join(", ")}${group.omittedSources > 0 ? ` (+${group.omittedSources} more)` : ""}`;
    return `[${group.severity}] ${group.code} x${group.count} (${group.source})${sourceSummary}: ${group.message}`;
}
function formatDiagnosticLine(diagnostic, options) {
    const location = formatLocation(diagnostic);
    const context = options.includeContext && diagnostic.context ? ` context=${JSON.stringify(diagnostic.context)}` : "";
    const spec = options.includeSpecs && diagnostic.spec ? ` spec=${diagnostic.spec}` : "";
    return `[${diagnostic.severity}] ${diagnostic.code}${location}: ${diagnostic.message}${context}${spec}`;
}
function formatLocation(diagnostic) {
    const parts = [];
    if (diagnostic.sourceId) {
        parts.push(diagnostic.sourceId);
    }
    if (diagnostic.location?.path) {
        parts.push(diagnostic.location.path);
    }
    if (diagnostic.location?.line !== undefined) {
        parts.push(`line ${diagnostic.location.line}`);
    }
    if (diagnostic.location?.column !== undefined) {
        parts.push(`column ${diagnostic.location.column}`);
    }
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
