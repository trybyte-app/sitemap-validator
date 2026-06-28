import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  createMemorySitemapLoader,
  validateSitemap,
  validateSitemapEvents,
  validateSitemapSet,
} from "../dist/index.js";

const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-06-10</lastmod>
  </url>
</urlset>`;

test("validates a minimal XML sitemap", async () => {
  const result = await validateSitemap(validXml, {
    sourceId: "minimal.xml",
    sitemapLocation: "https://example.com/sitemap.xml",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.urls, 1);
  assert.equal(result.diagnostics.length, 0);
});

test("requires the exact quoted Sitemap 0.9 namespace", async () => {
  const wrongNamespace = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.90">
  <url><loc>https://example.com/</loc></url>
</urlset>`;
  const unquotedNamespace = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns=http://www.sitemaps.org/schemas/sitemap/0.9>
  <url><loc>https://example.com/</loc></url>
</urlset>`;

  const wrongNamespaceResult = await validateSitemap(wrongNamespace);
  const unquotedNamespaceResult = await validateSitemap(unquotedNamespace);

  assert.equal(wrongNamespaceResult.valid, false);
  assert.ok(wrongNamespaceResult.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_SITEMAP_NAMESPACE"));
  assert.equal(unquotedNamespaceResult.valid, false);
  assert.ok(unquotedNamespaceResult.diagnostics.some((diagnostic) => diagnostic.code === "XML_PARSE_ERROR"));
});

test("accepts numeric priority text and rejects generator-quoted priority text", async () => {
  const numericPriority = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <priority>0.9</priority>
  </url>
</urlset>`;
  const quotedPriority = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <priority>"0.9"</priority>
  </url>
</urlset>`;

  const numericResult = await validateSitemap(numericPriority);
  const quotedResult = await validateSitemap(quotedPriority);

  assert.equal(numericResult.valid, true);
  assert.equal(numericResult.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_PRIORITY"), false);
  assert.equal(quotedResult.valid, false);
  assert.ok(quotedResult.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_PRIORITY"));
});

test("reports protocol and Google warnings for invalid optional fields", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <changefreq>sometimes</changefreq>
    <priority>2</priority>
  </url>
</urlset>`;

  const result = await validateSitemap(xml, { sourceId: "optional.xml" });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("INVALID_CHANGEFREQ"));
  assert.ok(codes.includes("INVALID_PRIORITY"));
  assert.ok(codes.includes("GOOGLE_IGNORES_CHANGEFREQ"));
  assert.ok(codes.includes("GOOGLE_IGNORES_PRIORITY"));
});

test("supports rule disabling, severity overrides, and Google profile toggle", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <changefreq>daily</changefreq>
    <priority>2</priority>
  </url>
</urlset>`;

  const configured = await validateSitemap(xml, {
    disabledRules: ["INVALID_PRIORITY"],
    severityOverrides: {
      GOOGLE_IGNORES_PRIORITY: "info",
    },
  });

  assert.equal(configured.valid, true);
  assert.ok(configured.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_IGNORES_PRIORITY" && diagnostic.severity === "info"));

  const googleOff = await validateSitemap(xml, {
    disabledRules: ["INVALID_PRIORITY"],
    google: false,
  });

  assert.equal(googleOff.valid, true);
  assert.equal(googleOff.diagnostics.some((diagnostic) => diagnostic.source === "google"), false);
});

test("does not treat repeated page URLs as XML sitemap validity errors", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/a</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.equal(result.summary.urls, 2);
  assert.deepEqual(result.diagnostics, []);
});

test("validates gzip input", async () => {
  const result = await validateSitemap(gzipSync(Buffer.from(validXml)), {
    gzip: true,
    sourceId: "minimal.xml.gz",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.urls, 1);
});

test("rejects impossible W3C date values", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <lastmod>2026-02-31</lastmod>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_LASTMOD"));
});

test("rejects reduced-precision sitemap lastmod values", async () => {
  const urlset = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <lastmod>2026</lastmod>
  </url>
</urlset>`;
  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-a.xml</loc>
    <lastmod>2026-06</lastmod>
  </sitemap>
</sitemapindex>`;

  const urlsetResult = await validateSitemap(urlset);
  const indexResult = await validateSitemap(sitemapIndex);
  const urlsetDiagnostic = urlsetResult.diagnostics.find((diagnostic) => diagnostic.code === "INVALID_LASTMOD");

  assert.equal(urlsetResult.valid, false);
  assert.equal(indexResult.valid, false);
  assert.match(urlsetDiagnostic?.message ?? "", /complete W3C date/);
  assert.ok(indexResult.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_LASTMOD"));
});

test("rejects doctype declarations", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE urlset [
  <!ENTITY unsafe "https://example.com/">
]>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>&unsafe;</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "XML_DOCTYPE_NOT_ALLOWED"));
});

test("emits progress events for enterprise consumers", async () => {
  const events = [];

  for await (const event of validateSitemapEvents(validXml, {
    sourceId: "events.xml",
    onProgress(progress) {
      events.push(progress.type);
    },
  })) {
    events.push(`iter:${event.type}`);
  }

  assert.ok(events.includes("source:start"));
  assert.ok(events.includes("sitemap:url"));
  assert.ok(events.includes("summary"));
  assert.ok(events.includes("iter:summary"));
});

test("validates basic Google hreflang extension shape", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/" />
    <xhtml:link rel="alternate" hreflang="fa-ir" href="https://example.com/fa/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
});

test("traverses child sitemaps through an explicit loader", async () => {
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemaps/child.xml</loc></sitemap>
</sitemapindex>`;
  const childXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/sitemaps/page-a</loc></url>
</urlset>`;

  const result = await validateSitemapSet(indexXml, {
    sourceId: "index.xml",
    sitemapLocation: "https://example.com/sitemaps/index.xml",
    loader: async ({ loc }) => {
      assert.equal(loc, "https://example.com/sitemaps/child.xml");
      return {
        input: childXml,
        sourceId: "child.xml",
        sitemapLocation: loc,
      };
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.sources, 2);
  assert.equal(result.summary.urls, 1);
  assert.equal(result.summary.sitemaps, 1);
});

test("recursively traverses nested sitemap indexes and does not reload repeated children", async () => {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemaps/nested.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemaps/nested.xml</loc></sitemap>
</sitemapindex>`;
  const nested = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemaps/child.xml</loc></sitemap>
</sitemapindex>`;
  const child = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/sitemaps/page-a</loc></url>
</urlset>`;

  const result = await validateSitemapSet(root, {
    sourceId: "root.xml",
    sitemapLocation: "https://example.com/sitemaps/root.xml",
    loader: createMemorySitemapLoader({
      sources: {
        "https://example.com/sitemaps/nested.xml": {
          input: nested,
          sourceId: "nested.xml",
          sitemapLocation: "https://example.com/sitemaps/nested.xml",
        },
        "https://example.com/sitemaps/child.xml": {
          input: child,
          sourceId: "child.xml",
          sitemapLocation: "https://example.com/sitemaps/child.xml",
        },
      },
    }),
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.sources, 3);
  assert.equal(result.summary.urls, 1);
  assert.deepEqual(result.diagnostics, []);
});

