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

test("live wrapper checks robots.txt only when requested", async () => {
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
