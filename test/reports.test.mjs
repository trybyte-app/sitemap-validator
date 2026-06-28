import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidForCi,
  createDiagnosticSummaryBuilder,
  createJsonReport,
  createTextReport,
  evaluateForCi,
  getCiPolicyPreset,
  groupDiagnosticsByCode,
  listRuleDefinitions,
  summarizeDiagnostics,
  validateSitemap,
} from "../dist/index.js";

test("exports rule registry and report helpers", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>not-a-url</loc></url>
</urlset>`);
  const groups = groupDiagnosticsByCode(result.diagnostics);
  const report = createTextReport(result);

  assert.ok(listRuleDefinitions().some((rule) => rule.code === "INVALID_ABSOLUTE_URL"));
  assert.ok(groups.some((group) => group.key === "INVALID_ABSOLUTE_URL"));
  assert.match(report, /INVALID_ABSOLUTE_URL/);
});

test("groups repeated diagnostics in human reports", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc><changefreq>daily</changefreq></url>
  <url><loc>https://example.com/b</loc><changefreq>daily</changefreq></url>
</urlset>`);
  const summary = summarizeDiagnostics(result.diagnostics);
  const textReport = createTextReport(result);
  const summaryReport = createTextReport(result, { detail: "summary" });
  const fullReport = createTextReport(result, { detail: "full" });
  const groupedJson = JSON.parse(createJsonReport(result, { detail: "grouped" }));

  assert.ok(summary.groups.some((group) => group.code === "GOOGLE_IGNORES_CHANGEFREQ" && group.count === 2));
  assert.match(textReport, /GOOGLE_IGNORES_CHANGEFREQ x2/);
  assert.doesNotMatch(summaryReport, /example/);
  assert.match(fullReport, /GOOGLE_IGNORES_CHANGEFREQ/);
  assert.ok(groupedJson.diagnosticSummary.groups.some((group) => group.code === "GOOGLE_IGNORES_CHANGEFREQ" && group.count === 2));
});

test("builds diagnostic summaries incrementally without retaining all diagnostics", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc><priority>0.5</priority></url>
  <url><loc>https://example.com/b</loc><priority>0.5</priority></url>
  <url><loc>https://example.com/c</loc><priority>0.5</priority></url>
</urlset>`);
  const builder = createDiagnosticSummaryBuilder({ maxExamplesPerGroup: 1 });

  for (const diagnostic of result.diagnostics) {
    builder.add(diagnostic);
  }

  const summary = builder.summary();
  const priorityGroup = summary.groups.find((group) => group.code === "GOOGLE_IGNORES_PRIORITY");

  assert.equal(summary.total, result.diagnostics.length);
  assert.equal(summary.counts.warnings, 3);
  assert.equal(priorityGroup?.count, 3);
  assert.equal(priorityGroup?.examples.length, 1);
  assert.equal(priorityGroup?.omittedExamples, 2);
});

test("evaluates CI policies and throws on deployment-blocking diagnostics", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <changefreq>daily</changefreq>
  </url>
</urlset>`);
  const defaultEvaluation = evaluateForCi(result);
  const strictEvaluation = evaluateForCi(result, { failOn: ["error", "warning"] });
  const warningLimitEvaluation = evaluateForCi(result, { failOn: ["error"], maxWarnings: 0 });
  const strictPresetEvaluation = evaluateForCi(result, "strict");
  const preset = getCiPolicyPreset("strict");

  assert.equal(defaultEvaluation.passed, true);
  assert.equal(strictEvaluation.passed, false);
  assert.equal(warningLimitEvaluation.passed, false);
  assert.equal(warningLimitEvaluation.warningLimitExceeded, true);
  assert.ok(warningLimitEvaluation.failureReasons.some((reason) => reason.includes("maxWarnings")));
  assert.equal(strictPresetEvaluation.passed, false);
  assert.deepEqual(preset.failOn, ["error", "warning"]);
  assert.equal(strictEvaluation.exitCode, 1);
  assert.throws(() => assertValidForCi(result, { failOn: ["warning"] }), /Sitemap validation failed/);
  assert.throws(() => assertValidForCi(result, "strict"), /Sitemap validation failed/);
});

test("excludes allowed rules from CI warning limits and failures", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc><priority>0.5</priority></url>
</urlset>`);
  const evaluation = evaluateForCi(result, {
    failOn: ["error", "warning"],
    allowRules: ["GOOGLE_IGNORES_PRIORITY"],
    maxWarnings: 0,
  });

  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.warnings, 0);
  assert.equal(evaluation.failingDiagnostics.length, 0);
});