test("does not apply sitemap file path constraints to image URLs", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/sitemaps/page-a</loc>
    <image:image>
      <image:loc>https://cdn.example.net/images/a.jpg</image:loc>
    </image:image>
  </url>
</urlset>`;

  const result = await validateSitemap(xml, {
    sitemapLocation: "https://example.com/sitemaps/sitemap.xml",
  });

  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "URL_OUTSIDE_SITEMAP_HOST"), false);
});

test("reports unsafe raw URI characters", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a b</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "URL_UNSAFE_CHARACTER"));
});

test("accepts RFC3987 IRI URLs with non-ASCII characters", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/ümlat</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
});

test("reports invalid percent encoding", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/%zz</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_PERCENT_ENCODING"));
});

test("reports percent-encoded control characters and invalid UTF-8", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/%00</loc></url>
  <url><loc>https://example.com/%C3%28</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("URL_PERCENT_ENCODED_CONTROL_CHARACTER"));
  assert.ok(codes.includes("URL_PERCENT_ENCODING_INVALID_UTF8"));
});

test("validates percent-encoded UTF-8 per contiguous byte run", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/%C3/path/%BC</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "URL_PERCENT_ENCODING_INVALID_UTF8"));
});

test("warns on suspicious double encoding", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/%252Fproducts</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "URL_SUSPICIOUS_DOUBLE_ENCODING"));
});

test("reports hostname label length violations", async () => {
  const longLabel = "a".repeat(64);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${longLabel}.example.com/a</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "URL_HOST_LABEL_TOO_LONG"));
});

test("adds URL validation layer metadata to URL diagnostics", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a b</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);
  const diagnostic = result.diagnostics.find((item) => item.code === "URL_UNSAFE_CHARACTER");

  assert.equal(diagnostic?.context?.layer, "rfc3986");
  assert.equal(diagnostic?.context?.url && typeof diagnostic.context.url, "object");
});

test("reports XML entity escaping failures", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/?a=1&b=2</loc></url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "XML_PARSE_ERROR"));
});

test("reports deprecated image sitemap tags", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/a</loc>
    <image:image>
      <image:loc>https://example.com/a.jpg</image:loc>
      <image:title>Old field</image:title>
    </image:image>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_IMAGE_TAG_DEPRECATED"));
});

test("enforces image extension XSD cardinality for deprecated optional fields", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/a</loc>
    <image:image>
      <image:loc>https://example.com/a.jpg</image:loc>
      <image:title>One</image:title>
      <image:title>Two</image:title>
    </image:image>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_IMAGE_TAG_DEPRECATED"));
  assert.ok(codes.includes("GOOGLE_IMAGE_ELEMENT_DUPLICATE"));
});

test("requires hreflang self reference and rejects duplicate hreflang values", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="fa" href="https://example.com/fa/" />
    <xhtml:link rel="alternate" hreflang="fa" href="https://example.com/fa-duplicate/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_HREFLANG_DUPLICATE"));
  assert.ok(codes.includes("GOOGLE_HREFLANG_SELF_REFERENCE_MISSING"));
});

test("normalizes hreflang href values before checking self references", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_HREFLANG_SELF_REFERENCE_MISSING"), false);
});

test("validates hreflang with BCP47 and Google-supported syntax", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en_US" href="https://example.com/en/" />
  </url>
  <url>
    <loc>https://example.com/es/</loc>
    <xhtml:link rel="alternate" hreflang="es-419" href="https://example.com/es/" />
  </url>
  <url>
    <loc>https://example.com/zh/</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hans-US" href="https://example.com/zh/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_HREFLANG_INVALID"));
  assert.ok(codes.includes("GOOGLE_HREFLANG_UNSUPPORTED_CODE"));
});

test("validates deeper video sitemap fields", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/a</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Example</video:title>
      <video:description>${"x".repeat(2050)}</video:description>
      <video:content_loc>https://example.com/videos/a</video:content_loc>
      <video:duration>999999</video:duration>
      <video:rating>8</video:rating>
      <video:family_friendly>maybe</video:family_friendly>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_VIDEO_DESCRIPTION_TOO_LONG"));
  assert.ok(codes.includes("GOOGLE_VIDEO_CONTENT_LOC_EQUALS_PAGE_LOC"));
  assert.ok(codes.includes("GOOGLE_VIDEO_DURATION_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_RATING_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_FAMILY_FRIENDLY_INVALID"));
});

test("validates additional video relationship and subscription fields", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/b</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb-b.jpg</video:thumbnail_loc>
      <video:title>Example</video:title>
      <video:description>Example description</video:description>
      <video:content_loc>https://example.com/videos/b.mp4</video:content_loc>
      <video:requires_subscription>maybe</video:requires_subscription>
      <video:restriction relationship="maybe">US</video:restriction>
      <video:platform relationship="sometimes">web</video:platform>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_VIDEO_REQUIRES_SUBSCRIPTION_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_RESTRICTION_RELATIONSHIP_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PLATFORM_RELATIONSHIP_INVALID"));
});

test("warns on long news titles", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://example.com/news/a</loc>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-06-10</news:publication_date>
      <news:title>${"A".repeat(111)}</news:title>
    </news:news>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_NEWS_TITLE_TOO_LONG"));
});

test("uses Google-specific diagnostics for invalid extension dates", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/news/invalid-date</loc>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-13-40</news:publication_date>
      <news:title>Invalid date</news:title>
    </news:news>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Invalid dates</video:title>
      <video:description>Invalid video dates</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
      <video:expiration_date>2026-13-40</video:expiration_date>
      <video:publication_date>2026-13-40</video:publication_date>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_NEWS_PUBLICATION_DATE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_EXPIRATION_DATE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PUBLICATION_DATE_INVALID"));
  assert.equal(codes.includes("INVALID_LASTMOD"), false);
});

test("recognizes and validates legacy Google News XSD fields", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://example.com/news/xsd</loc>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:access>Closed</news:access>
      <news:genres>BadGenre</news:genres>
      <news:publication_date>2026-06-12</news:publication_date>
      <news:title>Legacy XSD fields</news:title>
      <news:keywords>markets, technology</news:keywords>
      <news:stock_tickers>NASDAQ:A,NASDAQ:B,NASDAQ:C,NASDAQ:D,NASDAQ:E,NASDAQ:F</news:stock_tickers>
    </news:news>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_NEWS_TAG_DEPRECATED"));
  assert.ok(codes.includes("GOOGLE_NEWS_ACCESS_INVALID"));
  assert.ok(codes.includes("GOOGLE_NEWS_GENRES_INVALID"));
  assert.ok(codes.includes("GOOGLE_NEWS_STOCK_TICKERS_INVALID"));
  assert.equal(codes.includes("GOOGLE_NEWS_UNKNOWN_TAG"), false);
});

test("enforces small configured sitemap limits", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc></url>
</urlset>`;

  const result = await validateSitemap(xml, {
    limits: {
      maxUrlsPerSitemap: 1,
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_URL_LIMIT_EXCEEDED"));
});

test("enforces sitemap index child location constraints", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://cdn.example.com/sitemap.xml</loc></sitemap>
  <sitemap><loc>https://example.com/private/sitemap.xml</loc></sitemap>
</sitemapindex>`;

  const result = await validateSitemap(xml, {
    sitemapLocation: "https://example.com/public/sitemap-index.xml",
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("URL_OUTSIDE_SITEMAP_HOST"));
  assert.ok(codes.includes("URL_OUTSIDE_SITEMAP_PATH"));
});

test("enforces sitemap loc minimum length and single-host documents", async () => {
  const shortLoc = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://a.b</loc></url>
</urlset>`);
  const multiHostUrlset = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://a.example/page</loc></url>
  <url><loc>https://b.example/page</loc></url>
</urlset>`);
  const multiHostIndex = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://a.example/sitemap.xml</loc></sitemap>
  <sitemap><loc>https://b.example/sitemap.xml</loc></sitemap>
</sitemapindex>`);

  assert.equal(shortLoc.valid, false);
  assert.ok(shortLoc.diagnostics.some((diagnostic) => diagnostic.code === "LOC_TOO_SHORT"));
  assert.equal(multiHostUrlset.valid, false);
  assert.ok(multiHostUrlset.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_MULTIPLE_HOSTS"));
  assert.equal(multiHostIndex.valid, false);
  assert.ok(multiHostIndex.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_MULTIPLE_HOSTS"));
});

test("rejects unexpected sitemap and extension attributes", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
  xmlns:pagemap="http://www.google.com/schemas/sitemap-pagemap/1.0"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url foo="x">
    <loc>https://example.com/page</loc>
    <image:image foo="x"><image:loc>https://example.com/image.jpg</image:loc></image:image>
    <news:news foo="x">
      <news:publication><news:name>Example</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>2026-06-21</news:publication_date>
      <news:title>Title</news:title>
    </news:news>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Title</video:title>
      <video:description>Description</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
      <video:duration unit="seconds">10</video:duration>
    </video:video>
    <pagemap:PageMap>
      <pagemap:DataObject type="document" foo="x">
        <pagemap:Attribute name="title" value="Example" />
      </pagemap:DataObject>
    </pagemap:PageMap>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/page" foo="x" />
  </url>
</urlset>`);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("SITEMAP_ATTRIBUTE_UNEXPECTED"));
  assert.ok(codes.includes("GOOGLE_IMAGE_ATTRIBUTE_UNEXPECTED"));
  assert.ok(codes.includes("GOOGLE_NEWS_ATTRIBUTE_UNEXPECTED"));
  assert.ok(codes.includes("GOOGLE_VIDEO_ATTRIBUTE_UNEXPECTED"));
  assert.ok(codes.includes("GOOGLE_PAGEMAP_ATTRIBUTE_UNEXPECTED"));
  assert.ok(codes.includes("GOOGLE_HREFLANG_ATTRIBUTE_UNEXPECTED"));
});

test("validates empty extension values and deprecated schema URL fields", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/page</loc>
    <image:image>
      <image:loc>https://example.com/image.jpg</image:loc>
      <image:license>not a url</image:license>
    </image:image>
    <news:news>
      <news:publication><news:name>Example</news:name><news:language>zzz</news:language></news:publication>
      <news:access></news:access>
      <news:genres></news:genres>
      <news:publication_date></news:publication_date>
      <news:title>Title</news:title>
    </news:news>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>${"x".repeat(101)}</video:title>
      <video:description>Description</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
      <video:gallery_loc>not a url</video:gallery_loc>
      <video:duration></video:duration>
      <video:rating></video:rating>
      <video:publication_date></video:publication_date>
      <video:expiration_date></video:expiration_date>
      <video:family_friendly></video:family_friendly>
      <video:live></video:live>
      <video:requires_subscription></video:requires_subscription>
    </video:video>
  </url>
</urlset>`);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_NEWS_LANGUAGE_INVALID"));
  assert.ok(codes.includes("GOOGLE_NEWS_ACCESS_INVALID"));
  assert.ok(codes.includes("GOOGLE_NEWS_GENRES_INVALID"));
  assert.ok(codes.includes("GOOGLE_NEWS_PUBLICATION_DATE_INVALID"));
  assert.ok(codes.includes("INVALID_ABSOLUTE_URL"));
  assert.ok(codes.includes("GOOGLE_VIDEO_TITLE_TOO_LONG"));
  assert.ok(codes.includes("GOOGLE_VIDEO_DURATION_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_RATING_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PUBLICATION_DATE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_EXPIRATION_DATE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_FAMILY_FRIENDLY_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_LIVE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_REQUIRES_SUBSCRIPTION_INVALID"));
});

