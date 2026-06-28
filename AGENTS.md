# Sitemap Validator Project Frame

## Purpose

This package is a TypeScript XML sitemap validator. Its job is to decide whether
a generated XML sitemap or sitemap index is structurally valid, standards-aligned,
and ready to publish or submit.

The core validator is not a sitemap generator, crawler, robots.txt checker,
duplicate URL auditor, or page health checker.

## Primary User Story

A project generates sitemap XML during build or CI. Before deploy, the project
passes that generated local file to `sitemap-validator`. If validation produces
deployment-blocking diagnostics, CI fails and the sitemap is not published.

The CLI should validate generated files:

```bash
sitemap-validator ./build/sitemap.xml --sitemap-location https://example.com/sitemap.xml
```

`sitemap-validator` is the command. `--sitemap-location` is metadata for the future
public URL and is used for sitemap.org host/path constraints. It must not make
the CLI fetch that URL.

## Scope

Keep the package focused on XML document validation:

- XML well-formedness, UTF-8 expectations, XML declaration encoding, safe parser
  behavior, and namespace handling.
- `urlset` and `sitemapindex` roots in the sitemap namespace.
- Required parent/child structure and required `loc` fields.
- Empty present values for sitemap protocol and extension fields.
- Core sitemap child order and duplicate core child element checks where the
  schema defines single ordered fields.
- Absolute URL, URI, and IRI syntax checks with RFC 3986/RFC 3987 provenance.
- Sitemap protocol constraints: `loc` length, per-file URL count, sitemap index
  count, uncompressed byte-size limit, supported URL schemes, same-host checks,
  and sitemap file location constraints when `sitemapLocation` is known.
- `lastmod`, `changefreq`, and `priority` validation.
- Google XML sitemap behavior that is document-level: ignored protocol fields,
  image/news/video extension rules, combined extensions, and hreflang annotations.
- Optional set-level hreflang graph validation because Google documents
  alternate URL return-link and cluster expectations.
- `.xml.gz` inputs, streaming-oriented parsing, bounded resource limits,
  progress events, and grouped diagnostics for large sitemap sets.

Google-specific XML checks should run alongside sitemaps.org checks by default.
Do not force normal users to choose between "protocol mode" and "Google mode";
diagnostics carry source provenance.

## Out Of Scope

Do not add these to the core XML validator, generated-file CLI, public validation
API, or default CI policy:

- HTTP status checks for page URLs.
- Redirect checks.
- Canonical tag checks.
- `noindex` checks.
- Rendered metadata or page content checks.
- Robots.txt discovery or allow/disallow comparison.
- Duplicate URL auditing across one or more sitemap files.
- Fetching page, image, video, or live sitemap URLs from the core CLI.
- Remote HTTP sitemap loading as a built-in publish-gate path.

These are not XML sitemap validity rules.

## Live Wrapper Scope

The package may expose a separate `sitemap-validator-live` wrapper for SEO
managers, SEO strategists, site owners, and monitoring jobs that need to fetch an
already-published sitemap first. Keep that wrapper separate from the core
validator and do not frame it as the main CI/CD pre-deploy path.

The live wrapper may:

- Fetch live sitemap XML and pass it into the normal XML validator.
- Traverse live sitemap indexes by fetching referenced sitemap files, including
  plain XML and `.xml.gz` child sitemaps.
- Save collected sitemap page URLs to a local file with `--save-urls`.
- Save collected sitemap page URL records to JSONL with `--save-url-details`
  when users need to trace later live audit findings back to the source sitemap
  file that listed the URL.
- Read a saved URL list with `--urls-file` so URL audits can be repeated without
  refetching sitemap XML.
- Run opt-in duplicate URL, robots.txt, HTTP status, canonical, and noindex
  checks.
- Default the live wrapper to the `googlebot-smartphone` user-agent preset.
- Let users set known user-agent pairs with `--user-agent-preset`.
- Keep `--user-agent` for the HTTP request header and `--robots-user-agent` for
  robots.txt matching. The `googlebot-smartphone` preset should send the full
  Googlebot Smartphone request header and use `Googlebot` for robots matching.

Live wrapper rules:

- Every page-level or robots-level check must be opt-in.
- Live audit findings must stay separate from XML validation diagnostics.
- Live audit findings for URL-level checks should include source sitemap context
  when available, especially in JSON reports for sitemap index audits.
- Live audit findings should not use the core rule registry unless the rule is
  truly an XML sitemap validation rule.
- Use bounded defaults for page audits, including timeouts, byte limits,
  concurrency, and URL caps.
- Stream collected URLs to disk for large sitemap sets; do not hold every URL in
  memory just to save URLs or run opt-in audits.
- Keep duplicate auditing disk-backed or otherwise bounded for large saved URL
  lists.
- Cap stored live finding rows separately from total finding counts so broken
  large sites do not create unbounded reports.
- Emit minimal live wrapper progress logs to stderr so long checks visibly keep
  moving without corrupting stdout JSON/text reports; keep a quiet option for
  users who need silence.
- Refuse private, loopback, link-local, reserved, and non-public live fetch
  targets by default, including redirect targets. Allow them only through an
  explicit trusted-site option such as `--allow-private-hosts`.
