import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import sax from "sax";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { SaxesParser } from "saxes";
import { validateSitemap } from "../dist/index.js";

const args = parseArgs(process.argv.slice(2));
const file = args.file ?? join("benchmarks/generated", "sitemap-00001.xml.gz");
const gzip = args.gzip !== "false" && file.endsWith(".gz");

const validatorStart = performance.now();
const result = await validateSitemap(
  { path: file, gzip, sourceId: file },
  {
    sitemapLocation: "https://example.com/sitemaps/sitemap-00001.xml.gz",
    google: false,
  },
);
const validatorMs = performance.now() - validatorStart;

const scannerStart = performance.now();
const text = await readXmlText(file, gzip);
const scanner = scanLocs(text);
const scannerMs = performance.now() - scannerStart;

const saxStart = performance.now();
const saxResult = parseWithSax(text);
const saxMs = performance.now() - saxStart;

const saxesStart = performance.now();
const saxesResult = parseWithSaxes(text);
const saxesMs = performance.now() - saxesStart;

const fxpValidateStart = performance.now();
const fxpValidation = XMLValidator.validate(text);
const fxpValidateMs = performance.now() - fxpValidateStart;

const fxpParseStart = performance.now();
const fxpParser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
});
const fxpDoc = fxpParser.parse(text);
const fxpParseMs = performance.now() - fxpParseStart;

console.log(JSON.stringify(
  {
    file,
    validator: {
      valid: result.valid,
      urls: result.summary.urls,
      diagnostics: result.summary.diagnostics,
      elapsedMs: Math.round(validatorMs),
      urlsPerSecond: Math.round(result.summary.urls / (validatorMs / 1000)),
    },
    sitemapSpecificScannerPrototype: {
      note: "Benchmark ceiling only; not XML-safe and not production validation.",
      urls: scanner.urls,
      locs: scanner.locs,
      elapsedMs: Math.round(scannerMs),
      locsPerSecond: Math.round(scanner.locs / (scannerMs / 1000)),
    },
    saxPackage: {
      urls: saxResult.urls,
      locs: saxResult.locs,
      elapsedMs: Math.round(saxMs),
      locsPerSecond: Math.round(saxResult.locs / (saxMs / 1000)),
    },
    saxesPackage: {
      urls: saxesResult.urls,
      locs: saxesResult.locs,
      elapsedMs: Math.round(saxesMs),
      locsPerSecond: Math.round(saxesResult.locs / (saxesMs / 1000)),
    },
    fastXmlParser: {
      validation: fxpValidation === true ? "ok" : fxpValidation,
      parseElapsedMs: Math.round(fxpParseMs),
      validateElapsedMs: Math.round(fxpValidateMs),
      rootKeys: typeof fxpDoc === "object" && fxpDoc !== null ? Object.keys(fxpDoc).slice(0, 5) : [],
    },
  },
  null,
  2,
));

async function readXmlText(path, gzipInput) {
  const stream = gzipInput ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  let text = "";

  for await (const chunk of stream) {
    text += chunk.toString("utf8");
  }

  return text;
}

function scanLocs(text) {
  return {
    urls: countMatches(text, /<url(?:\s|>)/g),
    locs: countMatches(text, /<loc>/g),
  };
}

function parseWithSax(text) {
  const parser = sax.parser(true, {
    lowercase: false,
    normalize: false,
    position: true,
    trim: false,
    xmlns: true,
  });
  const counts = { urls: 0, locs: 0 };

  parser.onopentag = (node) => {
    if (node.name === "url") counts.urls += 1;
    if (node.name === "loc") counts.locs += 1;
  };
  parser.write(text).close();

  return counts;
}

function parseWithSaxes(text) {
  const parser = new SaxesParser({
    xmlns: true,
  });
  const counts = { urls: 0, locs: 0 };

  parser.on("opentag", (node) => {
    if (node.local === "url") counts.urls += 1;
    if (node.local === "loc") counts.locs += 1;
  });
  parser.write(text).close();

  return counts;
}

function countMatches(value, pattern) {
  let count = 0;

  while (pattern.exec(value)) {
    count += 1;
  }

  return count;
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
