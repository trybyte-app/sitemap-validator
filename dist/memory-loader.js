export function createMemorySitemapLoader(options) {
    const sources = options.sources instanceof Map ? options.sources : new Map(Object.entries(options.sources));
    return async ({ loc }) => {
        return sources.get(loc) ?? null;
    };
}
