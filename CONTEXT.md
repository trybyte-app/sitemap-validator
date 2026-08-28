# Sitemap validation

This context covers deciding whether generated or published XML sitemaps comply with the document-level rules that apply to them. It also covers separate, opt-in checks against a live website.

## Language

### Publish gate

The pre-deployment validation path for generated local sitemap files. It never fetches a live sitemap or page URL.
Do not call it the core CLI or offline mode.

### Live wrapper

The separate validation path for an already-published sitemap and its optional website checks.
Do not call it live mode or the remote validator.

### XML diagnostic

A finding about sitemap XML backed by Google, sitemaps.org, W3C, or a relevant RFC. An error means the document is invalid or rejected by the applicable source.
Do not call it a live issue or audit finding.

### Live audit finding

An operational website finding from an opt-in robots, status, redirect, canonical, noindex, or duplicate URL check. It does not change whether the sitemap XML is valid.
Do not call it an XML diagnostic or sitemap validation error.

### Live URL dataset

The bounded collection of page URLs discovered from live sitemaps or read from a saved URL list, including source sitemap provenance when available.
Do not call it a URL array or crawl queue.

### Guarded live fetch

A live-wrapper fetch that applies target admission, redirect, timeout, response-size, and body-cleanup rules before returning data to a live check.
Do not call it an HTTP helper or raw fetch.

### Extension validation

Document-level validation for Google image, News, video, PageMap, and hreflang sitemap markup.
Do not call it a page audit or media crawl.

### CI policy evaluation

The decision that maps XML diagnostics to a publish-gate pass or failure using configured severities, rule codes, and warning limits.
Do not call it XML validation or live audit evaluation.
