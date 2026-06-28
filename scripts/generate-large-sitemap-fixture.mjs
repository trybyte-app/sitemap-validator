import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";

const args = parseArgs(process.argv.slice(2));
const outDir = args.out ?? "benchmarks/generated";
const totalUrls = Number(args.urls ?? 100_000);
const urlsPerFile = Number(args.urlsPerFile ?? 50_000);
const gzip = args.gzip !== "false";
const baseUrl = args.baseUrl ?? "https://example.com";
const pagePrefix = args.pagePrefix ?? "/sitemaps/pages";
const invalidEvery = Number(args.invalidEvery ?? 0);

if (!Number.isInteger(totalUrls) || totalUrls < 1) {
  throw new Error("--urls must be a positive integer.");
}

if (!Number.isInteger(urlsPerFile) || urlsPerFile < 1 || urlsPerFile > 50_000) {
  throw new Error("--urls-per-file must be between 1 and 50000.");
}

await mkdir(outDir, { recursive: true });

const sitemapCount = Math.ceil(totalUrls / urlsPerFile);
const extension = gzip ? ".xml.gz" : ".xml";
const childNames = [];

for (let fileIndex = 0; fileIndex < sitemapCount; fileIndex += 1) {
  const start = fileIndex * urlsPerFile;
  const count = Math.min(urlsPerFile, totalUrls - start);
  const name = `sitemap-${String(fileIndex + 1).padStart(5, "0")}${extension}`;
  childNames.push(name);
  await writeSitemap(join(outDir, name), { start, count, baseUrl, gzip, pagePrefix, invalidEvery });
}

await writeIndex(join(outDir, "sitemap-index.xml"), {
  childNames,
  baseUrl,
});

console.log(JSON.stringify(
  {
    outDir,
    totalUrls,
    urlsPerFile,
    sitemapCount,
    gzip,
    pagePrefix,
    invalidEvery,
    index: join(outDir, "sitemap-index.xml"),
  },
  null,
  2,
));

async function writeSitemap(path, options) {
  const fileStream = createWriteStream(path);
  const stream = options.gzip ? createGzip() : fileStream;

  if (options.gzip) {
    stream.pipe(fileStream);
  }

  stream.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  stream.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n');

  for (let index = 0; index < options.count; index += 1) {
    const id = options.start + index + 1;
    stream.write("  <url>\n");
    if (options.invalidEvery > 0 && id % options.invalidEvery === 0) {
      stream.write(`    <loc>${options.baseUrl}${options.pagePrefix}/bad url ${id}</loc>\n`);
    } else {
      stream.write(`    <loc>${options.baseUrl}${options.pagePrefix}/${id}</loc>\n`);
    }
    stream.write("    <lastmod>2026-06-10</lastmod>\n");
    stream.write("  </url>\n");
  }

  stream.write("</urlset>\n");
  stream.end();

  if (options.gzip) {
    await finished(fileStream);
  } else {
    await finished(stream);
  }
}

async function writeIndex(path, options) {
  const stream = createWriteStream(path);
  stream.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  stream.write('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n');

  for (const childName of options.childNames) {
    stream.write("  <sitemap>\n");
    stream.write(`    <loc>${options.baseUrl}/sitemaps/${childName}</loc>\n`);
    stream.write("    <lastmod>2026-06-10</lastmod>\n");
    stream.write("  </sitemap>\n");
  }

  stream.write("</sitemapindex>\n");
  stream.end();
  await finished(stream);
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
