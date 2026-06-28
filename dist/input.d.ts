import type { SitemapInput } from "./types.js";
interface InputAdapters {
    readFileChunks?: ((path: string) => AsyncIterable<unknown>) | undefined;
    decompressGzip?: ((chunks: AsyncIterable<Uint8Array>) => AsyncIterable<unknown>) | undefined;
}
export interface NormalizedInput {
    sourceId: string;
    gzip: boolean;
    chunks: AsyncIterable<unknown>;
}
export declare function setInputAdapters(adapters: InputAdapters): void;
export declare function normalizeInput(input: SitemapInput, options?: {
    sourceId?: string | undefined;
    gzip?: boolean | undefined;
}): Promise<NormalizedInput>;
export declare function readableForXml(input: NormalizedInput): AsyncIterable<Uint8Array>;
export {};
