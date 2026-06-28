import { join } from "node:path";
export { createMemorySitemapLoader } from "./memory-loader.js";
export function createLocalSitemapLoader(options) {
    const normalizedPrefix = options.publicUrlPrefix.endsWith("/") ? options.publicUrlPrefix : `${options.publicUrlPrefix}/`;
    return async ({ loc }) => {
        if (!loc.startsWith(normalizedPrefix)) {
            return null;
        }
        const relativePath = loc.slice(normalizedPrefix.length);
        if (relativePath.includes("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
            return null;
        }
        return {
            input: {
                path: join(options.localDirectory, relativePath),
            },
            sourceId: relativePath,
            sitemapLocation: loc,
            gzip: relativePath.endsWith(".gz"),
        };
    };
}