test("accepts valid three-letter Google News language codes", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://example.com/page</loc>
    <news:news>
      <news:publication><news:name>Example</news:name><news:language>eng</news:language></news:publication>
      <news:publication_date>2026-06-21</news:publication_date>
      <news:title>Title</news:title>
    </news:news>
  </url>
</urlset>`);

  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_NEWS_LANGUAGE_INVALID"), false);
});

test("accepts pinned ISO 639 alpha-3 language codes and legacy aliases", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://example.com/akkadian</loc>
    <news:news>
      <news:publication><news:name>Example</news:name><news:language>akk</news:language></news:publication>
      <news:publication_date>2026-06-21</news:publication_date>
      <news:title>Akkadian language code</news:title>
    </news:news>
  </url>
  <url>
    <loc>https://example.com/french</loc>
    <news:news>
      <news:publication><news:name>Example</news:name><news:language>fre</news:language></news:publication>
      <news:publication_date>2026-06-21</news:publication_date>
      <news:title>Bibliographic French alias</news:title>
    </news:news>
  </url>
</urlset>`);

  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_NEWS_LANGUAGE_INVALID"), false);
});

test("rejects fake three-letter Google News language codes", async () => {
  const result = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://example.com/page</loc>
    <news:news>
      <news:publication><news:name>Example</news:name><news:language>qqq</news:language></news:publication>
      <news:publication_date>2026-06-21</news:publication_date>
      <news:title>Fake language code</news:title>
    </news:news>
  </url>
</urlset>`);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_NEWS_LANGUAGE_INVALID"));
});

test("allows custom namespaced URL extensions only after core loc ordering", async () => {
  const validCustomExtension = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:custom="https://example.com/custom">
  <url>
    <loc>https://example.com/page</loc>
    <custom:metadata>value</custom:metadata>
  </url>
</urlset>`);
  const outOfOrderCustomExtension = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:custom="https://example.com/custom">
  <url>
    <custom:metadata>value</custom:metadata>
    <loc>https://example.com/page</loc>
  </url>
</urlset>`);

  assert.equal(validCustomExtension.valid, true);
  assert.equal(outOfOrderCustomExtension.valid, false);
  assert.ok(outOfOrderCustomExtension.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_ELEMENT_OUT_OF_ORDER"));
});

test("validates Google PageMap sitemap extension schema rules", async () => {
  const validPageMap = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:pagemap="http://www.google.com/schemas/sitemap-pagemap/1.0">
  <url>
    <loc>https://example.com/page</loc>
    <pagemap:PageMap>
      <pagemap:Template src="https://example.com/template.xml" />
      <pagemap:DataObject type="document" id="doc-1">
        <pagemap:Attribute name="title" value="Example" />
        <pagemap:Attribute name="summary">Text summary</pagemap:Attribute>
      </pagemap:DataObject>
    </pagemap:PageMap>
  </url>
</urlset>`);
  const invalidPageMap = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:pagemap="http://www.google.com/schemas/sitemap-pagemap/1.0">
  <url>
    <loc>https://example.com/page</loc>
    <pagemap:PageMap>
      <pagemap:DataObject>
        <pagemap:Template src="https://example.com/template.xml" />
        <pagemap:Attribute value="missing-name" />
        <pagemap:Attribute name="empty"></pagemap:Attribute>
        <pagemap:Attribute name="both" value="value">text</pagemap:Attribute>
        <pagemap:Unknown />
      </pagemap:DataObject>
      <pagemap:Template src="https://example.com/later-template.xml" />
      <pagemap:Template src="https://example.com/duplicate-template.xml" />
    </pagemap:PageMap>
  </url>
