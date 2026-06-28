import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { validateSitemapSet } from "../dist/index.js";

const args = parseArgs(process.argv.slice(2));
const dir = args.dir ?? "benchmarks/generated";
const baselinePath = args.baseline ?? "benchmarks/baseline.json";
const baseUrl = args.baseUrl ?? "https://example.com";
const minThroughputRatio = Number(args.minThroughputRatio ?? "0.75");
const maxMemoryRatio = Number(args.maxMemoryRatio ?? "1.5");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const current = await runBenchmark(dir, baseUrl);
const minUrlsPerSecond = Math.floor(Number(baseline.urlsPerSecond) * minThroughputRatio);
const maxRssDeltaMb = Math.ceil(Number(baseline.rssDeltaMb) * maxMemoryRatio);
const failures = [];

if (!current.valid) {
  failures.push("current benchmark validation result is invalid");
}

if (current.urls !== baseline.urls) {
  failures.push(`current URL count ${current.urls} does not match baseline ${baseline.urls}`);
}

if (current.urlsPerSecond < minUrlsPerSecond) {
  failures.push(`throughput ${current.urlsPerSecond} URLs/sec is below gate ${minUrlsPerSecond}`);
}

if (current.rssDeltaMb > maxRssDeltaMb) {
  failures.push(`RSS delta ${current.rssDeltaMb} MB is above gate ${maxRssDeltaMb} MB`);
}

const report = {
  baseline: {
    urls: baseline.urls,
    urlsPerSecond: baseline.urlsPerSecond,
    rssDeltaMb: baseline.rssDeltaMb,
  },
  current,
  gates: {
    minThroughputRatio,
    minUrlsPerSecond,
    maxMemoryRatio,
    maxRssDeltaMb,
  },
  passed: failures.length === 0,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}

async function runBenchmark(dir, baseUrl) {
  const sitemapPrefix = `${baseUrl}/sitemaps/`;
  const startMemory = process.memoryUsage().rss;
  const start = performance.now();

  const result = await validateSitemapSet(
    {
      path: join(dir, "sitemap-index.xml"),
      sourceId: "sitemap-index.xml",
    },
    {
      sourceId: "benchmark-gate",
      sitemapLocation: `${baseUrl}/sitemaps/sitemap-index.xml`,
      maxDepth: 1,
      loader: async ({ loc }) => {
        if (!loc.startsWith(sitemapPrefix)) {
          return null;
        }

        const fileName = loc.slice(sitemapPrefix.length);
        const path = join(dir, fileName);

        statSync(path);

        return {
          input: { path },
          sourceId: fileName,
          sitemapLocation: loc,
          gzip: fileName.endsWith(".gz"),
        };
      },
    },
  );

  const elapsedMs = performance.now() - start;
  const rssDelta = process.memoryUsage().rss - startMemory;

  return {
    valid: result.valid,
    urls: result.summary.urls,
    sources: result.summary.sources,
    elapsedMs: Math.round(elapsedMs),
    urlsPerSecond: Math.round(result.summary.urls / (elapsedMs / 1000)),
    rssDeltaMb: Math.round((rssDelta / 1024 / 1024) * 10) / 10,
    diagnostics: result.summary.diagnostics,
  };
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--")) {
      continue;
    }

    parsed[toCamel(key.slice(2))] = value ?? "true";
    index += 1;
  }

  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
