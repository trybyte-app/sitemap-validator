# Sitemap Validator

TypeScript XML sitemap validator for generated sitemap files. Use it before
publishing or deploying a site to confirm the generated XML sitemap is valid,
standards-aligned, and ready to submit.

## Install

```bash
npm install @trybyte/sitemap-validator
pnpm install @trybyte/sitemap-validator
bun install @trybyte/sitemap-validator
```

Requirements: Node.js 20 or newer for the CLI and Node file-system helpers.
Browser apps should import from `@trybyte/sitemap-validator/browser`.

## Core Use Case

Generate the sitemap with your application, write it to a local file, then run
`sitemap-validator` against that generated file before deploy.

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --detail summary
```

The command exits with:

- `0` when the sitemap passes the selected CI policy.
- `1` when validation diagnostics should block deployment.
- `2` for CLI usage problems, such as passing a live HTTP URL instead of a file.

Default CI policy fails on `error` diagnostics. To fail on warnings too:

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --policy strict
```

## `sitemap-validator` vs `--sitemap-location`

`sitemap-validator` is the CLI command and package binary. It receives the generated
file to validate:

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml
```

`--sitemap-location` is metadata: the future public URL where that generated
sitemap will be published. It lets the validator apply sitemap.org location
rules, such as same host and path-prefix constraints.

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml
```

The validator still reads `./build/sitemap.xml`; it does not fetch
`https://example.com/sitemap.xml`.

## CI/CD Workflow

The CI gate should run after sitemap generation and before deployment.

```text
build app -> generate sitemap file -> validate sitemap file -> deploy only if valid
```

Example package script:

```json
{
  "scripts": {
    "build": "your-build-command",
    "generate:sitemap": "your-sitemap-generation-command",
    "validate:sitemap": "sitemap-validator ./build/sitemap.xml --sitemap-location https://example.com/sitemap.xml --detail summary",
    "predeploy": "npm run build && npm run generate:sitemap && npm run validate:sitemap"
  }
}
```

For GitHub Actions:

```yaml
name: Validate sitemap

on: [push, pull_request]

jobs:
  sitemap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run generate:sitemap
      - run: npx @trybyte/sitemap-validator ./build/sitemap.xml --sitemap-location https://example.com/sitemap.xml --detail summary
```

If the generated XML is invalid, the `npx @trybyte/sitemap-validator ...` step exits non-zero
and the deployment does not continue.

## Sitemap Indexes

For a sitemap index, pass the generated index file. If child sitemap files are
also generated locally, map their public URL prefix to the local directory:

```bash
npx @trybyte/sitemap-validator ./build/sitemap-index.xml \
  --sitemap-location https://example.com/sitemap-index.xml \
  --public-url-prefix https://example.com/ \
  --local-sitemap-root ./build
```

When the index contains `https://example.com/products.xml`, the CLI loads
`./build/products.xml`. This validates the generated sitemap set without
fetching live URLs.

## Live Sitemap Wrapper

Use `sitemap-validator-live` when you need to fetch or audit an already-published sitemap:
feed it a downloaded sitemap file, a live sitemap URL, or a saved URL list, then
ask for XML validation, URL extraction, optional live audits, and JSON reports.
It keeps live sitemap fetching and optional page audits separate from the
generated-file validator, while reusing the same XML validation engine.

Validate a downloaded sitemap file:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live ./downloads/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --detail summary
```

Validate a downloaded sitemap index and map child `<loc>` values back to local
files:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live ./downloads/sitemap-index.xml \
  --sitemap-location https://example.com/sitemap-index.xml \
  --public-url-prefix https://example.com/ \
  --local-sitemap-root ./downloads
```

Fetch and validate a published sitemap:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap.xml
```

The wrapper fetches sitemap indexes, follows their child sitemap entries, reads
plain XML and `.xml.gz` sitemap files, and validates each sitemap document with
the normal XML validator. It can also stream the page URLs discovered inside the
sitemap set to a local file:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap.xml \
  --save-urls sitemap-urls.txt
```

Use `--save-url-details` when you need each saved URL to remember which sitemap
file produced it:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap-index.xml \
  --save-url-details sitemap-url-details.jsonl \
  --json \
  --detail full