</urlset>`);
  const placement = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:pagemap="http://www.google.com/schemas/sitemap-pagemap/1.0">
  <url>
    <loc>https://example.com/page</loc>
  </url>
  <pagemap:PageMap />
</urlset>`);

  const codes = invalidPageMap.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(validPageMap.valid, true);
  assert.equal(invalidPageMap.valid, false);
  assert.ok(codes.includes("GOOGLE_PAGEMAP_REQUIRED_ATTRIBUTE"));
  assert.ok(codes.includes("GOOGLE_PAGEMAP_ELEMENT_PLACEMENT_INVALID"));
  assert.ok(codes.includes("GOOGLE_PAGEMAP_ATTRIBUTE_VALUE_INVALID"));
  assert.ok(codes.includes("GOOGLE_PAGEMAP_UNKNOWN_TAG"));
  assert.ok(codes.includes("GOOGLE_PAGEMAP_ELEMENT_OUT_OF_ORDER"));
  assert.ok(codes.includes("GOOGLE_PAGEMAP_ELEMENT_DUPLICATE"));
  assert.equal(placement.valid, false);
  assert.ok(placement.diagnostics.some((diagnostic) => diagnostic.code === "EXTENSION_OUTSIDE_URL"));
});

test("filters PageMap diagnostics through the extension option", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:pagemap="http://www.google.com/schemas/sitemap-pagemap/1.0">
  <url>
    <loc>https://example.com/page</loc>
    <pagemap:PageMap><pagemap:DataObject /></pagemap:PageMap>
  </url>
</urlset>`;

  const imageOnly = await validateSitemap(xml, { extensions: ["image"] });
  const pageMapOnly = await validateSitemap(xml, { extensions: ["pagemap"] });

  assert.equal(imageOnly.diagnostics.some((diagnostic) => diagnostic.code.startsWith("GOOGLE_PAGEMAP_")), false);
  assert.ok(pageMapOnly.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_PAGEMAP_REQUIRED_ATTRIBUTE"));
});

test("reports invalid UTF-8 bytes and non-UTF-8 XML declarations", async () => {
  const invalidBytes = await validateSitemap(Uint8Array.from([0xff, 0xfe, 0xfd]), {
    sourceId: "invalid-utf8.xml",
  });
  const declaredLatin1 = await validateSitemap(`<?xml version="1.0" encoding="ISO-8859-1"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
</urlset>`, {
    sourceId: "declared-latin1.xml",
  });

  assert.equal(invalidBytes.valid, false);
  assert.ok(invalidBytes.diagnostics.some((diagnostic) => diagnostic.code === "XML_INVALID_UTF8"));
  assert.equal(declaredLatin1.valid, false);
  assert.ok(declaredLatin1.diagnostics.some((diagnostic) => diagnostic.code === "XML_ENCODING_NOT_UTF8"));
});

test("rejects unsupported XML versions", async () => {
  const result = await validateSitemap(`<?xml version="1.1" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
</urlset>`);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "XML_VERSION_UNSUPPORTED"));
});

test("reports duplicate and out-of-order sitemap protocol children", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <priority>0.5</priority>
    <loc>https://example.com/a</loc>
    <loc>https://example.com/b</loc>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("SITEMAP_ELEMENT_OUT_OF_ORDER"));
  assert.ok(codes.includes("SITEMAP_ELEMENT_DUPLICATE"));
});

test("rejects empty optional sitemap protocol values when elements are present", async () => {
  const urlset = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <lastmod></lastmod>
    <changefreq></changefreq>
    <priority></priority>
  </url>
</urlset>`);
  const index = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap.xml</loc>
    <lastmod></lastmod>
  </sitemap>
