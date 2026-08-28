import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { runLiveCli } from "../dist/live-cli.js";

const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/ok</loc></url>
  <url><loc>https://example.com/noindex</loc></url>
</urlset>`;

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("live wrapper validates a downloaded sitemap file and saves discovered URLs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sitemapPath = join(directory, "sitemap.xml");
  const detailsPath = join(directory, "url-details.jsonl");
  await writeFile(sitemapPath, validXml);
  const io = createIo();

  const code = await runLiveCli([
    sitemapPath,
    "--sitemap-location",
    "https://example.com/sitemap.xml",
    "--save-url-details",
    detailsPath,
    "--json",
    "--detail",
    "full",
  ], io);
  const report = JSON.parse(io.output.stdout);
  const savedDetails = (await readFile(detailsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(code, 0);
  assert.equal(report.target, sitemapPath);
  assert.equal(report.xml.evaluation.passed, true);
  assert.equal(report.xml.summary.urls, 2);
  assert.equal(report.audits.totalUrls, 2);
  assert.deepEqual(savedDetails, [
    {
      url: "https://example.com/ok",
      sourceSitemap: sitemapPath,
    },
    {
      url: "https://example.com/noindex",
      sourceSitemap: sitemapPath,
    },
  ]);
  assert.match(io.output.stderr, /\[sitemap-validator-live\] Live sitemap check started/);
  assert.match(io.output.stderr, /Reading root sitemap file/);
});

test("live wrapper validates local child files from a downloaded sitemap index", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const indexPath = join(directory, "sitemap-index.xml");
  const childPath = join(directory, "child.xml");
  const detailsPath = join(directory, "url-details.jsonl");
  await writeFile(indexPath, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/child.xml</loc></sitemap>
</sitemapindex>`);
  await writeFile(childPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/from-child</loc></url>
</urlset>`);
  const io = createIo();

  const code = await runLiveCli([
    indexPath,
    "--sitemap-location",
    "https://example.com/sitemap-index.xml",
    "--public-url-prefix",
    "https://example.com/",
    "--local-sitemap-root",
    directory,
    "--save-url-details",
    detailsPath,
    "--json",
    "--detail",
    "full",
  ], io);
  const report = JSON.parse(io.output.stdout);
  const savedDetails = (await readFile(detailsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(code, 0);
  assert.equal(report.xml.summary.sources, 2);
  assert.equal(report.xml.summary.urls, 1);
  assert.deepEqual(savedDetails, [
    {
      url: "https://example.com/from-child",
      sourceSitemap: "child.xml",
    },
  ]);
});

test("live wrapper fetches a sitemap, saves URLs, and runs opt-in page audits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  const detailsPath = join(directory, "url-details.jsonl");
  const fetcher = createFakeFetch({
    "GET https://example.com/sitemap.xml": new Response(validXml, {
      status: 200,
      headers: {
        "content-type": "application/xml",
      },
    }),
    "HEAD https://example.com/ok": new Response(null, { status: 200 }),
    "GET https://example.com/ok": new Response(`<html><head><link rel="canonical" href="https://example.com/ok"></head></html>`, {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    }),
    "HEAD https://example.com/noindex": new Response(null, { status: 200 }),
    "GET https://example.com/noindex": new Response(`<html><head><link rel="canonical" href="https://example.com/other"><meta name="robots" content="noindex"></head></html>`, {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    }),
  });
  const io = createIo();

  const code = await runLiveCli([
    "https://example.com/sitemap.xml",
    "--save-urls",
    urlsPath,
    "--save-url-details",
    detailsPath,
    "--check-status",
    "--check-canonical",
    "--check-noindex",
    "--json",
    "--detail",
    "full",
    "--audit-fail-on",
    "warning",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);
  const savedUrls = await readFile(urlsPath, "utf8");
  const savedDetails = (await readFile(detailsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(code, 1);
  assert.equal(report.xml.evaluation.passed, true);
  assert.equal(report.audits.totalUrls, 2);
  assert.equal(report.audits.savedUrlDetailsTo, detailsPath);
  assert.equal(report.audits.findings.some((finding) => finding.code === "LIVE_CANONICAL_MISMATCH"), true);
  assert.equal(report.audits.findings.some((finding) => finding.code === "LIVE_NOINDEX"), true);
  assert.equal(report.audits.findings.find((finding) => finding.code === "LIVE_CANONICAL_MISMATCH").context.sourceSitemap, "https://example.com/sitemap.xml");
  assert.deepEqual(savedDetails, [
    {
      url: "https://example.com/ok",
      sourceSitemap: "https://example.com/sitemap.xml",
    },
    {
      url: "https://example.com/noindex",
      sourceSitemap: "https://example.com/sitemap.xml",
    },
  ]);
  assert.match(savedUrls, /https:\/\/example\.com\/ok/);
  assert.match(savedUrls, /https:\/\/example\.com\/noindex/);
  assert.match(io.output.stderr, /\[sitemap-validator-live\] Live sitemap check started/);
  assert.match(io.output.stderr, /XML validation finished/);
  assert.match(io.output.stderr, /Live URL audits finished/);
});

test("live wrapper can suppress progress logs", async () => {
  const fetcher = createFakeFetch({
    "GET https://example.com/sitemap.xml": new Response(validXml, {
      status: 200,
      headers: {
        "content-type": "application/xml",
      },
    }),
  });
  const io = createIo();

  const code = await runLiveCli([
    "https://example.com/sitemap.xml",
    "--quiet",
    "--json",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);

  assert.equal(code, 0);
  assert.equal(report.xml.evaluation.passed, true);
  assert.equal(io.output.stderr, "");
});

test("live wrapper can run duplicate audits from a saved URL file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "url-details.jsonl");
  await writeFile(urlsPath, [
    JSON.stringify({ url: "https://example.com/a", sourceSitemap: "https://example.com/one.xml" }),
    JSON.stringify({ url: "https://example.com/a", sourceSitemap: "https://example.com/two.xml" }),
    JSON.stringify({ url: "https://example.com/b", sourceSitemap: "https://example.com/two.xml" }),
    "",
  ].join("\n"));
  const io = createIo();

  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-duplicates",
    "--json",
    "--detail",
    "full",
    "--audit-fail-on",
    "warning",
  ], io);
  const report = JSON.parse(io.output.stdout);

  assert.equal(code, 1);
  assert.equal(report.xml.validationSkipped, true);
  assert.equal(report.audits.findings.length, 1);
  assert.equal(report.audits.findings[0].code, "LIVE_DUPLICATE_URL");
  assert.equal(report.audits.findings[0].context.sourceSitemap, "https://example.com/one.xml");
  assert.deepEqual(report.audits.findings[0].context.sourceSitemapSamples, [
    "https://example.com/one.xml",
    "https://example.com/two.xml",
  ]);
});

test("live wrapper reports URLs disallowed by robots.txt when the robots audit is enabled", async () => {
  const fetcher = createFakeFetch({
    "GET https://example.com/robots.txt": new Response("User-agent: Googlebot\nDisallow: /blocked\n", {
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
    }),
  });
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  const urlsPath = join(directory, "urls.txt");

  try {
    await writeFile(urlsPath, "https://example.com/blocked/page\n");
    const io = createIo();
    const code = await runLiveCli([
      "--urls-file",
      urlsPath,
      "--check-robots",
      "--json",
      "--detail",
      "full",
      "--audit-fail-on",
      "warning",
    ], io, { fetch: fetcher, resolveHost: publicResolver });
    const report = JSON.parse(io.output.stdout);

    assert.equal(code, 1);
    assert.equal(report.audits.findings.some((finding) => finding.code === "LIVE_ROBOTS_DISALLOWED"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("live wrapper does not fetch URLs without an opt-in audit flag", async (t) => {
  const urlsPath = await createUrlsFile(t, "https://example.com/page\n");
  let requests = 0;
  const io = createIo();
  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--json",
    "--detail",
    "full",
  ], io, {
    fetch: async () => {
      requests += 1;
      throw new Error("Live URL fetch should remain opt-in.");
    },
    resolveHost: publicResolver,
  });
  const report = JSON.parse(io.output.stdout);

  assert.equal(code, 0);
  assert.equal(requests, 0);
  assert.deepEqual(report.audits.enabledChecks, []);
  assert.deepEqual(report.audits.findings, []);
});

test("live wrapper distinguishes redirect, bad, and unreachable status results", async (t) => {
  const urlsPath = await createUrlsFile(t, [
    "https://example.com/redirect",
    "https://example.com/bad",
    "https://example.com/unreachable",
    "",
  ].join("\n"));
  const fetcher = createFakeFetch({
    "HEAD https://example.com/redirect": new Response(null, {
      status: 302,
      headers: { location: "https://example.com/final" },
    }),
    "HEAD https://example.com/bad": new Response(null, { status: 503 }),
  });
  const io = createIo();
  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-status",
    "--json",
    "--detail",
    "full",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);
  const codes = report.audits.findings.map((finding) => finding.code);

  assert.equal(code, 1);
  assert.ok(codes.includes("LIVE_STATUS_REDIRECT"));
  assert.ok(codes.includes("LIVE_STATUS_BAD"));
  assert.ok(codes.includes("LIVE_STATUS_UNREACHABLE"));
});

test("live wrapper reports canonical and page-fetch failures separately", async (t) => {
  const urlsPath = await createUrlsFile(t, [
    "https://example.com/missing",
    "https://example.com/invalid",
    "https://example.com/bad",
    "https://example.com/unreachable",
    "",
  ].join("\n"));
  const fetcher = createFakeFetch({
    "GET https://example.com/missing": new Response("<html><head></head></html>"),
    "GET https://example.com/invalid": new Response('<html><head><link rel="canonical" href="http://["></head></html>'),
    "GET https://example.com/bad": new Response("unavailable", { status: 503 }),
  });
  const io = createIo();
  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--require-canonical",
    "--json",
    "--detail",
    "full",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);
  const codes = report.audits.findings.map((finding) => finding.code);

  assert.equal(code, 1);
  assert.ok(codes.includes("LIVE_CANONICAL_MISSING"));
  assert.ok(codes.includes("LIVE_CANONICAL_INVALID"));
  assert.ok(codes.includes("LIVE_PAGE_STATUS_BAD"));
  assert.ok(codes.includes("LIVE_PAGE_UNREACHABLE"));
});

test("live wrapper distinguishes unavailable and unreachable robots.txt", async (t) => {
  const urlsPath = await createUrlsFile(t, [
    "https://unavailable.example/page",
    "https://unreachable.example/page",
    "",
  ].join("\n"));
  const fetcher = createFakeFetch({
    "GET https://unavailable.example/robots.txt": new Response("unavailable", { status: 503 }),
  });
  const io = createIo();
  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-robots",
    "--audit-fail-on",
    "warning",
    "--json",
    "--detail",
    "full",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);
  const codes = report.audits.findings.map((finding) => finding.code);

  assert.equal(code, 1);
  assert.ok(codes.includes("LIVE_ROBOTS_UNAVAILABLE"));
  assert.ok(codes.includes("LIVE_ROBOTS_UNREACHABLE"));
});

test("live wrapper reports invalid saved URLs and caps stored findings", async (t) => {
  const urlsPath = await createUrlsFile(t, "not a url\nhttps://example.com/bad-a\nhttps://example.com/bad-b\n");
  const fetcher = createFakeFetch({
    "HEAD https://example.com/bad-a": new Response(null, { status: 500 }),
    "HEAD https://example.com/bad-b": new Response(null, { status: 500 }),
  });
  const io = createIo();
  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-status",
    "--max-audit-findings",
    "1",
    "--json",
    "--detail",
    "full",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);

  assert.equal(code, 1);
  assert.equal(report.audits.counts.errors, 3);
  assert.equal(report.audits.findings.length, 1);
  assert.equal(report.audits.findings[0].code, "LIVE_URL_INVALID");
  assert.equal(report.audits.omittedFindings, 2);
});

test("live wrapper reports when the configured URL audit sample is exhausted", async (t) => {
  const urlsPath = await createUrlsFile(t, "https://example.com/a\nhttps://example.com/b\n");
  const fetcher = createFakeFetch({
    "HEAD https://example.com/a": new Response(null, { status: 200 }),
  });
  const io = createIo();
  const code = await runLiveCli([
    "--urls-file",
    urlsPath,
    "--check-status",
    "--max-audit-urls",
    "1",
    "--json",
    "--detail",
    "full",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);

  assert.equal(code, 0);
  assert.equal(report.audits.auditedUrls, 1);
  assert.ok(report.audits.findings.some((finding) => finding.code === "LIVE_AUDIT_URL_LIMIT_EXCEEDED"));
});

test("live wrapper traverses sitemap indexes and gzipped child sitemaps", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  const detailsPath = join(directory, "url-details.jsonl");
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/child-a.xml</loc></sitemap>
  <sitemap><loc>https://example.com/child-b.xml.gz</loc></sitemap>
</sitemapindex>`;
  const childA = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
</urlset>`;
  const childB = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/b</loc></url>
</urlset>`;
  const fetcher = createFakeFetch({
    "GET https://example.com/sitemap-index.xml": new Response(indexXml, {
      status: 200,
      headers: { "content-type": "application/xml" },
    }),
    "GET https://example.com/child-a.xml": new Response(childA, {
      status: 200,
      headers: { "content-type": "application/xml" },
    }),
    "GET https://example.com/child-b.xml.gz": new Response(gzipSync(Buffer.from(childB)), {
      status: 200,
      headers: { "content-type": "application/gzip" },
    }),
  });
  const io = createIo();

  const code = await runLiveCli([
    "https://example.com/sitemap-index.xml",
    "--save-urls",
    urlsPath,
    "--save-url-details",
    detailsPath,
    "--json",
    "--detail",
    "full",
  ], io, { fetch: fetcher, resolveHost: publicResolver });
  const report = JSON.parse(io.output.stdout);
  const savedUrls = await readFile(urlsPath, "utf8");
  const savedDetails = (await readFile(detailsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(code, 0);
  assert.equal(report.xml.summary.sources, 3);
  assert.equal(report.xml.summary.urls, 2);
  assert.deepEqual(savedDetails, [
    {
      url: "https://example.com/a",
      sourceSitemap: "https://example.com/child-a.xml",
    },
    {
      url: "https://example.com/b",
      sourceSitemap: "https://example.com/child-b.xml.gz",
    },
  ]);
  assert.match(savedUrls, /https:\/\/example\.com\/a/);
  assert.match(savedUrls, /https:\/\/example\.com\/b/);
});

test("live wrapper blocks private hosts unless explicitly allowed", async () => {
  let called = false;
  const privateXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://127.0.0.1/ok</loc></url>
</urlset>`;
  const fetcher = async () => {
    called = true;
    return new Response(privateXml, {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  };
  const blockedIo = createIo();

  const blockedCode = await runLiveCli([
    "http://127.0.0.1/sitemap.xml",
  ], blockedIo, { fetch: fetcher, resolveHost: publicResolver });

  assert.equal(blockedCode, 1);
  assert.equal(called, false);
  assert.match(blockedIo.output.stderr, /Refusing to fetch/);

  const allowedIo = createIo();
  const allowedCode = await runLiveCli([
    "http://127.0.0.1/sitemap.xml",
    "--allow-private-hosts",
  ], allowedIo, { fetch: fetcher, resolveHost: publicResolver });

  assert.equal(allowedCode, 0);
  assert.equal(called, true);
});

function createIo() {
  const output = {
    stdout: "",
    stderr: "",
  };

  return {
    output,
    stdout: {
      write(chunk) {
        output.stdout += String(chunk);
      },
    },
    stderr: {
      write(chunk) {
        output.stderr += String(chunk);
      },
    },
  };
}

function createFakeFetch(responses) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const response = responses[`${method} ${url}`];

    if (!response) {
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }

    return response.clone();
  };
}

async function createUrlsFile(t, contents) {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-live-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "urls.txt");
  await writeFile(path, contents);
  return path;
}
