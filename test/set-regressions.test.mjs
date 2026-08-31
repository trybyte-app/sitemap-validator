import assert from "node:assert/strict";
import test from "node:test";
import { createLocalSitemapLoader, validateSitemapSet } from "../dist/index.js";

const sitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";

function sitemapIndex(locations) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="${sitemapNamespace}">
${locations.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`).join("\n")}
</sitemapindex>`;
}

test("fails a sitemap set when the default depth limit leaves child indexes unvalidated", async () => {
  const rootLocation = "https://example.com/sitemaps/index-0.xml";
  const result = await validateSitemapSet(sitemapIndex(["https://example.com/sitemaps/index-1.xml"]), {
    sourceId: "index-0.xml",
    sitemapLocation: rootLocation,
    loader: async ({ depth, loc }) => ({
      input: sitemapIndex([`https://example.com/sitemaps/index-${depth + 1}.xml`]),
      sourceId: `index-${depth}.xml`,
      sitemapLocation: loc,
    }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.summary.sources, 11);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_SET_DEPTH_LIMIT_EXCEEDED"));
});

test("does not report a depth-limit error when a boundary index only references a validated source", async () => {
  const rootLocation = "https://example.com/sitemaps/index.xml";
  const childLocation = "https://example.com/sitemaps/child-index.xml";
  const result = await validateSitemapSet(sitemapIndex([childLocation]), {
    sitemapLocation: rootLocation,
    maxDepth: 1,
    loader: async ({ loc }) => ({
      input: sitemapIndex([rootLocation]),
      sitemapLocation: loc,
    }),
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.sources, 2);
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_SET_DEPTH_LIMIT_EXCEEDED"),
    false,
  );
});

test("maps safe sitemap filenames containing two dots", async () => {
  const loader = createLocalSitemapLoader({
    publicUrlPrefix: "https://example.com/sitemaps/",
    localDirectory: "/tmp/generated-sitemaps",
  });

  const loaded = await loader({
    loc: "https://example.com/sitemaps/sitemap..xml",
    parentSourceId: "index.xml",
    depth: 1,
  });

  assert.equal(loaded?.sourceId, "sitemap..xml");
  assert.deepEqual(loaded?.input, { path: "/tmp/generated-sitemaps/sitemap..xml" });
});

test("rejects traversal and absolute child paths, including encoded and Windows separators", async () => {
  const loader = createLocalSitemapLoader({
    publicUrlPrefix: "https://example.com/sitemaps/",
    localDirectory: "/tmp/generated-sitemaps",
  });
  const unsafeLocations = [
    "https://example.com/sitemaps/../secret.xml",
    "https://example.com/sitemaps/%2e%2e/secret.xml",
    "https://example.com/sitemaps/..%2fsecret.xml",
    "https://example.com/sitemaps/..%5csecret.xml",
    "https://example.com/sitemaps/%2fetc/passwd",
    "https://example.com/sitemaps/folder%2fchild.xml",
    "https://example.com/sitemaps/C:%5cWindows%5csystem32.xml",
  ];

  for (const loc of unsafeLocations) {
    const loaded = await loader({ loc, parentSourceId: "index.xml", depth: 1 });
    assert.equal(loaded, null, loc);
  }
});

test("maps encoded filenames without treating query or fragment text as a file path", async () => {
  const loader = createLocalSitemapLoader({
    publicUrlPrefix: "https://example.com/sitemaps/",
    localDirectory: "/tmp/generated-sitemaps",
  });
  const loc = "https://example.com/sitemaps/sitemap%20one.xml?next=../secret.xml#../fragment";

  const loaded = await loader({ loc, parentSourceId: "index.xml", depth: 1 });

  assert.equal(loaded?.sourceId, "sitemap one.xml");
  assert.deepEqual(loaded?.input, { path: "/tmp/generated-sitemaps/sitemap one.xml" });
  assert.equal(loaded?.sitemapLocation, loc);
});

test("does not invoke more child loaders than the remaining source capacity", async () => {
  const locations = ["a.xml", "b.xml", "c.xml", "d.xml"].map(
    (name) => `https://example.com/sitemaps/${name}`,
  );
  let loaderInvocations = 0;

  const result = await validateSitemapSet(sitemapIndex(locations), {
    sourceId: "index.xml",
    sitemapLocation: "https://example.com/sitemaps/index.xml",
    maxSources: 2,
    loaderConcurrency: 4,
    loader: async ({ loc }) => {
      loaderInvocations += 1;
      return {
        input: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="${sitemapNamespace}"><url><loc>https://example.com/page</loc></url></urlset>`,
        sitemapLocation: loc,
      };
    },
  });

  assert.equal(loaderInvocations, 1);
  assert.equal(result.summary.sources, 2);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_SET_SOURCE_LIMIT_EXCEEDED"));
});

test("passes the set abort signal to child loaders", async () => {
  const controller = new AbortController();
  let receivedSignal;

  await validateSitemapSet(sitemapIndex(["https://example.com/sitemaps/child.xml"]), {
    signal: controller.signal,
    loader: async ({ loc, signal }) => {
      receivedSignal = signal;
      return {
        input: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="${sitemapNamespace}"><url><loc>https://example.com/page</loc></url></urlset>`,
        sitemapLocation: loc,
      };
    },
  });

  assert.equal(receivedSignal, controller.signal);
});

test("rejects promptly when aborted while a child loader remains pending", async () => {
  const controller = new AbortController();
  const abortReason = new Error("set validation aborted");
  let markLoaderStarted;
  const loaderStarted = new Promise((resolve) => {
    markLoaderStarted = resolve;
  });
  const validation = validateSitemapSet(sitemapIndex(["https://example.com/sitemaps/child.xml"]), {
    signal: controller.signal,
    loader: async () => {
      markLoaderStarted();
      return new Promise(() => {});
    },
  });

  await loaderStarted;
  controller.abort(abortReason);

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("set validation did not abort promptly")), 100);
  });

  try {
    await assert.rejects(Promise.race([validation, timeout]), (error) => error === abortReason);
  } finally {
    clearTimeout(timeoutId);
  }
});
