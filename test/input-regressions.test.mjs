import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { validateSitemap } from "../dist/index.js";

test("gzip validation stops consuming input after the decompressed byte limit", async () => {
  let state = 0x12345678;
  const comment = Array.from({ length: 300_000 }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return String.fromCharCode(65 + ((state >>> 0) % 26));
  }).join("");
  const compressed = gzipSync(
    Buffer.from(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><!--${comment}--><url><loc>https://example.com/</loc></url></urlset>`),
  );
  let yieldedChunks = 0;

  async function* compressedChunks() {
    for (let offset = 0; offset < compressed.byteLength; offset += 64) {
      yieldedChunks += 1;
      yield compressed.subarray(offset, offset + 64);
    }
  }

  const result = await validateSitemap(compressedChunks(), {
    gzip: true,
    limits: { maxUncompressedBytes: 1_024 },
  });

  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SITEMAP_FILE_TOO_LARGE"));
  assert.ok(
    yieldedChunks < Math.ceil(compressed.byteLength / 64),
    `consumed all ${yieldedChunks} compressed chunks after the limit was exceeded`,
  );
});
