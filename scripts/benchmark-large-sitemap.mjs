import { statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSitemapSet } from "../dist/index.js";

const args = parseArgs(process.argv.slice(2));
const dir = args.dir ?? "benchmarks/generated";
const indexPath = args.index ?? join(dir, "sitemap-index.xml");
const baseUrl = args.baseUrl ?? "https://example.com";
const sitemapPrefix = `${baseUrl}/sitemaps/`;
const startMemory = process.memoryUsage().rss;
const start = performance.now();

const result = await validateSitemapSet(
  {
    path: indexPath,
    sourceId: "sitemap-index.xml",
  },
  {
    sourceId: "local-sitemap-set",
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
const endMemory = process.memoryUsage().rss;

console.log(JSON.stringify(
  {
    valid: result.valid,
    sources: result.summary.sources,
    urls: result.summary.urls,
    sitemaps: result.summary.sitemaps,
    diagnostics: result.summary.diagnostics,
    elapsedMs: Math.round(elapsedMs),
    urlsPerSecond: Math.round(result.summary.urls / (elapsedMs / 1000)),
    rssStartMb: toMb(startMemory),
    rssEndMb: toMb(endMemory),
    rssDeltaMb: toMb(endMemory - startMemory),
    index: pathToFileURL(indexPath).href,
  },
  null,
  2,
));

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

function toMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
