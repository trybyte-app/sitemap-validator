import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSitemapSet } from "../dist/index.js";

const args = parseArgs(process.argv.slice(2));
const dir = args.dir ?? "benchmarks/generated";
const out = args.out ?? "benchmarks/baseline.json";
const baseUrl = args.baseUrl ?? "https://example.com";
const start = performance.now();
const startMemory = process.memoryUsage().rss;

const result = await validateSitemapSet(
  {
    path: join(dir, "sitemap-index.xml"),
    sourceId: "sitemap-index.xml",
  },
  {
    sourceId: "benchmark-baseline",
    sitemapLocation: `${baseUrl}/sitemaps/sitemap-index.xml`,
    maxDepth: 1,
    loader: async ({ loc }) => {
      const prefix = `${baseUrl}/sitemaps/`;

      if (!loc.startsWith(prefix)) {
        return null;
      }

      const fileName = loc.slice(prefix.length);

      return {
        input: { path: join(dir, fileName) },
        sourceId: fileName,
        sitemapLocation: loc,
        gzip: fileName.endsWith(".gz"),
      };
    },
  },
);

const elapsedMs = performance.now() - start;
const rssDelta = process.memoryUsage().rss - startMemory;
const baseline = {
  generatedAt: new Date().toISOString(),
  urls: result.summary.urls,
  sources: result.summary.sources,
  valid: result.valid,
  diagnostics: result.summary.diagnostics,
  elapsedMs: Math.round(elapsedMs),
  urlsPerSecond: Math.round(result.summary.urls / (elapsedMs / 1000)),
  rssDeltaMb: Math.round((rssDelta / 1024 / 1024) * 10) / 10,
};

await mkdir(join(out, ".."), { recursive: true });
await writeFile(out, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(JSON.stringify(baseline, null, 2));

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
