# Sitemap validation

This glossary separates XML sitemap validation from optional checks against a
published website.

## Language

**Publish gate**:
The pre-deployment validation path for generated local sitemap files. It never
fetches a live sitemap or page URL.
_Avoid_: Core CLI, offline mode

**Live wrapper**:
The validation path for an already-published sitemap and its optional website
checks.
_Avoid_: Live mode, remote validator

**XML diagnostic**:
A sitemap XML finding backed by Google, sitemaps.org, W3C, or a relevant RFC. An
error means the applicable source rejects the document.
_Avoid_: Live issue, audit finding

**Live audit finding**:
A website finding from an opt-in robots, status, redirect, canonical, noindex,
or duplicate URL check. It does not affect XML validity.
_Avoid_: XML diagnostic, sitemap validation error

**Live URL dataset**:
A bounded collection of page URLs from published sitemaps or a saved URL list.
Each record can retain its source sitemap.
_Avoid_: URL array, crawl queue

**Guarded live fetch**:
A live-wrapper request with target, redirect, timeout, response-size, and body
cleanup controls.
_Avoid_: HTTP helper, raw fetch

**Extension validation**:
Document-level validation for Google image, News, video, PageMap, and hreflang
sitemap markup.
_Avoid_: Page audit, media crawl

**CI policy evaluation**:
The mapping from XML diagnostics to a publish-gate result. The policy uses
severities, rule codes, and warning limits.
_Avoid_: XML validation, live audit evaluation
