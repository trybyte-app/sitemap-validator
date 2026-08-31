import assert from "node:assert/strict";
import test from "node:test";

import { validateSitemap } from "../dist/index.js";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

test("rejects foreign elements outside the url extension point", async () => {
  const documents = [
    [`<urlset xmlns="${SITEMAP_NS}" xmlns:ext="https://example.com/ext">
      <url><loc>https://example.com/page</loc></url>
      <ext:metadata />
    </urlset>`, "UNEXPECTED_SITEMAP_ELEMENT"],
    [`<sitemapindex xmlns="${SITEMAP_NS}" xmlns:ext="https://example.com/ext">
      <sitemap><loc>https://example.com/child.xml</loc></sitemap>
      <ext:metadata />
    </sitemapindex>`, "UNEXPECTED_SITEMAP_ELEMENT"],
    [`<sitemapindex xmlns="${SITEMAP_NS}" xmlns:ext="https://example.com/ext">
      <sitemap><ext:metadata /><loc>https://example.com/child.xml</loc></sitemap>
    </sitemapindex>`, "UNEXPECTED_SITEMAP_ELEMENT"],
    [`<urlset xmlns="${SITEMAP_NS}" xmlns:ext="https://example.com/ext">
      <url><ext:metadata /><loc>https://example.com/page</loc></url>
    </urlset>`, "SITEMAP_ELEMENT_OUT_OF_ORDER"],
    [`<urlset xmlns="${SITEMAP_NS}" xmlns:ext="https://example.com/ext">
      <url><loc>https://example.com/<ext:path /></loc></url>
    </urlset>`, "UNEXPECTED_SITEMAP_ELEMENT"],
  ];

  for (const [xml, expectedCode] of documents) {
    const result = await validateSitemap(xml);
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === expectedCode));
  }

  const validExtension = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}" xmlns:ext="https://example.com/ext">
    <url>
      <loc>https://example.com/page</loc>
      <ext:metadata><ext:value>kept</ext:value></ext:metadata>
    </url>
  </urlset>`);

  assert.equal(validExtension.valid, true);
  assert.equal(validExtension.diagnostics.some((diagnostic) => diagnostic.code === "UNEXPECTED_SITEMAP_ELEMENT"), false);
});

test("rejects character data in element-only sitemap and extension containers", async () => {
  const documents = [
    `<urlset xmlns="${SITEMAP_NS}">garbage<url><loc>https://example.com/page</loc></url></urlset>`,
    `<urlset xmlns="${SITEMAP_NS}"><url>garbage<loc>https://example.com/page</loc></url></urlset>`,
    `<urlset xmlns="${SITEMAP_NS}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url>
        <loc>https://example.com/page</loc>
        <image:image><![CDATA[garbage]]><image:loc>https://example.com/image.jpg</image:loc></image:image>
      </url>
    </urlset>`,
  ];

  for (const xml of documents) {
    const result = await validateSitemap(xml);
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_TEXT_UNEXPECTED"));
  }

  const whitespaceOnly = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
    <url>
      <loc>https://example.com/page</loc>
    </url>
  </urlset>`);

  assert.equal(whitespaceOnly.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_TEXT_UNEXPECTED"), false);
});

test("reports an invalid sitemapLocation instead of disabling location checks silently", async () => {
  const xml = `<urlset xmlns="${SITEMAP_NS}">
    <url><loc>https://example.com/page</loc></url>
  </urlset>`;

  for (const sitemapLocation of ["not-a-url", ""]) {
    const result = await validateSitemap(xml, { sitemapLocation });

    assert.equal(result.valid, false, JSON.stringify(sitemapLocation));
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_ABSOLUTE_URL"),
      JSON.stringify(sitemapLocation),
    );
  }
});

test("enforces XML Schema year and timezone bounds for sitemap and Google extension dates", async () => {
  const invalidLastmods = [
    "0000-01-01",
    "2026-08-30T12:00:00+14:01",
    "2026-08-30T12:00:00+15:00",
    "2026-08-30T12:00:00-23:59",
  ];

  for (const lastmod of invalidLastmods) {
    const result = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
      <url><loc>https://example.com/page</loc><lastmod>${lastmod}</lastmod></url>
    </urlset>`);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_LASTMOD"));
  }

  for (const lastmod of ["2026-08-30", "2026-08-30T12:00:00+14:00", "2026-08-30T12:00:00-14:00"]) {
    const result = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
      <url><loc>https://example.com/page</loc><lastmod>${lastmod}</lastmod></url>
    </urlset>`);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_LASTMOD"), false);
  }

  const videoResult = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}"
    xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
    <url>
      <loc>https://example.com/page</loc>
      <video:video>
        <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
        <video:title>Example</video:title>
        <video:description>Example video</video:description>
        <video:content_loc>https://example.com/video.mp4</video:content_loc>
        <video:publication_date>2026-08-30T12:00:00+14:01</video:publication_date>
      </video:video>
    </url>
  </urlset>`);

  assert.ok(videoResult.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_VIDEO_PUBLICATION_DATE_INVALID"));
});

