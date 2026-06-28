import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { setInputAdapters } from "./input.js";
setInputAdapters({
    readFileChunks(path) {
        return createReadStream(path);
    },
    decompressGzip(chunks) {
        return Readable.from(chunks).pipe(createGunzip());
    },
});
