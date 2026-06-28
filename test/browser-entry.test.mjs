import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser entry validates uploaded XML without exposing file-system helpers", async () => {
  const browserApi = await import("../dist/browser.js");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>`;

  const result = await browserApi.validateSitemap(xml, {
    sourceId: "upload.xml",
    sitemapLocation: "https://example.com/sitemap.xml",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.urls, 1);
  assert.equal(typeof browserApi.createMemorySitemapLoader, "function");
  assert.equal("createLocalSitemapLoader" in browserApi, false);
});

test("browser entry and shared declarations do not reference Node built-ins", async () => {
  const files = await Promise.all([
    readFile("dist/browser.js", "utf8"),
    readFile("dist/browser.d.ts", "utf8"),
    readFile("dist/validator.js", "utf8"),
    readFile("dist/input.js", "utf8"),
    readFile("dist/set.js", "utf8"),
    readFile("dist/url.js", "utf8"),
    readFile("dist/types.d.ts", "utf8"),
  ]);

  for (const file of files) {
    assert.doesNotMatch(file, /node:/);
  }
});