test("accepts the full XML Schema decimal lexical space for in-range priority values", async () => {
  for (const priority of [".5", "+0.5", "00.5", "1.", "0.", "-0"]) {
    const result = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
      <url><loc>https://example.com/page</loc><priority>${priority}</priority></url>
    </urlset>`);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_PRIORITY"), false);
  }

  for (const priority of ["1e0", "1.01", "-0.1"]) {
    const result = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
      <url><loc>https://example.com/page</loc><priority>${priority}</priority></url>
    </urlset>`);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_PRIORITY"));
  }
});

test("counts Unicode code points for loc and Google extension string limits", async () => {
  const maxLengthLoc = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
    <url><loc>https://x.co/😀</loc></url>
  </urlset>`, { limits: { maxLocLength: 14 } });
  assert.equal(maxLengthLoc.diagnostics.some((diagnostic) => diagnostic.code === "LOC_TOO_LONG"), false);

  const shortLoc = await validateSitemap(`<urlset xmlns="${SITEMAP_NS}">
    <url><loc>http://x/😀😀</loc></url>
  </urlset>`);
  assert.ok(shortLoc.diagnostics.some((diagnostic) => diagnostic.code === "LOC_TOO_SHORT"));

  const titleAtLimit = "😀".repeat(100);
  const titleOverLimit = "😀".repeat(101);
  const videoXml = (title) => `<urlset xmlns="${SITEMAP_NS}"
    xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
    <url>
      <loc>https://example.com/page</loc>
      <video:video>
        <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
        <video:title>${title}</video:title>
        <video:description>Example video</video:description>
        <video:content_loc>https://example.com/video.mp4</video:content_loc>
      </video:video>
    </url>
  </urlset>`;

  const atLimit = await validateSitemap(videoXml(titleAtLimit));
  const overLimit = await validateSitemap(videoXml(titleOverLimit));
  assert.equal(atLimit.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_VIDEO_TITLE_TOO_LONG"), false);
  assert.ok(overLimit.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_VIDEO_TITLE_TOO_LONG"));
});

test("propagates AbortSignal cancellation instead of returning an XML parse diagnostic", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    validateSitemap(`<urlset xmlns="${SITEMAP_NS}"><url><loc>https://example.com/page</loc></url></urlset>`, {
      signal: controller.signal,
    }),
    (error) => error?.name === "AbortError",
  );

  const delayedController = new AbortController();
  const abortReason = new Error("aborted while waiting for input completion");
  let markWaitingForDone;
  let releaseDone;
  const waitingForDone = new Promise((resolve) => { markWaitingForDone = resolve; });
  const doneGate = new Promise((resolve) => { releaseDone = resolve; });

  async function* delayedCompletion() {
    yield `<urlset xmlns="${SITEMAP_NS}"><url><loc>https://example.com/page</loc></url></urlset>`;
    markWaitingForDone();
    await doneGate;
  }

  const validation = validateSitemap(delayedCompletion(), { signal: delayedController.signal });
  await waitingForDone;
  delayedController.abort(abortReason);
  releaseDone();

  await assert.rejects(validation, (error) => error === abortReason);
});
