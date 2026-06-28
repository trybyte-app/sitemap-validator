export { createMemorySitemapLoader } from "./memory-loader.js";
export type { MemorySitemapLoaderOptions } from "./memory-loader.js";
import type { SitemapLoader } from "./types.js";
export interface LocalSitemapLoaderOptions {
    publicUrlPrefix: string;
    localDirectory: string;
}
export declare function createLocalSitemapLoader(options: LocalSitemapLoaderOptions): SitemapLoader;