- Robots checks should use `@trybyte/robotstxt-parser`.
- Document that user-agent spoofing does not satisfy sites that verify bot
  identity by source IP, reverse DNS, firewall allowlists, or bot-management
  systems; users may need to whitelist the machine running the audit or run from
  allowed infrastructure.
- Do not export live-audit types from the root library API unless there is a
  deliberate product decision to support them as public contracts.

## Standards Sources

Treat standards provenance as first-class. Diagnostics should include the source
family and, where useful, a spec/document link.

Primary references:

- W3C XML 1.0.
- W3C Namespaces in XML.
- W3C Date and Time / XML Schema datatypes where applicable.
- RFC 3986 for URIs and RFC 3987 for IRIs.
- BCP 47 / RFC 5646 and RFC 4647 for language tags, plus Google localized URL
  rules.
- sitemaps.org XML protocol and sitemap index rules.
- sitemaps.org Sitemap 0.9 XSD and sitemap index XSD.
- Google Search Central sitemap docs.
- Google image, News, video, hreflang/localized URL, and combined sitemap
  extension docs.
- Google image 1.1, News 0.9, and video 1.1 XSDs.

Sitemap itself is not an RFC. URL validation is where RFCs matter most.

Use `docs/standards-coverage.md` as the human coverage boundary and
`docs/rule-matrix.md` as the generated implementation-backed rule list. Do not
claim complete standards coverage just because tests pass.

## API Direction

Prefer library-first design. CLI support exists for CI, but the core package
should remain typed, structured, and suitable for product use.

Public diagnostics should include:

- Stable code.
- Severity.
- Human-readable message.
- Rule source.
- Source/file identifier.
- XML path or sitemap entry context when available.
- Line/column when available.
- Relevant spec link when available.

Severity meaning:

- `error`: invalid or rejected by the relevant standard/profile.
- `warning`: valid but ignored, deprecated, unsupported, risky, or likely
  unintended.
- `info`: valid contextual note.

The API should support:

- Single XML sitemap validation.
- Sitemap index validation as a set when a caller provides a loader.
- Local inputs: string, buffer, file path, stream, and gzip stream.
- Memory and filesystem loaders for generated sitemap sets.
- Custom source loaders for non-file storage.
- Configurable limits, cancellation, progress callbacks, async event iteration,
  and deterministic loader concurrency.
- Structured summaries for CI, logs, UI, and stored reports.
- `evaluateForCi()` and `assertValidForCi()` helpers that fail on errors by
  default and can be configured for warnings or specific rule codes.

Do not expose public types for robots checks, duplicate URL detection, page URL
audits, or built-in HTTP fetching.

## CLI Direction

The CLI is a publish gate for generated files. It should reject live `http://` or
`https://` sitemap targets and explain that users must generate the sitemap first,
pass the local file, and supply `--sitemap-location` for future-public URL rules.

For sitemap indexes, the CLI may load generated child files only through a local
mapping:

```bash
sitemap-validator ./build/sitemap-index.xml \
  --sitemap-location https://example.com/sitemap-index.xml \
  --url-prefix https://example.com/ \
  --sitemap-root ./build
```

Keep CLI reports compact by default. Use grouped output unless the caller asks for
full detail.

## Large Sitemap Strategy

A valid single sitemap cannot contain millions of URLs. The protocol limit is per
file, so large sites must use sitemap indexes and many sitemap files.

Design for:

- Streaming parse, not full DOM parse.
- Gzip streaming with decompressed-size guards.
- Limits enforced while reading.
- Incremental diagnostics.
- Aggregated summaries across sitemap sets.
- Cancellation and progress hooks.
- Bounded memory use.
- Optional concurrency when loading generated child sitemap documents.

Conceptual pipeline:

```text
input stream -> gzip guard -> XML stream parser -> sitemap events -> rule engine -> diagnostics
```

## Parser Direction

Current parser decision:

- `saxes` is the production parser choice.
- Keep parser access behind `src/xml-parser.ts`.
- Rule logic should consume normalized parser events, not parser-package-specific
  objects.

Do not build a custom XML parser unless benchmarks prove parser throughput is the
real bottleneck and the replacement preserves XML well-formedness, namespace
behavior, entity safety, line/column reporting, and untrusted-input protections.

## Maintenance Rules

- When rule definitions change, run `npm run docs:rules`.
- When public exports or types change, run `npm run api:check`; run
  `npm run api:snapshot` only after reviewing an intentional API change.
- Before release, run `npm run verify:release`.
- Keep generated reports, benchmark outputs, and local baselines out of git.
- Keep README examples aligned with actual exported APIs and CLI flags.
- Remove stale docs or tests when a feature leaves scope.

## Open Product Questions

- How deep should Google extension validation go before it becomes speculative
  without fetching page/media URLs?
- Whether to add an automated XSD/schema conformance fixture suite.
- Whether to pin full registry datasets for ISO 639-2/3, BCP 47, and related
  code lists instead of relying on runtime/library validation where acceptable.
- What release-hardening steps are required before the first public publish.
