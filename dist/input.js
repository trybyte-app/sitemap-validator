let inputAdapters = {};
export function setInputAdapters(adapters) {
    inputAdapters = {
        ...inputAdapters,
        ...adapters,
    };
}
export async function normalizeInput(input, options = {}) {
    if (typeof input === "object" && input !== null && "path" in input) {
        const sourceId = options.sourceId ?? input.sourceId ?? input.path;
        const gzip = options.gzip ?? input.gzip ?? input.path.endsWith(".gz");
        return {
            sourceId,
            gzip,
            chunks: readFileChunks(input.path),
        };
    }
    return {
        sourceId: options.sourceId ?? "inline",
        gzip: options.gzip ?? false,
        chunks: toChunkIterable(input),
    };
}
export async function* readableForXml(input) {
    const chunks = toByteChunks(input.chunks);
    if (!input.gzip) {
        yield* chunks;
        return;
    }
    yield* decompressGzip(chunks);
}
async function* readFileChunks(path) {
    if (!inputAdapters.readFileChunks) {
        throw new Error("File path sitemap input requires the Node.js entrypoint.");
    }
    yield* inputAdapters.readFileChunks(path);
}
function toChunkIterable(input) {
    if (typeof input === "string" || input instanceof Uint8Array || input instanceof ArrayBuffer) {
        return singleChunk(input);
    }
    if (isAsyncIterable(input)) {
        return input;
    }
    return iterableToAsync(input);
}
async function* singleChunk(chunk) {
    yield chunk;
}
async function* iterableToAsync(input) {
    yield* input;
}
async function* toByteChunks(chunks) {
    for await (const chunk of chunks) {
        yield toUint8Array(chunk);
    }
}
function toUint8Array(chunk) {
    if (typeof chunk === "string") {
        return new TextEncoder().encode(chunk);
    }
    if (chunk instanceof Uint8Array) {
        return chunk;
    }
    if (chunk instanceof ArrayBuffer) {
        return new Uint8Array(chunk);
    }
    if (ArrayBuffer.isView(chunk)) {
        return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    throw new TypeError("Sitemap input chunks must be strings, Uint8Array values, or ArrayBuffers.");
}
async function* decompressGzip(chunks) {
    const webStream = createDecompressionStream(chunks);
    if (webStream) {
        yield* webStream;
        return;
    }
    if (!inputAdapters.decompressGzip) {
        throw new Error("Gzip sitemap input requires DecompressionStream support or the Node.js entrypoint.");
    }
    yield* toByteChunks(inputAdapters.decompressGzip(chunks));
}
function createDecompressionStream(chunks) {
    const DecompressionStreamConstructor = globalThis.DecompressionStream;
    if (!DecompressionStreamConstructor) {
        return undefined;
    }
    const input = new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of chunks) {
                    controller.enqueue(chunk);
                }
                controller.close();
            }
            catch (error) {
                controller.error(error);
            }
        },
    });
    return streamToAsyncIterable(input.pipeThrough(new DecompressionStreamConstructor("gzip")));
}
async function* streamToAsyncIterable(stream) {
    const reader = stream.getReader();
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) {
                return;
            }
            yield result.value;
        }
    }
    finally {
        reader.releaseLock();
    }
}
function isAsyncIterable(value) {
    return typeof value === "object"
        && value !== null
        && Symbol.asyncIterator in value;
}