</sitemapindex>`);
  const codes = [...urlset.diagnostics, ...index.diagnostics].map((diagnostic) => diagnostic.code);

  assert.equal(urlset.valid, false);
  assert.equal(index.valid, false);
  assert.ok(codes.includes("INVALID_LASTMOD"));
  assert.ok(codes.includes("INVALID_CHANGEFREQ"));
  assert.ok(codes.includes("INVALID_PRIORITY"));
});

test("rejects empty sitemap roots", async () => {
  const emptyUrlset = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`);
  const emptyIndex = await validateSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>`);

  assert.equal(emptyUrlset.valid, false);
  assert.equal(emptyIndex.valid, false);
  assert.ok(emptyUrlset.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_URL_ENTRY_REQUIRED"));
  assert.ok(emptyIndex.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_INDEX_ENTRY_REQUIRED"));
});

test("accepts Google News W3C datetime with hours and minutes", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://example.com/news/minute-precision</loc>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-06-10T19:20+01:00</news:publication_date>
      <news:title>Minute precision publication date</news:title>
    </news:news>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_LASTMOD"), false);
});

test("rejects reduced-precision Google extension dates", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/news/reduced-precision</loc>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-06</news:publication_date>
      <news:title>Reduced precision news date</news:title>
    </news:news>
  </url>
  <url>
    <loc>https://example.com/videos/reduced-precision</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Reduced precision video date</video:title>
      <video:description>Reduced precision video date</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
      <video:publication_date>2026</video:publication_date>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_NEWS_PUBLICATION_DATE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PUBLICATION_DATE_INVALID"));
  assert.equal(codes.includes("INVALID_LASTMOD"), false);
});

test("reports extension placement and per-entry duplicate extension elements", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/a</loc>
    <image:loc>https://example.com/image-outside-parent.jpg</image:loc>
    <image:image>
      <image:loc>https://example.com/a.jpg</image:loc>
      <image:loc>https://example.com/a-duplicate.jpg</image:loc>
    </image:image>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-06-10</news:publication_date>
      <news:title>First</news:title>
    </news:news>
    <news:news>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-06-10</news:publication_date>
      <news:title>Second</news:title>
    </news:news>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>One</video:title>
      <video:title>Two</video:title>
      <video:description>Example</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
    </video:video>
    <xhtml:meta rel="alternate" hreflang="en" href="https://example.com/a" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_IMAGE_ELEMENT_PLACEMENT_INVALID"));
  assert.ok(codes.includes("GOOGLE_IMAGE_LOC_DUPLICATE"));
  assert.ok(codes.includes("GOOGLE_NEWS_ENTRY_DUPLICATE"));
  assert.ok(codes.includes("GOOGLE_VIDEO_ELEMENT_DUPLICATE"));
  assert.ok(codes.includes("GOOGLE_HREFLANG_ELEMENT_PLACEMENT_INVALID"));
});

test("reports schema order errors in extension elements", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <image:image>
      <image:title>Before loc</image:title>
      <image:loc>https://example.com/a.jpg</image:loc>
    </image:image>
    <loc>https://example.com/a</loc>
    <news:news>
      <news:title>Before publication</news:title>
      <news:publication>
        <news:name>Example</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>2026-06-10</news:publication_date>
    </news:news>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:description>Before title</video:description>
      <video:title>Example</video:title>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("SITEMAP_ELEMENT_OUT_OF_ORDER"));
  assert.ok(codes.includes("GOOGLE_IMAGE_ELEMENT_OUT_OF_ORDER"));
  assert.ok(codes.includes("GOOGLE_NEWS_ELEMENT_OUT_OF_ORDER"));
  assert.ok(codes.includes("GOOGLE_VIDEO_ELEMENT_OUT_OF_ORDER"));
});

test("validates deeper video sitemap documented values and allows FTP media URLs", async () => {
  const tagElements = Array.from({ length: 33 }, (_, index) => `<video:tag>tag-${index}</video:tag>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/a</loc>
    <video:video>
      <video:thumbnail_loc>ftp://media.example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Example</video:title>
      <video:description>Example description</video:description>
      <video:player_loc autoplay="ap=1">ftp://media.example.com/player.swf</video:player_loc>
      <video:restriction relationship="allow">US ZZ</video:restriction>
      <video:platform>web console</video:platform>
      <video:uploader info="https://authors.example.net/u">${"u".repeat(256)}</video:uploader>
      <video:category>${"c".repeat(257)}</video:category>
      ${tagElements}
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.equal(codes.includes("UNSUPPORTED_URL_SCHEME"), false);
  assert.ok(codes.includes("GOOGLE_VIDEO_TAG_DEPRECATED"));
  assert.ok(codes.includes("GOOGLE_VIDEO_RESTRICTION_COUNTRY_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PLATFORM_RELATIONSHIP_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PLATFORM_VALUE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_UPLOADER_TOO_LONG"));
  assert.ok(codes.includes("GOOGLE_VIDEO_UPLOADER_INFO_DOMAIN_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_CATEGORY_TOO_LONG"));
  assert.ok(codes.includes("GOOGLE_VIDEO_TAG_LIMIT_EXCEEDED"));
});

