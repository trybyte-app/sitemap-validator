import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";

const URL_COLLECTION_LOG_INTERVAL = 100_000;

export interface LiveUrlRecord {
  url: string;
  sourceSitemap: string | undefined;
}

export interface LiveUrlDataset {
  readonly totalUrls: number;
  readonly replayable: boolean;
  records(): AsyncIterable<LiveUrlRecord>;
  close(): Promise<void>;
}

export interface LiveUrlDatasetCollector {
  add(record: LiveUrlRecord): Promise<void>;
  finish(): Promise<LiveUrlDataset>;
  close(): Promise<void>;
}

export interface LiveUrlDatasetCollectorOptions {
  saveUrlsTo?: string | undefined;
  saveUrlDetailsTo?: string | undefined;
  replayable: boolean;
}

export interface OpenLiveUrlDatasetOptions {
  onProgress?: ((message: string) => void) | undefined;
}

export class LiveUrlDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveUrlDatasetError";
  }
}

export async function openLiveUrlDataset(
  path: string,
  options: OpenLiveUrlDatasetOptions = {},
): Promise<LiveUrlDataset> {
  options.onProgress?.(`Reading saved URL list: ${path}`);
  const format = await detectDatasetFormat(path);
  const totalUrls = await countRecords(path, format, options.onProgress);
  return createDataset(path, format, totalUrls);
}

export async function createLiveUrlDatasetCollector(
  options: LiveUrlDatasetCollectorOptions,
): Promise<LiveUrlDatasetCollector> {
  if (!options.replayable && !options.saveUrlsTo && !options.saveUrlDetailsTo) {
    return createCountingCollector();
  }

  const needsTemporaryDirectory = options.replayable && !options.saveUrlDetailsTo;
  const temporaryDirectory = needsTemporaryDirectory
    ? await mkdtemp(join(tmpdir(), "sitemap-live-urls-"))
    : undefined;
  const urlPath = options.saveUrlsTo;
  const detailsPath = options.saveUrlDetailsTo
    ?? (options.replayable ? join(temporaryDirectory ?? tmpdir(), "url-details.jsonl") : undefined);
  const urlWriter = urlPath ? createWriteStream(urlPath, { flags: "w" }) : undefined;
  const detailsWriter = detailsPath ? createWriteStream(detailsPath, { flags: "w" }) : undefined;
  let totalUrls = 0;
  let settled = false;

  async function closeWriters(): Promise<void> {
    const writers = [urlWriter, detailsWriter].filter((writer) => writer !== undefined);

    await Promise.all(writers.map(async (writer) => {
      if (!writer.closed) {
        writer.end();
        await finished(writer);
      }
    }));
  }

  async function removeTemporaryDirectory(): Promise<void> {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  return {
    async add(record): Promise<void> {
      if (settled) {
        throw new Error("Cannot add URLs after the live URL dataset collector has finished.");
      }

      totalUrls += 1;

      if (urlWriter) {
        await writeStreamLine(urlWriter, `${record.url}\n`);
      }

      if (detailsWriter) {
        await writeStreamLine(detailsWriter, `${serializeUrlRecord(record)}\n`);
      }
    },
    async finish(): Promise<LiveUrlDataset> {
      if (settled) {
        throw new Error("The live URL dataset collector has already finished.");
      }

      settled = true;
      await closeWriters();

      if (detailsPath) {
        return createDataset(detailsPath, "jsonl", totalUrls, removeTemporaryDirectory);
      }

      if (urlPath) {
        return createDataset(urlPath, "text-or-json", totalUrls, removeTemporaryDirectory);
      }

      return createDataset(undefined, "none", totalUrls, removeTemporaryDirectory);
    },
    async close(): Promise<void> {
      if (settled) {
        return;
      }

      settled = true;
      await closeWriters();
      await removeTemporaryDirectory();
    },
  };
}

function createCountingCollector(): LiveUrlDatasetCollector {
  let totalUrls = 0;
  let settled = false;

  return {
    async add(): Promise<void> {
      if (settled) {
        throw new Error("Cannot add URLs after the live URL dataset collector has finished.");
      }

      totalUrls += 1;
    },
    async finish(): Promise<LiveUrlDataset> {
      if (settled) {
        throw new Error("The live URL dataset collector has already finished.");
      }

      settled = true;
      return createDataset(undefined, "none", totalUrls);
    },
    async close(): Promise<void> {
      settled = true;
    },
  };
}

type DatasetFormat = "none" | "jsonl" | "text-or-json";

function createDataset(
  path: string | undefined,
  format: DatasetFormat,
  totalUrls: number,
  cleanup: () => Promise<void> = async () => {},
): LiveUrlDataset {
  let closed = false;

  return {
    totalUrls,
    replayable: format !== "none",
    records(): AsyncIterable<LiveUrlRecord> {
      if (closed) {
        throw new Error("The live URL dataset is closed.");
      }

      if (!path || format === "none") {
        return emptyRecords();
      }

      return format === "jsonl" ? iterateUrlRecordsFile(path) : iterateUrlsFileAsRecords(path);
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      await cleanup();
    },
  };
}

async function detectDatasetFormat(path: string): Promise<Exclude<DatasetFormat, "none">> {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").trimStart().startsWith("{")
      ? "jsonl"
      : "text-or-json";
  } finally {
    await handle.close();
  }
}

async function countRecords(
  path: string,
  format: Exclude<DatasetFormat, "none">,
  onProgress: ((message: string) => void) | undefined,
): Promise<number> {
  let count = 0;
  const records = format === "jsonl" ? iterateUrlRecordsFile(path) : iterateUrlsFileAsRecords(path);

  for await (const _record of records) {
    count += 1;

    if (count % URL_COLLECTION_LOG_INTERVAL === 0) {
      onProgress?.(`Read ${formatCount(count)} ${format === "jsonl" ? "URL detail records" : "URLs from saved URL list"}.`);
    }
  }

  onProgress?.(
    format === "jsonl"
      ? `URL detail file ready: ${formatCount(count)} URL records.`
      : `Saved URL list ready: ${formatCount(count)} URL entries.`,
  );
  return count;
}

async function* emptyRecords(): AsyncGenerator<LiveUrlRecord, void, void> {}

async function* iterateUrlRecordsFile(path: string): AsyncGenerator<LiveUrlRecord, void, void> {
  for await (const line of iterateLines(path)) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    yield parseUrlRecordJson(trimmed);
  }
}

