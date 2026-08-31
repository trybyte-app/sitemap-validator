import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../dist/cli.js";
import { createJsonReport, createTextReport } from "../dist/index.js";
import { runLiveCli } from "../dist/live-cli.js";

test("publish-gate compact JSON keeps the CI decision without retaining failing diagnostic rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-cli-report-regression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sitemapPath = join(directory, "invalid.xml");
  await writeFile(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc><priority>2</priority></url>
  <url><loc>https://example.com/b</loc><priority>3</priority></url>
</urlset>`);

  for (const detail of ["summary", "grouped"]) {
    const io = createIo();
    const code = await runCli([sitemapPath, "--json", "--detail", detail], io);
    const report = JSON.parse(io.output.stdout);

    assert.equal(code, 1, detail);
    assert.equal(report.evaluation.passed, false, detail);
    assert.deepEqual(report.evaluation.failingDiagnostics, [], detail);
    assert.match(report.evaluation.failureReasons[0], /2 diagnostics matched/, detail);
  }

  const fullIo = createIo();
  await runCli([sitemapPath, "--json", "--detail", "full"], fullIo);
  assert.equal(JSON.parse(fullIo.output.stdout).evaluation.failingDiagnostics.length, 2);
});

test("source and severity grouping label heterogeneous diagnostic groups truthfully", () => {
  const result = {
    valid: true,
    sourceId: "fixture.xml",
    summary: {
      sourceId: "fixture.xml",
      rootType: "urlset",
      urls: 1,
      sitemaps: 0,
      bytes: 1,
      diagnostics: { errors: 0, warnings: 2, info: 0 },
      valid: true,
    },
    diagnostics: [
      { code: "FIRST_WARNING", severity: "warning", source: "google", message: "First message.", spec: "https://example.com/spec-a" },
      { code: "SECOND_WARNING", severity: "warning", source: "sitemaps.org", message: "Second message.", spec: "https://example.com/spec-b" },
    ],
  };

  const sourceJson = JSON.parse(createJsonReport(result, { detail: "grouped", groupBy: "severity" }));
  const group = sourceJson.diagnosticSummary.groups[0];
  const text = createTextReport(result, { detail: "grouped", groupBy: "severity" });

  assert.deepEqual(group.varies, ["code", "source", "message", "spec"]);
  assert.match(text, /multiple rule codes/);
  assert.match(text, /multiple rule sources/);
  assert.doesNotMatch(text, /FIRST_WARNING x2/);
  assert.doesNotMatch(text, /\(google\)/);

  const summaryText = createTextReport(result, { detail: "summary", groupBy: "severity", includeSpecs: true });
  assert.doesNotMatch(summaryText, /see the examples below/i);
  assert.match(summaryText, /spec: multiple specification links/i);
  assert.doesNotMatch(summaryText, /spec-a|spec-b/);

  const sourceResult = {
    ...result,
    valid: false,
    diagnostics: [
      { code: "FIRST_INFO", severity: "info", source: "google", message: "First info." },
      { code: "SECOND_ERROR", severity: "error", source: "google", message: "Second error." },
      { code: "THIRD_WARNING", severity: "warning", source: "sitemaps.org", message: "Third warning." },
    ],
  };
  const groupedBySource = JSON.parse(createJsonReport(sourceResult, { detail: "grouped", groupBy: "source" }));
  const sourceGroup = groupedBySource.diagnosticSummary.groups[0];
  const sourceText = createTextReport(sourceResult, { detail: "grouped", groupBy: "source" });

  assert.equal(sourceGroup.source, "google");
  assert.deepEqual(sourceGroup.varies, ["code", "severity", "message"]);
  assert.match(sourceText, /mixed severity: 1 errors, 0 warnings, 1 info/);
  assert.doesNotMatch(sourceText, /FIRST_INFO x2/);
  assert.doesNotMatch(sourceText, /First info\.:/);
});

test("both CLI entry points treat a closed stdout pipe as a clean termination", async () => {
  for (const run of [runCli, runLiveCli]) {
    const io = createIo();
    io.stdout.write = () => {
      const error = new Error("write EPIPE");
      error.code = "EPIPE";
      throw error;
    };

    const code = await run(["--help"], io);

    assert.equal(code, 0);
    assert.equal(io.output.stderr, "");
  }

  for (const script of ["dist/cli.js", "dist/live-cli.js"]) {
    const result = await runWithClosedStdout(script);

    assert.equal(result.code, 0, script);
    assert.doesNotMatch(result.stderr, /EPIPE|broken pipe|node:events/i, script);
  }
});

function runWithClosedStdout(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stdout.destroy();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

function createIo() {
  const output = { stdout: "", stderr: "" };

  return {
    output,
    stdout: { write(chunk) { output.stdout += String(chunk); } },
    stderr: { write(chunk) { output.stderr += String(chunk); } },
  };
}
