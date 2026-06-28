import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>`;

test("CLI exits 0 for a valid sitemap with the default CI policy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sitemapPath = join(directory, "sitemap.xml");
  await writeFile(sitemapPath, validXml);

  const result = await runCli([sitemapPath, "--detail", "summary"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Status: passed/);
  assert.equal(result.stderr, "");
});

test("CLI exits non-zero and prints JSON when validation violates the default policy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sitemapPath = join(directory, "invalid.xml");
  await writeFile(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <priority>2</priority>
  </url>
</urlset>`);

  const result = await runCli([sitemapPath, "--json", "--detail", "summary"]);
  const report = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(report.evaluation.passed, false);
  assert.equal(report.evaluation.exitCode, 1);
  assert.equal(report.diagnosticSummary.groups.some((group) => group.code === "INVALID_PRIORITY"), true);
});

test("CLI applies strict warning policy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sitemapPath = join(directory, "warning.xml");
  await writeFile(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <changefreq>daily</changefreq>
  </url>
</urlset>`);

  const defaultPolicy = await runCli([sitemapPath, "--json", "--detail", "summary"]);
  const strictPolicy = await runCli([sitemapPath, "--json", "--detail", "summary", "--policy", "strict"]);

  assert.equal(defaultPolicy.code, 0);
  assert.equal(JSON.parse(defaultPolicy.stdout).evaluation.passed, true);
  assert.equal(strictPolicy.code, 1);
  assert.equal(JSON.parse(strictPolicy.stdout).evaluation.passed, false);
});

test("CLI validates generated child sitemap files through local URL mapping", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const indexPath = join(directory, "sitemap-index.xml");
  const childPath = join(directory, "products.xml");

  await writeFile(indexPath, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/products.xml</loc></sitemap>
</sitemapindex>`);
  await writeFile(childPath, validXml);

  const result = await runCli([
    indexPath,
    "--json",
    "--detail",
    "summary",
    "--sitemap-location",
    "https://example.com/sitemap-index.xml",
    "--public-url-prefix",
    "https://example.com/",
    "--local-sitemap-root",
    directory,
  ]);
  const report = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(report.summary.sources, 2);
  assert.equal(report.summary.urls, 1);
});

test("CLI exits 2 for usage errors", async () => {
  const result = await runCli(["--unknown"]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown argument: --unknown/);
  assert.match(result.stderr, /Usage:/);
});

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}