test("does not fail open for invalid video uploader info same-host checks", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/a</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Example</video:title>
      <video:description>Example description</video:description>
      <video:uploader info="not a url">Example Channel</video:uploader>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("INVALID_ABSOLUTE_URL"));
  assert.ok(codes.includes("GOOGLE_VIDEO_UPLOADER_INFO_DOMAIN_INVALID"));
});

test("recognizes legacy video XSD fields without unknown or placement diagnostics", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/legacy</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Legacy</video:title>
      <video:description>Legacy video XSD fields</video:description>
      <video:player_loc>https://example.com/player.swf</video:player_loc>
      <video:content_segment_loc duration="999999">https://example.com/segment.mp4</video:content_segment_loc>
      <video:gallery_loc title="Gallery">https://example.com/gallery</video:gallery_loc>
      <video:id type="bad">legacy-id</video:id>
      <video:tvshow>
        <video:show_title>Example Show</video:show_title>
        <video:video_type>clip</video:video_type>
        <video:season_number>1</video:season_number>
        <video:episode_number>2</video:episode_number>
        <video:premier_date>2026-06-12</video:premier_date>
      </video:tvshow>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_VIDEO_TAG_DEPRECATED"));
  assert.ok(codes.includes("GOOGLE_VIDEO_CONTENT_SEGMENT_DURATION_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_ID_TYPE_INVALID"));
  assert.equal(codes.includes("GOOGLE_VIDEO_UNKNOWN_TAG"), false);
  assert.equal(codes.includes("GOOGLE_VIDEO_ELEMENT_PLACEMENT_INVALID"), false);
  assert.equal(codes.includes("GOOGLE_VIDEO_ATTRIBUTE_UNEXPECTED"), false);
});

