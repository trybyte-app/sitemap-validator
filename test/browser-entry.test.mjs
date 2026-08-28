import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  const runtimeGraph = await readRelativeModuleGraph("dist/browser.js");
  const declarationGraph = await readRelativeModuleGraph("dist/browser.d.ts");
  const files = [...runtimeGraph.values(), ...declarationGraph.values()];

  for (const file of files) {
    assert.doesNotMatch(file, /node:/);
  }

  assert.equal([...runtimeGraph.keys()].some((path) => path.endsWith("/extension-validation.js")), true);
});

async function readRelativeModuleGraph(entryPath) {
  const pending = [resolve(entryPath)];
  const files = new Map();

  while (pending.length > 0) {
    const path = pending.pop();

    if (!path || files.has(path)) {
      continue;
    }

    const source = await readFile(path, "utf8");
    files.set(path, source);

    for (const specifier of moduleSpecifiers(source)) {
      assert.equal(specifier.startsWith("node:"), false, `${path} imports ${specifier}`);

      if (specifier.startsWith(".")) {
        pending.push(resolveModuleSpecifier(path, specifier));
      }
    }
  }

  return files;
}

function moduleSpecifiers(source) {
  return [...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

function resolveModuleSpecifier(importerPath, specifier) {
  const resolved = resolve(dirname(importerPath), specifier);

  return importerPath.endsWith(".d.ts") && resolved.endsWith(".js")
    ? `${resolved.slice(0, -3)}.d.ts`
    : resolved;
}
