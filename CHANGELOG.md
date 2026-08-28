# Changelog

All notable changes to this package will be documented in this file.

## 1.0.2 - 2026-08-28

- Fixed `sitemap-validator` and `sitemap-validator-live` when npm invokes them
  through generated `.bin` symlinks.
- Added regression coverage that runs both package binaries through npm-style
  symlink paths.

## 1.0.1 - 2026-08-28

- Split Google extension validation, live URL storage, guarded live fetching,
  and CI policy evaluation into focused internal modules without changing the
  public library API.
- Kept request timeouts active while reading live response bodies and applied
  response-size limits and cleanup through one guarded fetch path.
- Centralized saved URL handling for plain text, JSON arrays, and JSONL records
  with source sitemap context.
- Expanded the suite from 98 to 114 behavior-focused tests, including publish
  gate rejection, parser and sitemap limits, loader failures, live audit errors,
  stored finding caps, and browser dependency checks.
- Updated the vulnerable transitive `brace-expansion` development dependency.
- Added project terminology and documented live-fetch limits and DNS timing
  constraints.

## 1.0.0 - 2026-06-28

- Initial public release of `@trybyte/sitemap-validator`.
- Added core XML sitemap and sitemap index validation for generated files.
- Added Google image, News, video, PageMap, and hreflang sitemap extension checks.
- Added browser-safe entrypoint at `@trybyte/sitemap-validator/browser`.
- Added CLI publish gate as `sitemap-validator`.
- Added separate live wrapper as `sitemap-validator-live` for fetching published sitemaps and running opt-in URL audits.
- Added structured diagnostics, CI policy helpers, grouped reports, progress events, and release verification scripts.