test("validates legacy video XSD value constraints", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/legacy-invalid</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Legacy invalid</video:title>
      <video:description>Legacy invalid video XSD fields</video:description>
      <video:content_segment_loc>https://example.com/segment.mp4</video:content_segment_loc>
      <video:price currency="usd" type="lease" resolution="4k">-1</video:price>
      <video:tvshow>
        <video:video_type>bad</video:video_type>
        <video:season_number>0</video:season_number>
        <video:episode_number>nope</video:episode_number>
        <video:premier_date>2026-13-40</video:premier_date>
      </video:tvshow>
    </video:video>
  </url>
  <url>
    <loc>https://example.com/videos/player-invalid</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Player invalid</video:title>
      <video:description>Invalid player attribute</video:description>
      <video:player_loc allow_embed="maybe">https://example.com/player.swf</video:player_loc>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_VIDEO_CONTENT_SEGMENT_REQUIRES_PLAYER_LOC"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PRICE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_TVSHOW_REQUIRED_FIELD"));
  assert.ok(codes.includes("GOOGLE_VIDEO_TVSHOW_VIDEO_TYPE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_TVSHOW_NUMBER_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_TVSHOW_PREMIER_DATE_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PLAYER_ALLOW_EMBED_INVALID"));
});

test("requires lexical integer video durations and seconds in video datetimes", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/date-duration</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Date duration</video:title>
      <video:description>Invalid lexical video fields</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
      <video:duration>1.0</video:duration>
      <video:publication_date>2026-06-10T19:20+01:00</video:publication_date>
      <video:expiration_date>2026-06-10T19:20:30+01:00</video:expiration_date>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_VIDEO_DURATION_INVALID"));
  assert.ok(codes.includes("GOOGLE_VIDEO_PUBLICATION_DATE_INVALID"));
  assert.equal(codes.includes("GOOGLE_VIDEO_EXPIRATION_DATE_INVALID"), false);
});