```

That file is newline-delimited JSON:

```json
{"url":"https://example.com/page","sourceSitemap":"https://example.com/sitemaps/pages-1.xml.gz"}
```

Live JSON reports also include `context.sourceSitemap` on URL-level findings
when the source is known, so a warning can be traced back to the child sitemap
that listed the URL. Plain `--save-urls` remains available for simple one-URL
per-line workflows.

The Live wrapper writes minimal progress logs to stderr while it runs, including
root fetch, child sitemap discovery, URL collection milestones, audit start, and
audit completion. The final text or JSON report still goes to stdout or
`--output`. Use `--quiet` when you need to suppress progress logs.

Saved URL files make live audits repeatable and are the preferred workflow for
large sites. You can run audit checks later from the same URL list without
refetching the sitemap XML:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live --urls-file sitemap-urls.txt \
  --check-status \
  --check-canonical \
  --check-noindex
```

`--urls-file` accepts either the plain text file from `--save-urls` or the JSONL
file from `--save-url-details`. Use the JSONL file when you want later audit
findings to keep `sourceSitemap` context.

Live audits are opt-in:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap.xml \
  --check-duplicates \
  --check-robots \
  --check-status \
  --check-canonical \
  --check-noindex
```

Available live checks:

- `--check-duplicates`: duplicate URLs in the collected sitemap URL list.
- `--check-robots`: robots.txt allow/disallow audit using
  `@trybyte/robotstxt-parser`.
- `--check-status`: page URL HTTP status audit.
- `--check-canonical`: canonical URL audit when a canonical is declared.
- `--require-canonical`: also warn when canonical is missing.
- `--check-noindex`: `X-Robots-Tag` and robots meta `noindex` audit.
- `--all-audits`: enable duplicates, robots, status, canonical, and noindex.

The Live wrapper defaults to the Googlebot Smartphone user-agent preset:

```text
Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
```

Use `--user-agent-preset` when you need a known crawler profile:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap.xml \
  --check-robots \
  --check-status \
  --user-agent-preset googlebot
```

`--user-agent` overrides the HTTP request header. `--robots-user-agent` overrides
the robots.txt matching token. The `googlebot-smartphone` preset sends the full
smartphone request header and uses `Googlebot` for robots.txt matching.

These options only change request headers and robots matching. If the target site
verifies crawler identity with source IP, reverse DNS, firewall rules, or
bot-management tooling, the request may still be blocked or treated differently.
In that case, run the wrapper from an allowed IP or whitelist the machine that
will run the audit.

By default, XML validation still fails on XML `error` diagnostics. Live audits
fail on audit `error` findings by default; use `--audit-fail-on warning` to fail
on warnings too, or `--audit-fail-on none` to report without failing.

Live page audits can be expensive on large sites. The wrapper audits at most
1,000 unique URLs by default. Use `--max-audit-urls 0` to audit every collected
URL entry, or keep the saved URL file and run smaller batches from it.

For very large sitemap sets, such as 20 million URLs, use `--save-urls` or
`--save-url-details`. The wrapper streams discovered URLs to disk instead of
holding them all in memory. Duplicate auditing is exact and disk-sharded, so it
can run across large saved URL lists without building one huge in-memory map.
Live finding rows are capped with `--max-audit-findings` so a broken site does
not create an enormous report.

By default, the Live wrapper refuses to fetch private, loopback, link-local, and
reserved hosts, and it applies that check to followed redirects. Use
`--allow-private-hosts` only when you intentionally audit a trusted staging or
internal site.

## Library API

Validate one sitemap document:

```ts
import { assertValidForCi, validateSitemap } from "@trybyte/sitemap-validator";

const result = await validateSitemap({
  path: "build/sitemap.xml",
  sourceId: "sitemap.xml",
}, {
  sitemapLocation: "https://example.com/sitemap.xml",
});

assertValidForCi(result);
```

Validate a sitemap index and generated child files:

```ts
import {
  assertValidForCi,
  createLocalSitemapLoader,
  validateSitemapSet,
} from "@trybyte/sitemap-validator";

const result = await validateSitemapSet({
  path: "build/sitemap-index.xml",
  sourceId: "sitemap-index.xml",
}, {
  sitemapLocation: "https://example.com/sitemap-index.xml",
  loader: createLocalSitemapLoader({
    publicUrlPrefix: "https://example.com/",
    localDirectory: "build",
  }),
  loaderConcurrency: 4,
});

assertValidForCi(result, "ciDefault");
```

## Browser And Vite Apps

For an online validator, import the browser entry. It accepts uploaded XML as a
string, `Uint8Array`, `ArrayBuffer`, or chunk iterable and does not expose the
Node file-system loader or CLIs:

```ts
import { validateSitemap } from "@trybyte/sitemap-validator/browser";

const file = formData.get("sitemap");
if (!(file instanceof File)) {
  throw new Error("Choose a sitemap XML file.");
}

const result = await validateSitemap(await file.text(), {
  sourceId: file.name,
  sitemapLocation: "https://example.com/sitemap.xml",
});

if (!result.valid) {
  console.table(result.diagnostics);
}
```

