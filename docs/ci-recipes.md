# CI recipes

Run sitemap validation after your application generates sitemap XML and before
deployment. Pass it generated local files, not live sitemap URLs.

## Minimal CLI gate

```bash
npm run build
npm run generate:sitemap
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --detail summary
```

The CLI exits non-zero when the selected CI policy fails. Default policy fails on
errors. Use strict policy to fail on warnings too:

```bash
npx @trybyte/sitemap-validator ./build/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --policy strict
```

## Sitemap index with generated children

If `./build/sitemap-index.xml` references generated child files by public URL,
map that public prefix to the generated local directory:

```bash
npx @trybyte/sitemap-validator ./build/sitemap-index.xml \
  --sitemap-location https://example.com/sitemap-index.xml \
  --public-url-prefix https://example.com/ \
  --local-sitemap-root ./build \
  --detail summary
```

For example, `https://example.com/products.xml` is loaded from
`./build/products.xml`.

## Live sitemap wrapper

Use `sitemap-validator-live` for downloaded sitemap files, already-published
sitemaps, scheduled monitoring, post-deploy checks, or manual SEO audits. This
command is separate from the publish gate.

Validate a downloaded sitemap file:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live ./downloads/sitemap.xml \
  --sitemap-location https://example.com/sitemap.xml \
  --detail summary
```

Fetch and validate the live sitemap XML:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap.xml --detail summary
```

Save discovered page URLs to a file:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live https://example.com/sitemap.xml \
  --save-urls reports/sitemap-urls.txt \
  --detail summary
```

Run opt-in audits from that saved URL list:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live --urls-file reports/sitemap-urls.txt \
  --check-status \
  --check-canonical \
  --check-noindex \
  --audit-fail-on warning
```

Available opt-in checks are `--check-duplicates`, `--check-robots`,
`--check-status`, `--check-canonical`, `--require-canonical`,
`--check-noindex`, and `--all-audits`.

The live wrapper uses the `googlebot-smartphone` user-agent preset by default.
Choose another preset to test a different crawler:

```bash
npx --package @trybyte/sitemap-validator sitemap-validator-live --urls-file reports/sitemap-urls.txt \
  --check-robots \
  --check-status \
  --user-agent-preset googlebot
```

`--user-agent` controls the request header. `--robots-user-agent` controls the
robots.txt matching token. The default `googlebot-smartphone` preset sends the
full Googlebot Smartphone header and uses `Googlebot` for robots.txt matching.
Request headers cannot satisfy identity checks based on source IP, reverse DNS,
firewall allowlists, or bot-management systems. Allowlist the audit machine or
run the job from permitted infrastructure when the site uses those checks.

Live audits check at most 1,000 unique URLs by default. Set
`--max-audit-urls 0` to check every URL, or split
`reports/sitemap-urls.txt` into shards and run smaller jobs.

## Shared Node script

Use a script when you want custom policy, text/JSON reports, or integration with
an existing build system.

```ts
import { mkdir, writeFile } from "node:fs/promises";
import {
  assertValidForCi,
  createLocalSitemapLoader,
  createJsonReport,
  createTextReport,
  validateSitemapSet
} from "@trybyte/sitemap-validator";

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

await mkdir("reports", { recursive: true });
await writeFile("reports/sitemap-validation.txt", createTextReport(result, { detail: "grouped" }));
await writeFile("reports/sitemap-validation.json", createJsonReport(result, { detail: "grouped" }));

assertValidForCi(result, {
  failOn: ["error"]
});
```

If `assertValidForCi()` throws, the CI job fails.

## GitHub Actions

```yaml
name: sitemap-validation

on:
  pull_request:
  push:
    branches: [main]

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

To preserve reports:

```yaml
steps:
  - run: node scripts/validate-sitemap.mjs
  - uses: actions/upload-artifact@v4
    if: always()
    with:
      name: sitemap-validation
      path: reports/
```

## GitLab CI

```yaml
sitemap-validation:
  image: node:20
  script:
    - npm ci
    - npm run build
    - npm run generate:sitemap
    - npx @trybyte/sitemap-validator ./build/sitemap.xml --sitemap-location https://example.com/sitemap.xml --detail summary
```

## Jenkins

```groovy
pipeline {
  agent any
  stages {
    stage('Sitemap validation') {
      steps {
        sh 'npm ci'
        sh 'npm run build'
        sh 'npm run generate:sitemap'
        sh 'npx @trybyte/sitemap-validator ./build/sitemap.xml --sitemap-location https://example.com/sitemap.xml --detail summary'
      }
    }
  }
}
```

## Vercel, Netlify, and Cloudflare Pages

Add validation to the build command after sitemap generation:

```json
{
  "scripts": {
    "build": "your-build-command && npm run generate:sitemap && sitemap-validator ./build/sitemap.xml --sitemap-location https://example.com/sitemap.xml --detail summary"
  }
}
```

When the validator exits non-zero, the deployment stops.

## Jest and Vitest

For repositories that already use a test runner:

```ts
import { assertValidForCi, validateSitemap } from "@trybyte/sitemap-validator";

test("generated sitemap is valid", async () => {
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
});
```

## Benchmark gate

Use large benchmarks as scheduled or release-blocking jobs, not every small pull
request.

```bash
npm run fixture:large -- --urls 1000000 --urls-per-file 50000
npm run bench:check -- --baseline benchmarks/ci-baseline.json
```

Refresh a baseline only after approving a change to the expected performance.
