import type { SitemapInput } from "./types.js";

type InputChunk = string | Uint8Array | ArrayBuffer;

interface InputAdapters {
  readFileChunks?: ((path: string) => AsyncIterable<unknown>) | undefined;
  decompressGzip?: ((chunks: AsyncIterable<Uint8Array>) => AsyncIterable<unknown>) | undefined;
}

let inputAdapters: InputAdapters = {};

export interface NormalizedInput {
  sourceId: string;
  gzip: boolean;
  chunks: AsyncIterable<unknown>;
}

export function setInputAdapters(adapters: InputAdapters): void {
  inputAdapters = {
    ...inputAdapters,
    ...adapters,
  };
}

export async function normalizeInput(
  input: SitemapInput,
  options: { sourceId?: string | undefined; gzip?: boolean | undefined } = {},
): Promise<NormalizedInput> {
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

export async function* readableForXml(input: NormalizedInput): AsyncIterable<Uint8Array> {
  const chunks = toByteChunks(input.chunks);

  if (!input.gzip) {
    yield* chunks;
    return;
  }

  yield* decompressGzip(chunks);
}

async function* readFileChunks(path: string): AsyncIterable<unknown> {
  if (!inputAdapters.readFileChunks) {
    throw new Error("File path sitemap input requires the Node.js entrypoint.");
  }

  yield* inputAdapters.readFileChunks(path);
}

function toChunkIterable(input: Exclude<SitemapInput, { path: string }>): AsyncIterable<unknown> {
  if (typeof input === "string" || input instanceof Uint8Array || input instanceof ArrayBuffer) {
    return singleChunk(input);
  }

  if (isAsyncIterable(input)) {
    return input;
  }

  return iterableToAsync(input);
}

async function* singleChunk(chunk: InputChunk): AsyncIterable<InputChunk> {
  yield chunk;
}

async function* iterableToAsync(input: Iterable<unknown>): AsyncIterable<unknown> {
  yield* input;
}

async function* toByteChunks(chunks: AsyncIterable<unknown>): AsyncIterable<Uint8Array> {
  for await (const chunk of chunks) {
    yield toUint8Array(chunk);
  }
}

function toUint8Array(chunk: unknown): Uint8Array {
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

async function* decompressGzip(chunks: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
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

function createDecompressionStream(chunks: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> | undefined {
  const DecompressionStreamConstructor = (globalThis as {
    DecompressionStream?: new (format: "gzip") => TransformStream<Uint8Array, Uint8Array>;
  }).DecompressionStream;

  if (!DecompressionStreamConstructor) {
    return undefined;
  }

  const input = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return streamToAsyncIterable(input.pipeThrough(new DecompressionStreamConstructor("gzip")));
}

async function* streamToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object"
    && value !== null
    && Symbol.asyncIterator in value;
}
