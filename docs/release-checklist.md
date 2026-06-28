# Release Checklist

Use this before publishing a package version.

## Required

- Confirm `package.json` uses the intended scoped package name and public npm metadata.
- Confirm `LICENSE`, `README.md`, `CHANGELOG.md`, and linked docs are included in the npm package.
- Run `npm ci` from a clean install when practical.
- Run `npm run verify:release`.
- Review the `npm pack --dry-run` file list printed by `npm run pack:dry-run`.
- Confirm GitHub repository description, topics, and homepage are current.
- Confirm npm authentication has publish rights for the `@trybyte` organization.

## Before 1.x API Expansion

- Revisit whether `getCiPolicyPreset()` should remain public alongside `resolveCiPolicy()`.
- Keep `sitemap-validator-live` separate from the root library API unless live-audit types are intentionally supported as public contracts.
- Avoid adding page-level audits to the core `sitemap-validator` command.

## Hardening Backlog

- Split `src/validator.ts` extension handling into namespace-specific modules or a handler registry.
- Split `src/live-cli.ts` into fetch policy, URL collection, audit, and report modules.
- Reduce duplicate URL parsing and hostname conversion in the hot path.
- Add an explicit documentation note for DNS rebinding or TOCTOU limitations in live fetch SSRF protection.
