import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLiveUrlDatasetCollector,
  openLiveUrlDataset,
} from "../dist/live-url-dataset.js";

test("live URL dataset hides persistence while preserving sitemap provenance", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-url-dataset-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const urlsPath = join(directory, "urls.txt");
  const detailsPath = join(directory, "url-details.jsonl");
  const collector = await createLiveUrlDatasetCollector({
    saveUrlsTo: urlsPath,
    saveUrlDetailsTo: detailsPath,
    replayable: true,
  });

  await collector.add({ url: "https://example.com/a", sourceSitemap: "https://example.com/sitemap-a.xml" });
  await collector.add({ url: "https://example.com/b", sourceSitemap: "https://example.com/sitemap-b.xml" });
  const dataset = await collector.finish();
  const records = [];

  for await (const record of dataset.records()) {
    records.push(record);
  }

  assert.equal(dataset.totalUrls, 2);
  assert.equal(dataset.replayable, true);
  assert.deepEqual(records, [
    { url: "https://example.com/a", sourceSitemap: "https://example.com/sitemap-a.xml" },
    { url: "https://example.com/b", sourceSitemap: "https://example.com/sitemap-b.xml" },
  ]);
  assert.equal(await readFile(urlsPath, "utf8"), "https://example.com/a\nhttps://example.com/b\n");
  assert.match(await readFile(detailsPath, "utf8"), /sitemap-a\.xml/);

  await dataset.close();
  await assert.rejects(async () => {
    for await (const _record of dataset.records()) {
      // A closed dataset must not expose its former storage adapter.
    }
  }, /closed/);
  assert.equal(await readFile(urlsPath, "utf8"), "https://example.com/a\nhttps://example.com/b\n");
});

test("live URL dataset opens text, JSON arrays, and JSONL through one interface", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-url-dataset-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtures = [
    [
      "urls.txt",
      "https://example.com/a\n# ignored\nhttps://example.com/b\n",
      [
        { url: "https://example.com/a", sourceSitemap: undefined },
        { url: "https://example.com/b", sourceSitemap: undefined },
      ],
    ],
    [
      "urls.json",
      JSON.stringify(["https://example.com/a", "https://example.com/b"]),
      [
        { url: "https://example.com/a", sourceSitemap: undefined },
        { url: "https://example.com/b", sourceSitemap: undefined },
      ],
    ],
    [
      "urls.jsonl",
      `${JSON.stringify({ url: "https://example.com/a", sourceSitemap: "sitemap.xml" })}\n`,
      [{ url: "https://example.com/a", sourceSitemap: "sitemap.xml" }],
    ],
  ];

  for (const [name, contents, expectedRecords] of fixtures) {
    const path = join(directory, name);
    await writeFile(path, contents);
    const dataset = await openLiveUrlDataset(path);
    const records = [];

    for await (const record of dataset.records()) {
      records.push(record);
    }

    assert.equal(dataset.totalUrls, expectedRecords.length);
    assert.equal(dataset.replayable, true);
    assert.deepEqual(records, expectedRecords);
    await dataset.close();
  }
});

test("live URL dataset rejects malformed JSON and JSONL records", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-url-dataset-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalidJsonPath = join(directory, "invalid.json");
  const invalidJsonlPath = join(directory, "invalid.jsonl");
  await writeFile(invalidJsonPath, JSON.stringify(["https://example.com/a", 42]));
  await writeFile(invalidJsonlPath, `${JSON.stringify({ url: 42 })}\n`);

  await assert.rejects(openLiveUrlDataset(invalidJsonPath), /array of URL strings/);
  await assert.rejects(openLiveUrlDataset(invalidJsonlPath), /string url field/);
});

test("live URL dataset exposes counts without requiring replay", async () => {
  const collector = await createLiveUrlDatasetCollector({ replayable: false });
  await collector.add({ url: "https://example.com/a", sourceSitemap: undefined });
  const dataset = await collector.finish();
  const records = [];

  for await (const record of dataset.records()) {
    records.push(record);
  }

  assert.equal(dataset.totalUrls, 1);
  assert.equal(dataset.replayable, false);
  assert.deepEqual(records, []);
  await dataset.close();
});
