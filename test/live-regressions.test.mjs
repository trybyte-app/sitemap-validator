import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGuardedLiveFetcher } from "../dist/guarded-live-fetch.js";
import { runLiveCli } from "../dist/live-cli.js";

function createFetcherForAddress(address, onFetch) {
  return createGuardedLiveFetcher({
    fetch: onFetch,
    resolveHost: async () => [{ address, family: 6 }],
    allowPrivateHosts: false,
    timeoutMs: 100,
    maxRedirects: 5,
    userAgent: "sitemap-validator-test",
  });
}

test("guarded live fetch admits global IPv6 and rejects current non-public IPv6 ranges", async () => {
  const cases = [
    { address: "64:ff9b::808:808", admitted: true },
    { address: "2001:db80::1", admitted: true },
    { address: "2001:1::1", admitted: true },
    { address: "2001:3::1", admitted: true },
    { address: "2606:4700:4700::1111", admitted: true },
    { address: "100::1", admitted: false },
    { address: "100:0:0:1::1", admitted: false },
    { address: "3fff::1", admitted: false },
    { address: "4000::1", admitted: false },
    { address: "5f00::1", admitted: false },
    { address: "8000::1", admitted: false },
    { address: "fec0::1", admitted: false },
  ];

  for (const { address, admitted } of cases) {
    let requests = 0;
    const fetcher = createFetcherForAddress(address, async () => {
      requests += 1;
      return new Response("ok");
    });
    const promise = fetcher.fetch("https://example.com/", {
      method: "GET",
      followRedirects: true,
      maxBytes: 16,
    });

    if (admitted) {
      assert.equal((await promise).status, 200, address);
      assert.equal(requests, 1, address);
    } else {
      await assert.rejects(promise, /private, local, reserved, or non-public/, address);
      assert.equal(requests, 0, address);
    }
  }
});

test("live metadata audit ignores canonical and noindex markup in HTML comments and raw-text elements", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-regression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  await writeFile(urlsPath, "https://example.com/page\n");
  const io = createIo();
  const html = `<!doctype html><html><head>
    <!--<script><link rel="canonical" href="https://example.com/wrong"><meta name="robots" content="noindex">-->
    <script>const comment = '<!--'; const sample = '<link rel="canonical" href="https://example.com/page"><meta name="robots" content="noindex">';</script>
    <style>.sample::after { content: '<meta name="robots" content="noindex">'; }</style>
    <link rel="canonical" href="https://example.com/page">
  </head><body></body></html>`;

  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--require-canonical",
    "--check-noindex",
    "--json",
    "--detail",
    "full",
  ], io, {
    fetch: async () => new Response(html),
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const report = JSON.parse(io.output.stdout);
  const codes = report.audits.findings.map((finding) => finding.code);

  assert.equal(code, 0);
  assert.deepEqual(codes, []);
});

test("live noindex audit applies unscoped and matching X-Robots-Tag directives only", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-regression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  await writeFile(urlsPath, [
    "https://example.com/googlebot",
    "https://example.com/unscoped",
    "https://example.com/otherbot",
    "https://example.com/scoped-list",
    "",
  ].join("\n"));
  const io = createIo();
  const headersByPath = {
    "/googlebot": "Googlebot: noindex",
    "/unscoped": "noindex, nofollow",
    "/otherbot": "Bingbot: noindex",
    "/scoped-list": "Bingbot: nofollow, noindex",
  };

  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-noindex",
    "--json",
    "--detail",
    "full",
  ], io, {
    fetch: async (input) => new Response("<html><head></head></html>", {
      headers: { "x-robots-tag": headersByPath[new URL(String(input)).pathname] },
    }),
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const report = JSON.parse(io.output.stdout);
  const urls = report.audits.findings
    .filter((finding) => finding.code === "LIVE_NOINDEX")
    .map((finding) => finding.url);

  assert.equal(code, 0);
  assert.deepEqual(urls, [
    "https://example.com/googlebot",
    "https://example.com/unscoped",
  ]);
});

test("live HTML noindex audit applies robots meta tags to the selected crawler only", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-regression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  await writeFile(urlsPath, [
    "https://example.com/googlebot-meta",
    "https://example.com/bingbot-meta",
    "",
  ].join("\n"));
  const io = createIo();

  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-noindex",
    "--robots-user-agent",
    "Bingbot",
    "--json",
    "--detail",
    "full",
  ], io, {
    fetch: async (input) => {
      const name = new URL(String(input)).pathname === "/bingbot-meta" ? "Bingbot" : "Googlebot";
      return new Response(`<html><head><meta name="${name}" content="noindex"></head></html>`);
    },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const report = JSON.parse(io.output.stdout);
  const urls = report.audits.findings
    .filter((finding) => finding.code === "LIVE_NOINDEX")
    .map((finding) => finding.url);

  assert.equal(code, 0);
  assert.deepEqual(urls, ["https://example.com/bingbot-meta"]);
});

test("live wrapper rejects save flags with --urls-file instead of reporting unwritten artifacts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-regression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  await writeFile(urlsPath, "https://example.com/page\n");

  for (const flag of ["--save-urls", "--save-url-details"]) {
    const io = createIo();
    const code = await runLiveCli([
      "--urls-file",
      urlsPath,
      flag,
      join(directory, `${flag.slice(2)}.out`),
      "--json",
    ], io);

    assert.equal(code, 2, flag);
    assert.match(io.output.stderr, /cannot be used with --urls-file/, flag);
    assert.equal(io.output.stdout, "", flag);
  }
});

test("live wrapper compact JSON does not retain XML diagnostic rows in its CI evaluation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-regression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sitemapPath = join(directory, "invalid.xml");
  await writeFile(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc><priority>2</priority></url>
</urlset>`);
  const io = createIo();
  const code = await runLiveCli([sitemapPath, "--json", "--detail", "summary"], io);
  const report = JSON.parse(io.output.stdout);

  assert.equal(code, 1);
  assert.equal(report.xml.evaluation.passed, false);
  assert.deepEqual(report.xml.evaluation.failingDiagnostics, []);
  assert.equal(report.xml.omittedDiagnostics, 2);
});

function createIo() {
  const output = { stdout: "", stderr: "" };

  return {
    output,
    stdout: { write(chunk) { output.stdout += String(chunk); } },
    stderr: { write(chunk) { output.stderr += String(chunk); } },
  };
}
