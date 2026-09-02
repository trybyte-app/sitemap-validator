# Sitemap Validator

Validate generated XML sitemap files before you publish them. The package checks
XML structure, sitemap protocol rules, Google sitemap extensions, and the URL
constraints that apply at the future public location.

## Install

```bash
npm install @trybyte/sitemap-validator
pnpm add @trybyte/sitemap-validator
bun add @trybyte/sitemap-validator
```

The CLI and Node file helpers require Node.js 20 or newer. Browser apps should
import from `@trybyte/sitemap-validator/browser`.

## Core use case

Generate the sitemap, write it to a local file, and validate that file before
deployment.

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --detail summary
```

The exit code tells CI what happened:

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| `0`  | The sitemap passes the selected CI policy.                                                  |
| `1`  | Validation found diagnostics that block deployment.                                         |
| `2`  | The command is invalid, for example because the input is a live HTTP URL instead of a file. |

Default CI policy fails on `error` diagnostics. To fail on warnings too:

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --policy strict
```

## `sitemap-validator` vs `--sitemap-location`

`sitemap-validator` is the package binary. Pass it the generated file:

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml
```

`--sitemap-location` supplies the future public URL. The validator uses it to
check sitemap.org host and path rules.

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml
```

The validator still reads `./build/sitemap.xml`. It does not fetch the public
URL.

## CI/CD workflow

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

If the generated XML fails the selected policy, the final step exits with code
`1` and stops the job.

## Sitemap indexes

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

## Live sitemap wrapper

Use `sitemap-validator-live` to inspect an already-published sitemap. It accepts
a downloaded sitemap, a live sitemap URL, or a saved URL list. It can validate
XML, extract URLs, run opt-in page checks, and write JSON reports. The main
`sitemap-validator` command remains an offline deployment check.

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

The output is newline-delimited JSON:

```json
{ "url": "https://example.com/page", "sourceSitemap": "https://example.com/sitemaps/pages-1.xml.gz" }
```

When the source is known, live JSON reports add `context.sourceSitemap` to each
URL-level finding. Use it to find the child sitemap that listed the URL. Use
`--save-urls` when one URL per line is enough.

The live wrapper writes progress to stderr while it fetches the root sitemap,
finds child sitemaps, collects URLs, and runs audits. The final report goes to
stdout or the path passed to `--output`. Use `--quiet` to suppress progress.

For a large site, save the URLs once and audit that file in later runs. This
avoids fetching and parsing the sitemap set again:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live --urls-file sitemap-urls.txt \
  --check-status \
  --check-canonical \
  --check-noindex
```

`--urls-file` accepts the plain text file from `--save-urls`, a JSON array of URL
strings, or the JSONL file from `--save-url-details`. Use the JSONL file when you
want later audit findings to keep `sourceSitemap` context.

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

| Option                | Check                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `--check-duplicates`  | Finds duplicate URLs in the collected sitemap URL list.                  |
| `--check-robots`      | Compares URLs with robots.txt rules through `@trybyte/robotstxt-parser`. |
| `--check-status`      | Checks page HTTP status codes.                                           |
| `--check-canonical`   | Checks a page's declared canonical URL.                                  |
| `--require-canonical` | Warns when a page has no canonical declaration.                          |
| `--check-noindex`     | Checks `X-Robots-Tag` headers and robots meta tags for `noindex`.        |
| `--all-audits`        | Runs duplicate, robots, status, canonical, and noindex checks.           |

The live wrapper uses the Googlebot Smartphone user-agent preset by default:

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

These options change request headers and robots matching. They cannot satisfy
checks based on source IP, reverse DNS, firewall rules, or bot-management
systems. Run the wrapper from an allowed IP or allowlist the audit machine when
the site uses those checks.

XML `error` diagnostics fail validation. Audit `error` findings also fail the
live command. Use `--audit-fail-on warning` to fail on warnings, or
`--audit-fail-on none` to report findings without failing.

Live page audits can be expensive on large sites. The wrapper audits at most
1,000 unique URLs by default. Use `--max-audit-urls 0` to audit every collected
URL entry, or keep the saved URL file and run smaller batches from it.

For a sitemap set with millions of URLs, use `--save-urls` or
`--save-url-details`. The wrapper streams URLs to disk. Its duplicate check uses
disk shards instead of keeping the full URL set in memory. Set
`--max-audit-findings` to limit the number of finding rows stored in the report.

The live wrapper refuses private, loopback, link-local, and reserved hosts by
default. It checks redirect targets too. Use
`--allow-private-hosts` only when you intentionally audit a trusted staging or
internal site.

The wrapper checks DNS before each request, but its fetch transport does not pin
the connection to the checked IP address. A DNS server could return a different
address when the connection opens. Do not treat the wrapper as a network
isolation tool for untrusted domains.

Every live request has a 15-second timeout by default. The timeout stays active
while the wrapper reads the response body. Sitemap responses are capped at 60
MiB, page bodies at 2 MiB, robots.txt at 512 KiB, and guarded redirects at five.
Change these limits with `--timeout-ms`, `--max-sitemap-bytes`,
`--max-page-bytes`, `--max-robots-bytes`, and `--max-redirects`.

## Library API

Validate one sitemap document:

```ts
import { assertValidForCi, validateSitemap } from "@trybyte/sitemap-validator";

const result = await validateSitemap(
  {
    path: "build/sitemap.xml",
    sourceId: "sitemap.xml"
  },
  {
    sitemapLocation: "https://example.com/sitemap.xml"
  }
);

assertValidForCi(result);
```

Validate a sitemap index and generated child files:

```ts
import { assertValidForCi, createLocalSitemapLoader, validateSitemapSet } from "@trybyte/sitemap-validator";

const result = await validateSitemapSet(
  {
    path: "build/sitemap-index.xml",
    sourceId: "sitemap-index.xml"
  },
  {
    sitemapLocation: "https://example.com/sitemap-index.xml",
    loader: createLocalSitemapLoader({
      publicUrlPrefix: "https://example.com/",
      localDirectory: "build"
    }),
    loaderConcurrency: 4
  }
);

assertValidForCi(result, "ciDefault");
```

## Browser and Vite apps

For an online validator, import the browser entry. It accepts XML as a string,
`Uint8Array`, `ArrayBuffer`, or chunk iterable. It does not include the Node file
loader or either CLI:

```ts
import { validateSitemap } from "@trybyte/sitemap-validator/browser";

const file = formData.get("sitemap");
if (!(file instanceof File)) {
  throw new Error("Choose a sitemap XML file.");
}

const result = await validateSitemap(await file.text(), {
  sourceId: file.name,
  sitemapLocation: "https://example.com/sitemap.xml"
});

if (!result.valid) {
  console.table(result.diagnostics);
}
```

For a browser-side sitemap index, provide child XML with
`createMemorySitemapLoader()` after the user uploads those files. The browser
entry validates XML; it does not fetch live URLs or read local paths.

For large files, consume events and build a summary without retaining every
diagnostic row:

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

## Validation scope

The core validator checks:

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

The core validator does not check:

- HTTP status code checks for listed URLs.
- Redirect, canonical, `noindex`, rendered metadata, or page content checks.
- Robots.txt discovery or allow/disallow comparison.
- Duplicate URL auditing across sitemap files.
- Fetching page, image, video, or live sitemap URLs from the core CLI.

The `sitemap-validator-live` wrapper provides these checks as opt-in audits.

## Standards sources

Each diagnostic identifies its rule source. The validator draws from:

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

Text reports group repeated diagnostics by default:

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
fnm use
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