test("accepts video yes/no case variants allowed by the video XSD", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/case</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Case variants</video:title>
      <video:description>Accepted yes/no case variants</video:description>
      <video:content_loc>https://example.com/video.mp4</video:content_loc>
      <video:family_friendly>YES</video:family_friendly>
      <video:requires_subscription>No</video:requires_subscription>
      <video:live>Yes</video:live>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code.endsWith("_INVALID")), false);
});

test("rejects hreflang regions that are not official ISO 3166 alpha-2 codes", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en-UK" href="https://example.com/en/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_HREFLANG_UNSUPPORTED_CODE"));
});

test("accepts hreflang script subtags from the pinned ISO 15924 list", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en-Berf-US" href="https://example.com/en/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_HREFLANG_UNSUPPORTED_CODE"), false);
});

test("rejects hreflang script subtags that are not ISO 15924 codes", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en-Abcd" href="https://example.com/en/" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_HREFLANG_UNSUPPORTED_CODE"));
});

test("validates hreflang graph consistency across a sitemap set", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/" />
    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/" />
  </url>
  <url>
    <loc>https://example.com/fr/</loc>
    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/" />
  </url>
  <url>
    <loc>https://example.com/de/</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/" />
    <xhtml:link rel="alternate" hreflang="it" href="https://example.com/it/" />
  </url>
</urlset>`;

  const result = await validateSitemapSet(xml, {
    sourceId: "hreflang-set.xml",
    hreflangGraph: true,
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_HREFLANG_RETURN_LINK_MISSING"));
  assert.ok(codes.includes("GOOGLE_HREFLANG_ALTERNATE_SET_MISMATCH"));
  assert.ok(codes.includes("GOOGLE_HREFLANG_ALTERNATE_URL_MISSING"));
});

test("distinguishes existing hreflang targets without return links from missing targets", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/" />
    <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/" />
  </url>
  <url>
    <loc>https://example.com/fr/</loc>
  </url>
</urlset>`;

  const result = await validateSitemapSet(xml, {
    sourceId: "hreflang-existing-target.xml",
    hreflangGraph: true,
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes("GOOGLE_HREFLANG_RETURN_LINK_MISSING"));
  assert.equal(codes.includes("GOOGLE_HREFLANG_ALTERNATE_URL_MISSING"), false);
});

test("loads sitemap index children concurrently while preserving deterministic validation order", async () => {
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemaps/a.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemaps/b.xml</loc></sitemap>
</sitemapindex>`;
  const childA = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/sitemaps/a</loc></url>
</urlset>`;
  const childB = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/sitemaps/b</loc></url>
</urlset>`;
  let activeLoads = 0;
  let maxActiveLoads = 0;
  const discovered = [];

  const result = await validateSitemapSet(indexXml, {
    sourceId: "index.xml",
    sitemapLocation: "https://example.com/sitemaps/index.xml",
    loaderConcurrency: 2,
    loader: async ({ loc }) => {
      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      await new Promise((resolve) => setTimeout(resolve, loc.endsWith("a.xml") ? 20 : 1));
      activeLoads -= 1;

      return {
        input: loc.endsWith("a.xml") ? childA : childB,
        sourceId: loc.endsWith("a.xml") ? "a.xml" : "b.xml",
        sitemapLocation: loc,
      };
    },
    onProgress(event) {
      if (event.type === "source:discover") {
        discovered.push(event.sourceId);
      }
    },
  });

  assert.equal(result.valid, true);
  assert.equal(maxActiveLoads, 2);
  assert.deepEqual(discovered, ["a.xml", "b.xml"]);
});

test("reports parser namespace errors with source locations", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/a" />
  </url>
</urlset>`;

  const result = await validateSitemap(xml);
  const diagnostic = result.diagnostics.find((item) => item.code === "XML_PARSE_ERROR");

  assert.equal(result.valid, false);
  assert.equal(typeof diagnostic?.location?.line, "number");
});

test("reports unsupported video content_loc document formats", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>https://example.com/videos/page</loc>
    <video:video>
      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>
      <video:title>Example</video:title>
      <video:description>Example description</video:description>
      <video:content_loc>https://example.com/videos/watch.html</video:content_loc>
    </video:video>
  </url>
</urlset>`;

  const result = await validateSitemap(xml);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GOOGLE_VIDEO_CONTENT_LOC_FORMAT_UNSUPPORTED"));
});
