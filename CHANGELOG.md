# Changelog

## 1.0.4 - 2026-09-01

- Consolidated shared argument parsing, path handling, CI severity parsing,
  error reporting, and process startup behavior across both CLI entry points.
- Centralized XML schema utility-attribute recognition without changing the
  public library interface or command behavior.

## 1.0.3 - 2026-08-31

- Fixed foreign-element placement, unexpected character data, invalid sitemap
  locations, date bounds, decimal priority syntax, and Unicode character limits.
- Made sitemap depth limits block incomplete validation, bounded concurrent
  source loading, and preserved cancellation through input and loader completion.
- Corrected local URL-to-file mapping and stopped upstream gzip consumption
  when the decompressed size limit is reached.
- Corrected IPv6 public-address checks, inactive HTML metadata handling, and
  crawler-specific robots directives in live audits.
- Bounded compact CI reports, corrected mixed diagnostic group output, rejected
  incompatible saved-URL options, and handled closed stdout pipes in both CLIs.
- Added optional loader abort signals and diagnostic group variation metadata,
  two blocking diagnostic codes, and 25 regression tests.

## 1.0.2 - 2026-08-28

- Fixed `sitemap-validator` and `sitemap-validator-live` when npm invokes them
  through generated `.bin` symlinks.
- Added regression coverage that runs both package binaries through npm-style
  symlink paths.

## 1.0.1 - 2026-08-28

- Split Google extension validation, live URL storage, guarded live fetching,
  and CI policy evaluation into separate internal modules. The public library
  API did not change.
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
- Added `sitemap-validator-live` to fetch published sitemaps and run opt-in URL
  audits outside the publish gate.
- Added structured diagnostics, CI policy helpers, grouped reports, progress
  events, and release verification scripts.