async function* iterateUrlsFileAsRecords(path: string): AsyncGenerator<LiveUrlRecord, void, void> {
  for await (const url of iterateUrlsFile(path)) {
    yield {
      url,
      sourceSitemap: undefined,
    };
  }
}

async function* iterateUrlsFile(path: string): AsyncGenerator<string, void, void> {
  if (await isJsonArrayFile(path)) {
    for (const url of await readJsonUrlsFile(path)) {
      yield url;
    }

    return;
  }

  for await (const line of iterateLines(path)) {
    const url = line.trim();

    if (url.length > 0 && !url.startsWith("#")) {
      yield url;
    }
  }
}

async function* iterateLines(path: string): AsyncGenerator<string, void, void> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    yield line;
  }
}

async function isJsonArrayFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(128);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").trimStart().startsWith("[");
  } finally {
    await handle.close();
  }
}

async function readJsonUrlsFile(path: string): Promise<string[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new LiveUrlDatasetError("--urls-file JSON must be an array of URL strings.");
  }

  return parsed;
}

function serializeUrlRecord(record: LiveUrlRecord): string {
  const payload: { url: string; sourceSitemap?: string } = {
    url: record.url,
  };

  if (record.sourceSitemap) {
    payload.sourceSitemap = record.sourceSitemap;
  }

  return JSON.stringify(payload);
}

function parseUrlRecordJson(line: string): LiveUrlRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    throw new LiveUrlDatasetError("--urls-file JSONL records must contain one JSON object per line.");
  }

  if (!isObjectRecord(parsed) || typeof parsed.url !== "string") {
    throw new LiveUrlDatasetError("--urls-file JSONL records must include a string url field.");
  }

  if ("sourceSitemap" in parsed && parsed.sourceSitemap !== undefined && typeof parsed.sourceSitemap !== "string") {
    throw new LiveUrlDatasetError("--urls-file JSONL sourceSitemap fields must be strings when present.");
  }

  return {
    url: parsed.url,
    sourceSitemap: typeof parsed.sourceSitemap === "string" ? parsed.sourceSitemap : undefined,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeStreamLine(stream: ReturnType<typeof createWriteStream>, line: string): Promise<void> {
  if (!stream.write(line)) {
    await once(stream, "drain");
  }
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
