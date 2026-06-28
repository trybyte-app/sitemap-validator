import type { SitemapLoadedSource, SitemapLoader } from "./types.js";
export interface MemorySitemapLoaderOptions {
    sources: ReadonlyMap<string, SitemapLoadedSource> | Readonly<Record<string, SitemapLoadedSource>>;
}
export declare function createMemorySitemapLoader(options: MemorySitemapLoaderOptions): SitemapLoader;
