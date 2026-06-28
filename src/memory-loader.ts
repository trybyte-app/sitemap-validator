import type { SitemapLoadedSource, SitemapLoader } from "./types.js";

export interface MemorySitemapLoaderOptions {
  sources: ReadonlyMap<string, SitemapLoadedSource> | Readonly<Record<string, SitemapLoadedSource>>;
}

export function createMemorySitemapLoader(options: MemorySitemapLoaderOptions): SitemapLoader {
  const sources = options.sources instanceof Map ? options.sources : new Map(Object.entries(options.sources));

  return async ({ loc }) => {
    return sources.get(loc) ?? null;
  };
}
