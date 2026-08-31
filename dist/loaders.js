import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
export { createMemorySitemapLoader } from "./memory-loader.js";
export function createLocalSitemapLoader(options) {
    const normalizedPrefix = options.publicUrlPrefix.endsWith("/") ? options.publicUrlPrefix : `${options.publicUrlPrefix}/`;
    const localDirectory = resolve(options.localDirectory);
    return async ({ loc }) => {
        if (!loc.startsWith(normalizedPrefix)) {
            return null;
        }
        const relativeReference = loc.slice(normalizedPrefix.length);
        const pathEnd = relativeReference.search(/[?#]/u);
        const encodedPath = pathEnd === -1 ? relativeReference : relativeReference.slice(0, pathEnd);
        const decodedSegments = [];
        for (const encodedSegment of encodedPath.split("/")) {
            let segment;
            try {
                segment = decodeURIComponent(encodedSegment);
            }
            catch {
                return null;
            }
            if (segment === ".." || segment.includes("/") || segment.includes("\\")) {
                return null;
            }
            decodedSegments.push(segment);
        }
        const relativePath = decodedSegments.join("/");
        if (relativePath.startsWith("/") ||
            isAbsolute(relativePath) ||
            win32.isAbsolute(relativePath)) {
            return null;
        }
        const localPath = resolve(localDirectory, relativePath);
        const pathFromRoot = relative(localDirectory, localPath);
        if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
            return null;
        }
        return {
            input: {
                path: localPath,
            },
            sourceId: relativePath,
            sitemapLocation: loc,
            gzip: relativePath.endsWith(".gz"),
        };
    };
}