For a browser-side sitemap index, provide child XML with
`createMemorySitemapLoader()` after the user uploads those files. The browser
entry validates XML; it does not fetch live URLs or read local paths.

For large files, consume events and build compact summaries without retaining
every diagnostic row:

```ts
import { createDiagnosticSummaryBuilder, validateSitemapSetEvents } from "@trybyte/sitemap-validator";

const summary = createDiagnosticSummaryBuilder();

for await (const event of validateSitemapSetEvents({ path: "build/sitemap-index.xml" })) {
  if (event.type === "diagnostic") {
    summary.add(event.diagnostic);
  }
}

console.log(summary.summary());
```

`validateSitemapEvents()` and `validateSitemapSetEvents()` yield the same event
stream that `onProgress` receives. Use one delivery style for the same run unless
you intentionally want both callback and iterator handling.

When a path input includes `sourceId` or `gzip`, those values are defaults.
`ValidationOptions.sourceId` and `ValidationOptions.gzip` take precedence for the
root input. For sitemap-set children, loader-returned `sourceId`, `gzip`, and
`sitemapLocation` metadata take precedence over metadata embedded inside the
returned child input object.

## Validation Scope

Included:

- XML well-formedness, XML namespace handling, UTF-8 expectations, and safe XML
  parsing.
- `urlset` and `sitemapindex` root rules.
- Required sitemap namespace, structure, entries, and `loc` fields.
- Empty present value checks for `loc`, `lastmod`, `changefreq`, and `priority`.
- Core sitemap schema order and duplicate core child element checks.
- Absolute URL, URI, and IRI syntax validation.
- `loc` length, per-file URL count, sitemap index count, and uncompressed size
  limits.
- Sitemap file location constraints when `--sitemap-location` is supplied.
- Image, News, Video, combined extension, and hreflang sitemap annotations.
- Optional set-level hreflang graph checks with `--hreflang-graph`.
- Structured diagnostics, grouped reports, progress events, and CI policy helpers.

Not included in the core XML validator:

- HTTP status code checks for listed URLs.
- Redirect, canonical, `noindex`, rendered metadata, or page content checks.
- Robots.txt discovery or allow/disallow comparison.
- Duplicate URL auditing across sitemap files.
- Fetching page, image, video, or live sitemap URLs from the core CLI.

Those are separate audit concerns. In this package, they live only in the
`sitemap-validator-live` wrapper and only run when the user opts in.

## Standards Sources

Diagnostics include rule provenance. The main sources are:

- [sitemaps.org protocol](https://www.sitemaps.org/protocol.html), including the
  sitemap and sitemap index XML schema rules.
- Google Search Central sitemap guidance for
  [general sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
  [image sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps),
  [News sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap),
  [video sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps),
  [combined extensions](https://developers.google.com/search/docs/crawling-indexing/sitemaps/combine-sitemap-extensions),
  and [localized hreflang annotations](https://developers.google.com/search/docs/specialty/international/localized-versions).
- Google extension XSDs for
  [image](https://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd),
  [News](https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd),
  [video](https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd),
  and [PageMap](https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd).
- W3C XML, W3C XML Namespaces, RFC 3986, RFC 3987, BCP 47/RFC 5646, and RFC 4647
  where those standards apply to XML, URLs, IRIs, and hreflang values.

See [docs/standards-coverage.md](docs/standards-coverage.md) for the coverage
boundary and [docs/rule-matrix.md](docs/rule-matrix.md) for generated rule codes.

## Reports

Text reports are grouped by default:

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml --detail grouped
npx @trybyte/sitemap-validator ./build/sitemap.xml --detail full --max-diagnostics 500
npx @trybyte/sitemap-validator ./build/sitemap.xml --json --output sitemap-validation.json
```

Library helpers:

```ts
import { createJsonReport, createTextReport, evaluateForCi } from "@trybyte/sitemap-validator";

console.log(createTextReport(result, { detail: "summary" }));
console.log(createJsonReport(result, { detail: "grouped" }));
console.log(evaluateForCi(result, "strict"));
```

## Development

```bash
nvm use
npm ci
npm run typecheck
npm run lint
npm test
npm run docs:rules
npm run api:check
```

Use `npm run api:snapshot` only after reviewing an intentional public API change.
Before publishing, run:

```bash
npm run verify:release
```

See [docs/release-checklist.md](docs/release-checklist.md).
