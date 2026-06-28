import { normalizeInput, readableForXml } from "./input.js";
import { validateLocRule, validateSingleHostRule } from "./loc-rules.js";
import { getRuleDefinition } from "./rules.js";
import { isGoogleSupportedHreflangTag, isIso3166Alpha2RegionCode, isIso639Alpha2LanguageCode, isIso639Alpha3LanguageCode, isValidBcp47LanguageTag, } from "./standards.js";
import { createSaxesParserAdapter } from "./xml-parser.js";
import { DEFAULT_LIMITS } from "./types.js";
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1";
const NEWS_NS = "http://www.google.com/schemas/sitemap-news/0.9";
const VIDEO_NS = "http://www.google.com/schemas/sitemap-video/1.1";
const PAGEMAP_NS = "http://www.google.com/schemas/sitemap-pagemap/1.0";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const CHANGEFREQ_VALUES = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
const URL_CORE_CHILD_ORDER = new Map([
    ["loc", 0],
    ["lastmod", 1],
    ["changefreq", 2],
    ["priority", 3],
]);
const SITEMAP_INDEX_CORE_CHILD_ORDER = new Map([
    ["loc", 0],
    ["lastmod", 1],
]);
const URL_CHILD_ORDER_EXTENSION_START = 4;
const DEPRECATED_IMAGE_TAGS = new Set(["caption", "geo_location", "title", "license"]);
const KNOWN_IMAGE_TAGS = new Set(["image", "loc", ...DEPRECATED_IMAGE_TAGS]);
const IMAGE_CHILD_ORDER = new Map([
    ["loc", 0],
    ["caption", 1],
    ["geo_location", 2],
    ["title", 3],
    ["license", 4],
]);
const DEPRECATED_NEWS_TAGS = new Set(["access", "genres", "keywords", "stock_tickers"]);
const KNOWN_NEWS_TAGS = new Set(["news", "publication", "name", "language", "publication_date", "title", ...DEPRECATED_NEWS_TAGS]);
const NEWS_CHILD_ORDER = new Map([
    ["publication", 0],
    ["access", 1],
    ["genres", 2],
    ["publication_date", 3],
    ["title", 4],
    ["keywords", 5],
    ["stock_tickers", 6],
]);
const NEWS_PUBLICATION_CHILD_ORDER = new Map([
    ["name", 0],
    ["language", 1],
]);
const VIDEO_REPEATABLE_TAGS = new Set(["tag", "content_segment_loc", "id", "price"]);
const DEPRECATED_VIDEO_TAGS = new Set(["category", "content_segment_loc", "gallery_loc", "id", "price", "tvshow"]);
const DEPRECATED_VIDEO_PLAYER_LOC_ATTRIBUTES = new Set(["autoplay", "allow_embed"]);
const VIDEO_ID_TYPE_VALUES = new Set(["tms:series", "tms:program", "rovi:series", "rovi:program", "freebase", "url"]);
const VIDEO_PLATFORM_VALUES = new Set(["web", "mobile", "tv"]);
const VIDEO_PRICE_TYPE_VALUES = new Set(["purchase", "PURCHASE", "rent", "RENT"]);
const VIDEO_PRICE_RESOLUTION_VALUES = new Set(["sd", "SD", "hd", "HD"]);
const VIDEO_TVSHOW_VIDEO_TYPE_VALUES = new Set(["full", "preview", "clip", "interview", "news", "other"]);
const VIDEO_ALLOWED_PROTOCOLS = ["http:", "https:", "ftp:"];
const VIDEO_TVSHOW_TAGS = new Set(["show_title", "video_type", "episode_title", "season_number", "episode_number", "premier_date"]);
const VIDEO_CHILD_ORDER = new Map([
    ["thumbnail_loc", 0],
    ["title", 1],
    ["description", 2],
    ["content_loc", 3],
    ["player_loc", 4],
    ["duration", 5],
    ["expiration_date", 6],
    ["rating", 7],
    ["content_segment_loc", 8],
    ["view_count", 9],
    ["publication_date", 10],
    ["tag", 11],
    ["category", 12],
    ["family_friendly", 13],
    ["restriction", 14],
    ["gallery_loc", 15],
    ["price", 16],
    ["requires_subscription", 17],
    ["uploader", 18],
    ["tvshow", 19],
    ["platform", 20],
    ["live", 21],
    ["id", 22],
]);
const KNOWN_VIDEO_TAGS = new Set([
    "video",
    "thumbnail_loc",
    "title",
    "description",
    "content_loc",
    "content_segment_loc",
    "player_loc",
    "duration",
    "expiration_date",
    "rating",
    "view_count",
    "publication_date",
    "family_friendly",
    "restriction",
    "platform",
    "requires_subscription",
    "uploader",
    "live",
    "tag",
    "id",
    "show_title",
    "video_type",
    "episode_title",
    "season_number",
    "episode_number",
    "premier_date",
    ...DEPRECATED_VIDEO_TAGS,
]);
const KNOWN_PAGEMAP_TAGS = new Set(["PageMap", "Template", "DataObject", "Attribute"]);
const PAGEMAP_CHILD_ORDER = new Map([
    ["Template", 0],
    ["DataObject", 1],
]);
export async function validateSitemap(input, options = {}) {
    const diagnostics = [];
    let summary;
    for await (const event of validateSitemapEvents(input, options)) {
        if (event.type === "diagnostic") {
            diagnostics.push(event.diagnostic);
        }
        if (event.type === "summary") {
            summary = event.summary;
        }
    }
    if (!summary) {
        throw new Error("Validation ended without a summary event.");
    }
    return {
        valid: summary.valid,
        sourceId: summary.sourceId,
        diagnostics,
        summary,
    };
}
export async function* validateSitemapEvents(input, options = {}) {
    const normalized = await normalizeInput(input, options);
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const state = createState(normalized.sourceId, options, limits);
    const parser = createParser(state);
    const stream = readableForXml(normalized);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let stopParsing = false;
    emit(state, { type: "source:start", sourceId: state.sourceId });
    yield* drain(state);
    try {
        for await (const chunk of stream) {
            options.signal?.throwIfAborted();
            state.bytes += chunk.byteLength;
            emit(state, { type: "source:bytes", sourceId: state.sourceId, bytes: state.bytes });
            if (state.bytes > limits.maxUncompressedBytes) {
                addDiagnostic(state, {
                    code: "SITEMAP_FILE_TOO_LARGE",
                    severity: "error",
                    source: "sitemaps.org",
                    message: `Sitemap exceeds the ${limits.maxUncompressedBytes} byte uncompressed size limit.`,
                    spec: "https://www.sitemaps.org/protocol.html",
                });
                stopParsing = true;
                break;
            }
            let decoded;
            try {
                decoded = decoder.decode(chunk, { stream: true });
            }
            catch {
                addDiagnostic(state, {
                    code: "XML_INVALID_UTF8",
                    severity: "error",
                    source: "xml",
                    message: "Sitemap XML input must be valid UTF-8.",
                    spec: "https://www.w3.org/TR/xml/",
                });
                stopParsing = true;
                break;
            }
            parser.write(decoded);
            yield* drain(state);
        }
        if (!stopParsing) {
            try {
                const tail = decoder.decode();
                if (tail.length > 0) {
                    parser.write(tail);
                }
            }
            catch {
                addDiagnostic(state, {
                    code: "XML_INVALID_UTF8",
                    severity: "error",
                    source: "xml",
                    message: "Sitemap XML input must be valid UTF-8.",
                    spec: "https://www.w3.org/TR/xml/",
                });
                stopParsing = true;
            }
        }
        if (!stopParsing) {
            parser.close();
        }
    }
    catch (error) {
        addDiagnostic(state, {
            code: "XML_PARSE_ERROR",
            severity: "error",
            source: "xml",
            message: error instanceof Error ? error.message : "XML parsing failed.",
            spec: "https://www.w3.org/TR/xml/",
        });
    }
    if (!state.rootSeen) {
        addDiagnostic(state, {
            code: "MISSING_ROOT_ELEMENT",
            severity: "error",
            source: "xml",
            message: "XML document does not contain a root element.",
            spec: "https://www.w3.org/TR/xml/",
        });
    }
    validateRootCardinality(state);
    const summary = createSummary(state);
    emit(state, { type: "source:finish", sourceId: state.sourceId, summary });
    emit(state, { type: "summary", sourceId: state.sourceId, summary });
    yield* drain(state);
}
function createState(sourceId, options, limits) {
    let sitemapLocation;
    if (options.sitemapLocation) {
        try {
            sitemapLocation = new URL(options.sitemapLocation);
        }
        catch {
            // Reported through URL checks only when relevant.
        }
    }
    return {
        sourceId,
        options,
        limits,
        pending: [],
        diagnosticCounts: {
            errors: 0,
            warnings: 0,
            info: 0,
        },
        stack: [],
        rootType: undefined,
        rootSeen: false,
        urls: 0,
        sitemaps: 0,
        sitemapLocations: [],
        bytes: 0,
        currentUrl: undefined,
        currentSitemap: undefined,
        currentImage: undefined,
        currentNews: undefined,
        currentVideo: undefined,
        currentVideoPrice: undefined,
        currentPageMap: undefined,
        currentPageMapAttribute: undefined,
        newsEntries: 0,
        sitemapLocation,
        urlsetHost: undefined,
        sitemapIndexHost: undefined,
    };
}
function createParser(state) {
    const parser = createSaxesParserAdapter({
        onXmlDeclaration(declaration) {
            if (declaration.version && declaration.version !== "1.0") {
                addDiagnostic(state, {
                    code: "XML_VERSION_UNSUPPORTED",
                    severity: "error",
                    source: "xml",
                    message: "Sitemap XML validation supports XML 1.0 documents.",
                    location: currentLocation(state, parser),
                    spec: "https://www.w3.org/TR/xml/",
                });
            }
            if (declaration.encoding && !isUtf8Encoding(declaration.encoding)) {
                addDiagnostic(state, {
                    code: "XML_ENCODING_NOT_UTF8",
                    severity: "error",
                    source: "xml",
                    message: "Sitemap XML must be UTF-8 encoded.",
                    location: currentLocation(state, parser),
                    spec: "https://www.sitemaps.org/protocol.html",
                });
            }
        },
        onError(error) {
            addDiagnostic(state, {
                code: "XML_PARSE_ERROR",
                severity: "error",
                source: "xml",
                message: error.message,
                location: currentLocation(state, parser),
                spec: "https://www.w3.org/TR/xml/",
            });
        },
        onOpenElement(baseElement) {
            const path = `${state.stack.at(-1)?.path ?? ""}/${baseElement.local || baseElement.name}`;
            const element = { ...baseElement, path };
            state.stack.push({ ...element, text: shouldCollectText(element) ? "" : undefined });
            if (!state.rootSeen) {
                validateRoot(state, element, parser);
            }
            else {
                validateElementPlacement(state, element, parser);
            }
            handleOpenElement(state, element, baseElement, parser);
        },
        onText(text) {
            const current = state.stack.at(-1);
            if (current?.text !== undefined) {
                current.text += text;
            }
        },
        onCdata(text) {
            const current = state.stack.at(-1);
            if (current?.text !== undefined) {
                current.text += text;
            }
        },
        onDoctype() {
            addDiagnostic(state, {
                code: "XML_DOCTYPE_NOT_ALLOWED",
                severity: "error",
                source: "xml",
                message: "DOCTYPE declarations are not allowed in sitemap XML validation because they can introduce unsafe entity behavior.",
                location: currentLocation(state, parser),
                spec: "https://www.w3.org/TR/xml/",
            });
        },
        onCloseElement() {
            const item = state.stack.pop();
            if (!item) {
                return;
            }
            handleCloseElement(state, item, parser);
        },
    });
    return parser;
}
function validateRoot(state, element, parser) {
    state.rootSeen = true;
    if (element.uri !== SITEMAP_NS) {
        addDiagnostic(state, {
            code: "INVALID_SITEMAP_NAMESPACE",
            severity: "error",
            source: "sitemaps.org",
            message: "Root element must use the sitemap namespace http://www.sitemaps.org/schemas/sitemap/0.9.",
            location: currentLocation(state, parser),
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    if (element.local === "urlset") {
        state.rootType = "urlset";
        return;
    }
    if (element.local === "sitemapindex") {
        state.rootType = "sitemapindex";
        return;
    }
    addDiagnostic(state, {
        code: "INVALID_ROOT_ELEMENT",
        severity: "error",
        source: "sitemaps.org",
        message: "Root element must be either urlset or sitemapindex.",
        location: currentLocation(state, parser),
        spec: "https://www.sitemaps.org/protocol.html",
    });
}
function validateRootCardinality(state) {
    if (state.rootType === "urlset" && state.urls === 0) {
        addDiagnostic(state, {
            code: "SITEMAP_URL_ENTRY_REQUIRED",
            severity: "error",
            source: "sitemaps.org",
            message: "A urlset sitemap must contain at least one url entry.",
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    if (state.rootType === "sitemapindex" && state.sitemaps === 0) {
        addDiagnostic(state, {
            code: "SITEMAP_INDEX_ENTRY_REQUIRED",
            severity: "error",
            source: "sitemaps.org",
            message: "A sitemapindex document must contain at least one sitemap entry.",
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
}
function validateElementPlacement(state, element, parser) {
    const parent = state.stack.at(-2);
    if (!parent) {
        return;
    }
    if (element.uri === SITEMAP_NS) {
        if (state.rootType === "urlset" && !isAllowedUrlsetElement(parent.local, element.local)) {
            addDiagnostic(state, unexpectedElement(element.path, parser, state));
        }
        if (state.rootType === "sitemapindex" && !isAllowedSitemapIndexElement(parent.local, element.local)) {
            addDiagnostic(state, unexpectedElement(element.path, parser, state));
        }
    }
    if (isExtensionNamespace(element.uri) && !state.currentUrl) {
        addDiagnostic(state, {
            code: "EXTENSION_OUTSIDE_URL",
            severity: "error",
            source: "google",
            message: "Sitemap extension elements must be nested inside a url entry.",
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/combine-sitemap-extensions",
        });
    }
    if (isExtensionNamespace(element.uri) && state.currentUrl) {
        validateExtensionPlacement(state, element, parser);
    }
}
function validateExtensionPlacement(state, element, parser) {
    const parent = state.stack.at(-2);
    const grandparent = state.stack.at(-3);
    if (!parent) {
        return;
    }
    if (element.uri === IMAGE_NS) {
        const valid = element.local === "image"
            ? parent.uri === SITEMAP_NS && parent.local === "url"
            : parent.uri === IMAGE_NS && parent.local === "image";
        if (!valid) {
            addDiagnostic(state, {
                code: "GOOGLE_IMAGE_ELEMENT_PLACEMENT_INVALID",
                severity: "error",
                source: "google",
                message: "image:image must be a direct child of url, and image child fields must be direct children of image:image.",
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps",
            });
        }
    }
    if (element.uri === NEWS_NS) {
        const valid = isValidNewsPlacement(element.local, parent, grandparent);
        if (!valid) {
            addDiagnostic(state, {
                code: "GOOGLE_NEWS_ELEMENT_PLACEMENT_INVALID",
                severity: "error",
                source: "google",
                message: "news:news must be a direct child of url, with publication fields in the documented news hierarchy.",
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
            });
        }
    }
    if (element.uri === VIDEO_NS) {
        const valid = element.local === "video"
            ? parent.uri === SITEMAP_NS && parent.local === "url"
            : isValidVideoPlacement(element.local, parent);
        if (!valid) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_ELEMENT_PLACEMENT_INVALID",
                severity: "error",
                source: "google",
                message: "video:video must be a direct child of url, and video child fields must be direct children of video:video.",
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
            });
        }
    }
    if (element.uri === PAGEMAP_NS) {
        const valid = element.local === "PageMap"
            ? parent.uri === SITEMAP_NS && parent.local === "url"
            : isValidPageMapPlacement(element.local, parent, grandparent);
        if (!valid) {
            addDiagnostic(state, {
                code: "GOOGLE_PAGEMAP_ELEMENT_PLACEMENT_INVALID",
                severity: "error",
                source: "google",
                message: "PageMap must be a direct child of url, with Template/DataObject/Attribute in the PageMap schema hierarchy.",
                location: currentLocation(state, parser),
                spec: "https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd",
            });
        }
    }
    if (element.uri === XHTML_NS) {
        const valid = element.local === "link" && parent.uri === SITEMAP_NS && parent.local === "url";
        if (!valid) {
            addDiagnostic(state, {
                code: "GOOGLE_HREFLANG_ELEMENT_PLACEMENT_INVALID",
                severity: "error",
                source: "google",
                message: "hreflang sitemap annotations must use xhtml:link as a direct child of url.",
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
            });
        }
    }
}
function isValidVideoPlacement(local, parent) {
    if (parent.uri !== VIDEO_NS) {
        return false;
    }
    if (parent.local === "video") {
        return !VIDEO_TVSHOW_TAGS.has(local);
    }
    return parent.local === "tvshow" && VIDEO_TVSHOW_TAGS.has(local);
}
function isValidPageMapPlacement(local, parent, grandparent) {
    if (parent.uri !== PAGEMAP_NS) {
        return false;
    }
    if (local === "Template" || local === "DataObject") {
        return parent.local === "PageMap";
    }
    if (local === "Attribute") {
        return parent.local === "DataObject" && grandparent?.uri === PAGEMAP_NS && grandparent.local === "PageMap";
    }
    return parent.local === "PageMap" || parent.local === "DataObject";
}
function isValidNewsPlacement(local, parent, grandparent) {
    if (local === "news") {
        return parent.uri === SITEMAP_NS && parent.local === "url";
    }
    if (local === "publication"
        || local === "access"
        || local === "genres"
        || local === "publication_date"
        || local === "title"
        || local === "keywords"
        || local === "stock_tickers") {
        return parent.uri === NEWS_NS && parent.local === "news";
    }
    if (local === "name" || local === "language") {
        return parent.uri === NEWS_NS && parent.local === "publication" && grandparent?.uri === NEWS_NS && grandparent.local === "news";
    }
    return parent.uri === NEWS_NS && (parent.local === "news" || parent.local === "publication");
}
function validateSitemapProtocolChild(state, element, parser) {
    const parent = state.stack.at(-2);
    if (!parent || element.uri !== SITEMAP_NS || parent.uri !== SITEMAP_NS) {
        return;
    }
    if (state.currentUrl && parent.local === "url") {
        validateOrderedSingleChild(state, state.currentUrl.seenCoreChildren, URL_CORE_CHILD_ORDER, element, parser);
    }
    if (state.currentSitemap && parent.local === "sitemap") {
        validateOrderedSingleChild(state, state.currentSitemap.seenCoreChildren, SITEMAP_INDEX_CORE_CHILD_ORDER, element, parser);
    }
}
function validateOrderedSingleChild(state, seen, orderMap, element, parser) {
    const order = orderMap.get(element.local);
    if (order === undefined) {
        return;
    }
    if (seen.has(element.local)) {
        addDiagnostic(state, {
            code: "SITEMAP_ELEMENT_DUPLICATE",
            severity: "error",
            source: "sitemaps.org",
            message: `Sitemap protocol element ${element.local} can appear only once in its parent entry.`,
            location: { ...currentLocation(state, parser), path: element.path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
        return;
    }
    const currentParent = state.currentUrl ?? state.currentSitemap;
    if (currentParent && order < currentParent.lastCoreChildOrder) {
        addDiagnostic(state, {
            code: "SITEMAP_ELEMENT_OUT_OF_ORDER",
            severity: "error",
            source: "sitemaps.org",
            message: `Sitemap protocol element ${element.local} appears outside the schema order.`,
            location: { ...currentLocation(state, parser), path: element.path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    if (currentParent && order > currentParent.lastCoreChildOrder) {
        currentParent.lastCoreChildOrder = order;
    }
    seen.add(element.local);
}
function validateExtensionChildOrder(state, entry, orderMap, code, element, parser) {
    const order = orderMap.get(element.local);
    if (order === undefined) {
        return;
    }
    if (order < entry.lastChildOrder) {
        const definition = getRuleDefinition(code);
        addDiagnostic(state, {
            code,
            severity: "error",
            source: "google",
            message: `${element.local} appears outside the extension schema order.`,
            location: { ...currentLocation(state, parser), path: element.path },
            spec: definition?.spec,
        });
    }
    if (order > entry.lastChildOrder) {
        entry.lastChildOrder = order;
    }
}
function handleOpenElement(state, element, node, parser) {
    if (element.uri === SITEMAP_NS && state.rootType === "urlset" && element.local === "url") {
        state.currentUrl = {
            seenCoreChildren: new Set(),
            lastCoreChildOrder: -1,
            imageCount: 0,
            newsCount: 0,
            hreflangs: [],
        };
    }
    if (element.uri === SITEMAP_NS && state.rootType === "sitemapindex" && element.local === "sitemap") {
        state.currentSitemap = {
            seenCoreChildren: new Set(),
            lastCoreChildOrder: -1,
        };
    }
    validateSitemapProtocolChild(state, element, parser);
    validateUnexpectedAttributes(state, element, node, parser);
    if (isCustomUrlExtensionElement(state, element)) {
        markUrlExtensionOrder(state, element, parser);
    }
    if (element.uri === IMAGE_NS && element.local === "image" && state.currentUrl) {
        markUrlExtensionOrder(state, element, parser);
        state.currentUrl.imageCount += 1;
        state.currentImage = { hasLoc: false, locCount: 0, seenChildren: new Set(), lastChildOrder: -1, path: element.path };
        if (state.currentUrl.imageCount > state.limits.maxImagesPerUrl) {
            addDiagnostic(state, {
                code: "GOOGLE_IMAGE_LIMIT_EXCEEDED",
                severity: "error",
                source: "google",
                message: `A url entry must not contain more than ${state.limits.maxImagesPerUrl} image:image entries.`,
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps",
            });
        }
    }
    if (element.uri === IMAGE_NS && DEPRECATED_IMAGE_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_IMAGE_TAG_DEPRECATED",
            severity: "warning",
            source: "google",
            message: `image:${element.local} has been removed from Google's image sitemap documentation.`,
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps",
        });
    }
    if (element.uri === IMAGE_NS && !KNOWN_IMAGE_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_IMAGE_UNKNOWN_TAG",
            severity: "warning",
            source: "google",
            message: `image:${element.local} is not a recognized Google image sitemap tag.`,
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps",
        });
    }
    if (element.uri === IMAGE_NS && state.currentImage && element.local !== "image") {
        validateImageChildCardinality(state, element, parser);
    }
    if (element.uri === NEWS_NS && element.local === "news" && state.currentUrl) {
        state.currentUrl.newsCount += 1;
        state.newsEntries += 1;
        state.currentNews = {
            path: element.path,
            seenChildren: new Set(),
            seenPublicationChildren: new Set(),
            publicationCount: 0,
            lastChildOrder: -1,
            lastPublicationChildOrder: -1,
        };
        markUrlExtensionOrder(state, element, parser);
        if (state.currentUrl.newsCount > 1) {
            addDiagnostic(state, {
                code: "GOOGLE_NEWS_ENTRY_DUPLICATE",
                severity: "error",
                source: "google",
                message: "Each url entry can contain only one news:news element.",
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
            });
        }
        if (state.newsEntries > state.limits.maxNewsEntriesPerSitemap) {
            addDiagnostic(state, {
                code: "GOOGLE_NEWS_ENTRY_LIMIT_EXCEEDED",
                severity: "error",
                source: "google",
                message: `A news sitemap must not contain more than ${state.limits.maxNewsEntriesPerSitemap} news entries.`,
                location: currentLocation(state, parser),
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
            });
        }
    }
    if (element.uri === NEWS_NS && state.currentNews && element.local !== "news") {
        validateNewsChildCardinality(state, element, parser);
    }
    if (element.uri === NEWS_NS && !KNOWN_NEWS_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_UNKNOWN_TAG",
            severity: "warning",
            source: "google",
            message: `news:${element.local} is not a recognized Google news sitemap tag.`,
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
        });
    }
    if (element.uri === NEWS_NS && DEPRECATED_NEWS_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_TAG_DEPRECATED",
            severity: "warning",
            source: "google",
            message: `news:${element.local} is present in the legacy Google News XSD but is not part of the current Google News sitemap documentation.`,
            location: currentLocation(state, parser),
            spec: "https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd",
        });
    }
    if (element.uri === VIDEO_NS && element.local === "video" && state.currentUrl) {
        markUrlExtensionOrder(state, element, parser);
        state.currentVideo = {
            path: element.path,
            seenChildren: new Set(),
            lastChildOrder: -1,
            restrictionRelationship: undefined,
            platformRelationship: undefined,
            uploaderInfo: undefined,
            contentSegmentLocCount: 0,
            tvShowPath: undefined,
            tvShowShowTitle: undefined,
            tvShowVideoType: undefined,
            tvShowSeasonNumber: undefined,
            tvShowEpisodeNumber: undefined,
            tvShowPremierDate: undefined,
            tagCount: 0,
        };
    }
    if (element.uri === VIDEO_NS && state.currentVideo && element.local !== "video") {
        validateVideoChildCardinality(state, element, node, parser);
    }
    if (element.uri === VIDEO_NS && DEPRECATED_VIDEO_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_TAG_DEPRECATED",
            severity: "warning",
            source: "google",
            message: `video:${element.local} has been removed from Google's video sitemap documentation.`,
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (element.uri === VIDEO_NS && !KNOWN_VIDEO_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_UNKNOWN_TAG",
            severity: "warning",
            source: "google",
            message: `video:${element.local} is not a recognized Google video sitemap tag.`,
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (element.uri === XHTML_NS && element.local === "link" && state.currentUrl) {
        markUrlExtensionOrder(state, element, parser);
        validateHreflangLink(state, node, parser);
    }
    if (element.uri === VIDEO_NS && element.local === "restriction" && state.currentVideo) {
        state.currentVideo.restrictionRelationship = getAttribute(node.attributes, "relationship");
    }
    if (element.uri === VIDEO_NS && element.local === "platform" && state.currentVideo) {
        state.currentVideo.platformRelationship = getAttribute(node.attributes, "relationship");
    }
    if (element.uri === VIDEO_NS && element.local === "uploader" && state.currentVideo) {
        state.currentVideo.uploaderInfo = getAttribute(node.attributes, "info");
    }
    if (element.uri === VIDEO_NS && element.local === "content_segment_loc" && state.currentVideo) {
        state.currentVideo.contentSegmentLocCount += 1;
        validateVideoContentSegmentAttributes(state, node, element.path, parser);
    }
    if (element.uri === VIDEO_NS && element.local === "id" && state.currentVideo) {
        validateVideoIdAttributes(state, node, element.path, parser);
    }
    if (element.uri === VIDEO_NS && element.local === "price" && state.currentVideo) {
        state.currentVideoPrice = {
            path: element.path,
            currency: getAttribute(node.attributes, "currency"),
            type: getAttribute(node.attributes, "type"),
            resolution: getAttribute(node.attributes, "resolution"),
        };
    }
    if (element.uri === VIDEO_NS && element.local === "tvshow" && state.currentVideo) {
        state.currentVideo.tvShowPath = element.path;
    }
    if (element.uri === PAGEMAP_NS && element.local === "PageMap" && state.currentUrl) {
        markUrlExtensionOrder(state, element, parser);
        state.currentPageMap = { path: element.path, seenChildren: new Set(), lastChildOrder: -1 };
    }
    if (element.uri === PAGEMAP_NS && state.currentPageMap && element.local !== "PageMap") {
        validatePageMapChildCardinality(state, element, parser);
    }
    if (element.uri === PAGEMAP_NS && !KNOWN_PAGEMAP_TAGS.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_PAGEMAP_UNKNOWN_TAG",
            severity: "warning",
            source: "google",
            message: `pagemap:${element.local} is not a recognized Google PageMap sitemap tag.`,
            location: currentLocation(state, parser),
            spec: "https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd",
        });
    }
    if (element.uri === PAGEMAP_NS) {
        validatePageMapRequiredAttributes(state, element, node, parser);
    }
    if (element.uri === PAGEMAP_NS && element.local === "Attribute" && state.currentPageMap) {
        state.currentPageMapAttribute = {
            path: element.path,
            value: getAttribute(node.attributes, "value"),
        };
    }
}
function markUrlExtensionOrder(state, element, parser) {
    if (!state.currentUrl) {
        return;
    }
    if (state.currentUrl.lastCoreChildOrder > URL_CHILD_ORDER_EXTENSION_START) {
        return;
    }
    if (state.currentUrl.lastCoreChildOrder < URL_CHILD_ORDER_EXTENSION_START) {
        state.currentUrl.lastCoreChildOrder = URL_CHILD_ORDER_EXTENSION_START;
    }
    const parent = state.stack.at(-2);
    if (parent?.uri === SITEMAP_NS && parent.local === "url" && !state.currentUrl.seenCoreChildren.has("loc")) {
        addDiagnostic(state, {
            code: "SITEMAP_ELEMENT_OUT_OF_ORDER",
            severity: "error",
            source: "sitemaps.org",
            message: "Sitemap extension elements should appear after the required url loc element and core sitemap metadata.",
            location: { ...currentLocation(state, parser), path: element.path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
}
function validateUnexpectedAttributes(state, element, node, parser) {
    for (const attribute of Object.values(node.attributes)) {
        if (isSchemaUtilityAttribute(attribute)) {
            continue;
        }
        if (element.uri === SITEMAP_NS) {
            addUnexpectedAttributeDiagnostic(state, "SITEMAP_ATTRIBUTE_UNEXPECTED", "sitemaps.org", element, attribute, parser);
            continue;
        }
        if (element.uri === IMAGE_NS) {
            addUnexpectedAttributeDiagnostic(state, "GOOGLE_IMAGE_ATTRIBUTE_UNEXPECTED", "google", element, attribute, parser);
            continue;
        }
        if (element.uri === NEWS_NS) {
            addUnexpectedAttributeDiagnostic(state, "GOOGLE_NEWS_ATTRIBUTE_UNEXPECTED", "google", element, attribute, parser);
            continue;
        }
        if (element.uri === VIDEO_NS && !isAllowedVideoAttribute(element.local, attribute.local)) {
            addUnexpectedAttributeDiagnostic(state, "GOOGLE_VIDEO_ATTRIBUTE_UNEXPECTED", "google", element, attribute, parser);
            continue;
        }
        if (element.uri === PAGEMAP_NS && !isAllowedPageMapAttribute(element.local, attribute.local)) {
            addUnexpectedAttributeDiagnostic(state, "GOOGLE_PAGEMAP_ATTRIBUTE_UNEXPECTED", "google", element, attribute, parser);
            continue;
        }
        if (element.uri === XHTML_NS && element.local === "link" && !isAllowedHreflangAttribute(attribute.local)) {
            addUnexpectedAttributeDiagnostic(state, "GOOGLE_HREFLANG_ATTRIBUTE_UNEXPECTED", "google", element, attribute, parser);
        }
    }
}
function addUnexpectedAttributeDiagnostic(state, code, source, element, attribute, parser) {
    addDiagnostic(state, {
        code,
        severity: "error",
        source,
        message: `Attribute ${attribute.name} is not allowed on this sitemap element.`,
        location: { ...currentLocation(state, parser), path: `${element.path}/@${attribute.name}` },
    });
}
function isSchemaUtilityAttribute(attribute) {
    return attribute.uri === XMLNS_NS
        || attribute.name === "xmlns"
        || attribute.name.startsWith("xmlns:")
        || attribute.uri === XSI_NS;
}
function isAllowedVideoAttribute(elementLocal, attributeLocal) {
    if (elementLocal === "player_loc")
        return attributeLocal === "allow_embed" || attributeLocal === "autoplay";
    if (elementLocal === "restriction")
        return attributeLocal === "relationship";
    if (elementLocal === "platform")
        return attributeLocal === "relationship";
    if (elementLocal === "uploader")
        return attributeLocal === "info";
    if (elementLocal === "gallery_loc")
        return attributeLocal === "title";
    if (elementLocal === "content_segment_loc")
        return attributeLocal === "duration";
    if (elementLocal === "id")
        return attributeLocal === "type";
    if (elementLocal === "price")
        return attributeLocal === "currency" || attributeLocal === "type" || attributeLocal === "resolution";
    return false;
}
function isAllowedPageMapAttribute(elementLocal, attributeLocal) {
    if (elementLocal === "Template")
        return attributeLocal === "src";
    if (elementLocal === "DataObject")
        return attributeLocal === "type" || attributeLocal === "id";
    if (elementLocal === "Attribute")
        return attributeLocal === "name" || attributeLocal === "value";
    return false;
}
function shouldCollectText(element) {
    if (element.uri === SITEMAP_NS) {
        return element.local === "loc"
            || element.local === "lastmod"
            || element.local === "changefreq"
            || element.local === "priority";
    }
    if (element.uri === IMAGE_NS) {
        return element.local === "loc" || element.local === "license";
    }
    if (element.uri === NEWS_NS) {
        return element.local === "name"
            || element.local === "language"
            || element.local === "access"
            || element.local === "genres"
            || element.local === "publication_date"
            || element.local === "title"
            || element.local === "keywords"
            || element.local === "stock_tickers";
    }
    if (element.uri === VIDEO_NS) {
        return element.local === "thumbnail_loc"
            || element.local === "title"
            || element.local === "description"
            || element.local === "content_loc"
            || element.local === "content_segment_loc"
            || element.local === "player_loc"
            || element.local === "duration"
            || element.local === "expiration_date"
            || element.local === "rating"
            || element.local === "view_count"
            || element.local === "publication_date"
            || element.local === "tag"
            || element.local === "category"
            || element.local === "family_friendly"
            || element.local === "restriction"
            || element.local === "gallery_loc"
            || element.local === "price"
            || element.local === "requires_subscription"
            || element.local === "uploader"
            || element.local === "platform"
            || element.local === "live"
            || element.local === "id"
            || VIDEO_TVSHOW_TAGS.has(element.local);
    }
    if (element.uri === PAGEMAP_NS) {
        return element.local === "Attribute";
    }
    return false;
}
function isAllowedHreflangAttribute(attributeLocal) {
    return attributeLocal === "rel" || attributeLocal === "hreflang" || attributeLocal === "href";
}
function isCustomUrlExtensionElement(state, element) {
    const parent = state.stack.at(-2);
    return Boolean(state.currentUrl
        && parent?.uri === SITEMAP_NS
        && parent.local === "url"
        && element.uri !== ""
        && element.uri !== SITEMAP_NS
        && !isExtensionNamespace(element.uri));
}
function validateImageChildCardinality(state, element, parser) {
    const parent = state.stack.at(-2);
    const image = state.currentImage;
    if (!parent || !image || parent.uri !== IMAGE_NS || parent.local !== "image" || !KNOWN_IMAGE_TAGS.has(element.local)) {
        return;
    }
    validateExtensionChildOrder(state, image, IMAGE_CHILD_ORDER, "GOOGLE_IMAGE_ELEMENT_OUT_OF_ORDER", element, parser);
    if (element.local !== "loc" && image.seenChildren.has(element.local)) {
        addDiagnostic(state, {
            code: "GOOGLE_IMAGE_ELEMENT_DUPLICATE",
            severity: "error",
            source: "google",
            message: `image:${element.local} can appear only once in an image:image entry.`,
            location: { ...currentLocation(state, parser), path: element.path },
            spec: "https://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd",
        });
    }
    image.seenChildren.add(element.local);
}
function validateNewsChildCardinality(state, element, parser) {
    const parent = state.stack.at(-2);
    const news = state.currentNews;
    if (!parent || !news) {
        return;
    }
    if (parent.uri === NEWS_NS && parent.local === "news") {
        validateExtensionChildOrder(state, news, NEWS_CHILD_ORDER, "GOOGLE_NEWS_ELEMENT_OUT_OF_ORDER", element, parser);
        if (element.local === "publication") {
            news.publicationCount += 1;
        }
        if (element.local === "publication"
            || element.local === "access"
            || element.local === "genres"
            || element.local === "publication_date"
            || element.local === "title"
            || element.local === "keywords"
            || element.local === "stock_tickers") {
            if (news.seenChildren.has(element.local)) {
                addDiagnostic(state, {
                    code: "GOOGLE_NEWS_ELEMENT_DUPLICATE",
                    severity: "error",
                    source: "google",
                    message: `news:${element.local} can appear only once in a news:news entry.`,
                    location: { ...currentLocation(state, parser), path: element.path },
                    spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
                });
            }
            news.seenChildren.add(element.local);
        }
    }
    if (parent.uri === NEWS_NS && parent.local === "publication" && (element.local === "name" || element.local === "language")) {
        validateExtensionChildOrder(state, {
            get lastChildOrder() {
                return news.lastPublicationChildOrder;
            },
            set lastChildOrder(value) {
                news.lastPublicationChildOrder = value;
            },
        }, NEWS_PUBLICATION_CHILD_ORDER, "GOOGLE_NEWS_ELEMENT_OUT_OF_ORDER", element, parser);
        if (news.seenPublicationChildren.has(element.local)) {
            addDiagnostic(state, {
                code: "GOOGLE_NEWS_ELEMENT_DUPLICATE",
                severity: "error",
                source: "google",
                message: `news:${element.local} can appear only once in news:publication.`,
                location: { ...currentLocation(state, parser), path: element.path },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
            });
        }
        news.seenPublicationChildren.add(element.local);
    }
}
function validateVideoChildCardinality(state, element, node, parser) {
    const parent = state.stack.at(-2);
    const video = state.currentVideo;
    if (!parent || !video || parent.uri !== VIDEO_NS || parent.local !== "video" || !KNOWN_VIDEO_TAGS.has(element.local)) {
        return;
    }
    validateExtensionChildOrder(state, video, VIDEO_CHILD_ORDER, "GOOGLE_VIDEO_ELEMENT_OUT_OF_ORDER", element, parser);
    if (!VIDEO_REPEATABLE_TAGS.has(element.local)) {
        if (video.seenChildren.has(element.local)) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_ELEMENT_DUPLICATE",
                severity: "error",
                source: "google",
                message: `video:${element.local} can appear only once in a video:video entry.`,
                location: { ...currentLocation(state, parser), path: element.path },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
            });
        }
        video.seenChildren.add(element.local);
    }
    if (element.local === "player_loc") {
        for (const attribute of Object.values(node.attributes)) {
            if (DEPRECATED_VIDEO_PLAYER_LOC_ATTRIBUTES.has(attribute.local)) {
                addDiagnostic(state, {
                    code: "GOOGLE_VIDEO_TAG_DEPRECATED",
                    severity: "warning",
                    source: "google",
                    message: `video:player_loc @${attribute.local} has been removed from Google's video sitemap documentation.`,
                    location: { ...currentLocation(state, parser), path: `${element.path}/@${attribute.local}` },
                    spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
                });
            }
        }
        const allowEmbed = getAttribute(node.attributes, "allow_embed");
        if (allowEmbed !== undefined && !isVideoYesNo(allowEmbed)) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_PLAYER_ALLOW_EMBED_INVALID",
                severity: "error",
                source: "google",
                message: "video:player_loc @allow_embed must be yes or no, using a case variant allowed by the video sitemap XSD.",
                location: { ...currentLocation(state, parser), path: `${element.path}/@allow_embed` },
                spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
            });
        }
    }
}
function validatePageMapChildCardinality(state, element, parser) {
    const parent = state.stack.at(-2);
    const pageMap = state.currentPageMap;
    if (!parent || !pageMap) {
        return;
    }
    if (parent.uri === PAGEMAP_NS && parent.local === "PageMap") {
        validateExtensionChildOrder(state, pageMap, PAGEMAP_CHILD_ORDER, "GOOGLE_PAGEMAP_ELEMENT_OUT_OF_ORDER", element, parser);
        if (element.local === "Template") {
            if (pageMap.seenChildren.has(element.local)) {
                addDiagnostic(state, {
                    code: "GOOGLE_PAGEMAP_ELEMENT_DUPLICATE",
                    severity: "error",
                    source: "google",
                    message: "pagemap:Template can appear only once in pagemap:PageMap.",
                    location: { ...currentLocation(state, parser), path: element.path },
                    spec: "https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd",
                });
            }
            pageMap.seenChildren.add(element.local);
        }
    }
}
function validatePageMapRequiredAttributes(state, element, node, parser) {
    const requiredAttribute = requiredPageMapAttribute(element.local);
    if (!requiredAttribute || getAttribute(node.attributes, requiredAttribute)) {
        return;
    }
    addDiagnostic(state, {
        code: "GOOGLE_PAGEMAP_REQUIRED_ATTRIBUTE",
        severity: "error",
        source: "google",
        message: `pagemap:${element.local} must include @${requiredAttribute}.`,
        location: { ...currentLocation(state, parser), path: `${element.path}/@${requiredAttribute}` },
        spec: "https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd",
    });
}
function requiredPageMapAttribute(elementLocal) {
    if (elementLocal === "Template")
        return "src";
    if (elementLocal === "DataObject")
        return "type";
    if (elementLocal === "Attribute")
        return "name";
    return undefined;
}
function validateVideoContentSegmentAttributes(state, node, path, parser) {
    const duration = getAttribute(node.attributes, "duration");
    if (duration === undefined) {
        return;
    }
    const seconds = Number(duration);
    if (!/^\d+$/.test(duration) || !Number.isInteger(seconds) || seconds < 0 || seconds > 28_800) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_CONTENT_SEGMENT_DURATION_INVALID",
            severity: "error",
            source: "google",
            message: "video:content_segment_loc @duration must be a non-negative integer no greater than 28800.",
            location: { ...currentLocation(state, parser), path: `${path}/@duration` },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
}
function validateVideoIdAttributes(state, node, path, parser) {
    const type = getAttribute(node.attributes, "type");
    if (!type || !VIDEO_ID_TYPE_VALUES.has(type)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_ID_TYPE_INVALID",
            severity: "error",
            source: "google",
            message: "video:id must include a type attribute with one of the values defined by the video sitemap XSD.",
            location: { ...currentLocation(state, parser), path: `${path}/@type` },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
}
function handleCloseElement(state, item, parser) {
    const text = item.text?.trim() ?? "";
    if (state.currentUrl && item.uri === SITEMAP_NS) {
        if (item.local === "loc")
            state.currentUrl.loc = text;
        if (item.local === "lastmod")
            state.currentUrl.lastmod = text;
        if (item.local === "changefreq")
            state.currentUrl.changefreq = text;
        if (item.local === "priority")
            state.currentUrl.priority = text;
    }
    if (state.currentSitemap && item.uri === SITEMAP_NS) {
        if (item.local === "loc")
            state.currentSitemap.loc = text;
        if (item.local === "lastmod")
            state.currentSitemap.lastmod = text;
    }
    if (state.currentImage && item.uri === IMAGE_NS && item.local === "loc") {
        state.currentImage.locCount += 1;
        state.currentImage.hasLoc = true;
        validateLoc(state, text, item.path, parser, "google", { enforceSitemapLocation: false });
        if (state.currentImage.locCount > 1) {
            addDiagnostic(state, {
                code: "GOOGLE_IMAGE_LOC_DUPLICATE",
                severity: "error",
                source: "google",
                message: "image:image can contain only one image:loc element.",
                location: { ...currentLocation(state, parser), path: item.path },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps",
            });
        }
    }
    if (state.currentImage && item.uri === IMAGE_NS && item.local === "license") {
        validateLoc(state, text, item.path, parser, "google", { enforceSitemapLocation: false });
    }
    if (state.currentNews && item.uri === NEWS_NS) {
        if (item.local === "name")
            state.currentNews.publicationName = text;
        if (item.local === "language")
            state.currentNews.publicationLanguage = text;
        if (item.local === "access")
            state.currentNews.access = text;
        if (item.local === "genres")
            state.currentNews.genres = text;
        if (item.local === "publication_date")
            state.currentNews.publicationDate = text;
        if (item.local === "title")
            state.currentNews.title = text;
        if (item.local === "keywords")
            state.currentNews.keywords = text;
        if (item.local === "stock_tickers")
            state.currentNews.stockTickers = text;
    }
    if (state.currentVideo && item.uri === VIDEO_NS) {
        if (item.local === "thumbnail_loc")
            state.currentVideo.thumbnailLoc = text;
        if (item.local === "title")
            state.currentVideo.title = text;
        if (item.local === "description")
            state.currentVideo.description = text;
        if (item.local === "content_loc")
            state.currentVideo.contentLoc = text;
        if (item.local === "player_loc")
            state.currentVideo.playerLoc = text;
        if (item.local === "content_segment_loc") {
            validateLoc(state, text, item.path, parser, "google", {
                enforceSitemapLocation: false,
                allowedProtocols: VIDEO_ALLOWED_PROTOCOLS,
            });
        }
        if (item.local === "duration")
            state.currentVideo.duration = text;
        if (item.local === "expiration_date")
            state.currentVideo.expirationDate = text;
        if (item.local === "publication_date")
            state.currentVideo.publicationDate = text;
        if (item.local === "rating")
            state.currentVideo.rating = text;
        if (item.local === "view_count")
            state.currentVideo.viewCount = text;
        if (item.local === "family_friendly")
            state.currentVideo.familyFriendly = text;
        if (item.local === "live")
            state.currentVideo.live = text;
        if (item.local === "requires_subscription")
            state.currentVideo.requiresSubscription = text;
        if (item.local === "restriction")
            state.currentVideo.restrictionValue = text;
        if (item.local === "gallery_loc")
            state.currentVideo.galleryLoc = text;
        if (item.local === "category")
            state.currentVideo.category = text;
        if (item.local === "platform")
            state.currentVideo.platformValue = text;
        if (item.local === "uploader")
            state.currentVideo.uploader = text;
        if (item.local === "tag")
            state.currentVideo.tagCount += 1;
        if (item.local === "show_title")
            state.currentVideo.tvShowShowTitle = text;
        if (item.local === "video_type")
            state.currentVideo.tvShowVideoType = text;
        if (item.local === "season_number")
            state.currentVideo.tvShowSeasonNumber = text;
        if (item.local === "episode_number")
            state.currentVideo.tvShowEpisodeNumber = text;
        if (item.local === "premier_date")
            state.currentVideo.tvShowPremierDate = text;
        if (item.local === "price" && state.currentVideoPrice) {
            validateVideoPriceEntry(state, { ...state.currentVideoPrice, value: text }, parser);
            state.currentVideoPrice = undefined;
        }
    }
    if (item.uri === IMAGE_NS && item.local === "image" && state.currentImage) {
        if (!state.currentImage.hasLoc) {
            addDiagnostic(state, {
                code: "GOOGLE_IMAGE_LOC_REQUIRED",
                severity: "error",
                source: "google",
                message: "image:image must contain image:loc.",
                location: { ...currentLocation(state, parser), path: state.currentImage.path },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps",
            });
        }
        state.currentImage = undefined;
    }
    if (item.uri === NEWS_NS && item.local === "news" && state.currentNews) {
        validateNewsEntry(state, state.currentNews, parser);
        state.currentNews = undefined;
    }
    if (item.uri === VIDEO_NS && item.local === "video" && state.currentVideo) {
        validateVideoEntry(state, state.currentVideo, parser);
        state.currentVideo = undefined;
    }
    if (item.uri === PAGEMAP_NS && item.local === "Attribute" && state.currentPageMapAttribute) {
        validatePageMapAttributeEntry(state, state.currentPageMapAttribute, text, parser);
        state.currentPageMapAttribute = undefined;
    }
    if (item.uri === PAGEMAP_NS && item.local === "PageMap" && state.currentPageMap) {
        state.currentPageMap = undefined;
    }
    if (item.uri === SITEMAP_NS && item.local === "url" && state.currentUrl) {
        finishUrlEntry(state, state.currentUrl, item.path, parser);
        state.currentUrl = undefined;
    }
    if (item.uri === SITEMAP_NS && item.local === "sitemap" && state.currentSitemap) {
        finishSitemapEntry(state, state.currentSitemap, item.path, parser);
        state.currentSitemap = undefined;
    }
}
function finishUrlEntry(state, entry, path, parser) {
    state.urls += 1;
    if (state.urls > state.limits.maxUrlsPerSitemap) {
        addDiagnostic(state, {
            code: "SITEMAP_URL_LIMIT_EXCEEDED",
            severity: "error",
            source: "sitemaps.org",
            message: `A sitemap must not contain more than ${state.limits.maxUrlsPerSitemap} url entries.`,
            location: { ...currentLocation(state, parser), path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    if (!entry.loc) {
        addDiagnostic(state, {
            code: "SITEMAP_LOC_REQUIRED",
            severity: "error",
            source: "sitemaps.org",
            message: "url entries must contain loc.",
            location: { ...currentLocation(state, parser), path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    else {
        const url = validateLoc(state, entry.loc, `${path}/loc`, parser, "sitemaps.org", { enforceSitemapLocation: true });
        validateSingleHost(state, url, `${path}/loc`, parser, "urlset");
    }
    validateOptionalSitemapFields(state, entry, path, parser);
    validateHreflangs(state, entry, path, parser);
    emit(state, {
        type: "sitemap:url",
        sourceId: state.sourceId,
        count: state.urls,
        loc: entry.loc,
        hreflangs: toPublicHreflangs(entry.hreflangs),
    });
}
function finishSitemapEntry(state, entry, path, parser) {
    state.sitemaps += 1;
    if (state.sitemaps > state.limits.maxSitemapsPerIndex) {
        addDiagnostic(state, {
            code: "SITEMAP_INDEX_LIMIT_EXCEEDED",
            severity: "error",
            source: "sitemaps.org",
            message: `A sitemap index must not contain more than ${state.limits.maxSitemapsPerIndex} sitemap entries.`,
            location: { ...currentLocation(state, parser), path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    if (!entry.loc) {
        addDiagnostic(state, {
            code: "SITEMAP_INDEX_LOC_REQUIRED",
            severity: "error",
            source: "sitemaps.org",
            message: "sitemap entries must contain loc.",
            location: { ...currentLocation(state, parser), path },
            spec: "https://www.sitemaps.org/protocol.html",
        });
    }
    else {
        const url = validateLoc(state, entry.loc, `${path}/loc`, parser, "sitemaps.org", { enforceSitemapLocation: true });
        validateSingleHost(state, url, `${path}/loc`, parser, "sitemapindex");
        state.sitemapLocations.push(entry.loc);
    }
    if (entry.lastmod !== undefined) {
        validateLastmod(state, entry.lastmod, `${path}/lastmod`, parser);
    }
    emit(state, { type: "sitemap:entry", sourceId: state.sourceId, count: state.sitemaps, loc: entry.loc });
}
function validateOptionalSitemapFields(state, entry, path, parser) {
    if (entry.lastmod !== undefined) {
        validateLastmod(state, entry.lastmod, `${path}/lastmod`, parser);
    }
    if (entry.changefreq !== undefined) {
        if (!CHANGEFREQ_VALUES.has(entry.changefreq)) {
            addDiagnostic(state, {
                code: "INVALID_CHANGEFREQ",
                severity: "error",
                source: "sitemaps.org",
                message: "changefreq must be one of always, hourly, daily, weekly, monthly, yearly, or never.",
                location: { ...currentLocation(state, parser), path: `${path}/changefreq` },
                spec: "https://www.sitemaps.org/protocol.html",
            });
        }
        addDiagnostic(state, {
            code: "GOOGLE_IGNORES_CHANGEFREQ",
            severity: "warning",
            source: "google",
            message: "changefreq is valid in the sitemap protocol, but Google ignores it.",
            location: { ...currentLocation(state, parser), path: `${path}/changefreq` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
        });
    }
    if (entry.priority !== undefined) {
        const priority = Number(entry.priority);
        if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(entry.priority) || Number.isNaN(priority) || priority < 0 || priority > 1) {
            addDiagnostic(state, {
                code: "INVALID_PRIORITY",
                severity: "error",
                source: "sitemaps.org",
                message: "priority must be a decimal number between 0.0 and 1.0.",
                location: { ...currentLocation(state, parser), path: `${path}/priority` },
                spec: "https://www.sitemaps.org/protocol.html",
            });
        }
        addDiagnostic(state, {
            code: "GOOGLE_IGNORES_PRIORITY",
            severity: "warning",
            source: "google",
            message: "priority is valid in the sitemap protocol, but Google ignores it.",
            location: { ...currentLocation(state, parser), path: `${path}/priority` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
        });
    }
}
function validateLastmod(state, value, path, parser) {
    validateDateTimeValue(state, value, path, parser, "INVALID_LASTMOD", "sitemaps.org", "lastmod must use a complete W3C date (YYYY-MM-DD) or datetime format.", "https://www.sitemaps.org/protocol.html");
}
function validateGoogleDateTime(state, value, path, parser, code, message, spec, options = {}) {
    validateDateTimeValue(state, value, path, parser, code, "google", message, spec, options);
}
function validateDateTimeValue(state, value, path, parser, code, source, message, spec, options = {}) {
    if (!isValidCompleteW3cDateOrDateTime(value, options)) {
        addDiagnostic(state, {
            code,
            severity: "error",
            source,
            message,
            location: { ...currentLocation(state, parser), path },
            spec,
        });
    }
}
function isValidCompleteW3cDateOrDateTime(value, options = {}) {
    const completeDate = /^(\d{4})-(\d{2})-(\d{2})$/;
    const completeDateTime = options.requireTimeSeconds
        ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
        : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
    const match = completeDate.exec(value) ?? completeDateTime.exec(value);
    if (!match || Number.isNaN(Date.parse(value))) {
        return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] === undefined ? 0 : Number(match[4]);
    const minute = match[5] === undefined ? 0 : Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
        return false;
    }
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day >= 1 && day <= maxDay;
}
function validateLoc(state, value, path, parser, source, options) {
    return validateLocRule(state, locRuleContext(state, parser), value, path, source, options);
}
function validateSingleHost(state, url, path, parser, kind) {
    validateSingleHostRule(state, locRuleContext(state, parser), url, path, kind);
}
function locRuleContext(state, parser) {
    return {
        addDiagnostic(diagnostic) {
            addDiagnostic(state, diagnostic);
        },
        location(path) {
            return { ...currentLocation(state, parser), path };
        },
    };
}
function validateHreflangs(state, entry, path, parser) {
    if (entry.hreflangs.length === 0) {
        return;
    }
    const seen = new Set();
    let hasSelfReference = false;
    const entryLocKey = entry.loc ? normalizeUrlKey(entry.loc) : undefined;
    for (const hreflang of entry.hreflangs) {
        if (hreflang.href && entryLocKey && normalizeUrlKey(hreflang.href) === entryLocKey) {
            hasSelfReference = true;
        }
        if (!hreflang.hreflang) {
            continue;
        }
        const normalized = hreflang.hreflang.toLowerCase();
        if (seen.has(normalized)) {
            addDiagnostic(state, {
                code: "GOOGLE_HREFLANG_DUPLICATE",
                severity: "error",
                source: "google",
                message: "Each url entry should not repeat the same hreflang value.",
                location: { ...currentLocation(state, parser), path: hreflang.path },
                spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
            });
        }
        seen.add(normalized);
    }
    if (entry.loc && !hasSelfReference) {
        addDiagnostic(state, {
            code: "GOOGLE_HREFLANG_SELF_REFERENCE_MISSING",
            severity: "error",
            source: "google",
            message: "Each url entry with hreflang annotations must include an alternate link for its own loc URL.",
            location: { ...currentLocation(state, parser), path },
            spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
        });
    }
}
function normalizeUrlKey(value) {
    try {
        return new URL(value).href;
    }
    catch {
        return value;
    }
}
function toPublicHreflangs(entries) {
    const alternates = entries
        .filter((entry) => typeof entry.hreflang === "string" && typeof entry.href === "string")
        .map((entry) => ({
        hreflang: entry.hreflang,
        href: entry.href,
    }));
    return alternates.length > 0 ? alternates : undefined;
}
function validateNewsEntry(state, entry, parser) {
    const required = [
        ["publicationName", "news:publication/news:name"],
        ["publicationLanguage", "news:publication/news:language"],
        ["publicationDate", "news:publication_date"],
        ["title", "news:title"],
    ];
    for (const [key, label] of required) {
        if (!entry[key]) {
            addDiagnostic(state, {
                code: "GOOGLE_NEWS_REQUIRED_FIELD",
                severity: "error",
                source: "google",
                message: `news:news must contain ${label}.`,
                location: { ...currentLocation(state, parser), path: entry.path },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
            });
        }
    }
    if (entry.publicationDate !== undefined) {
        validateGoogleDateTime(state, entry.publicationDate, `${entry.path}/news:publication_date`, parser, "GOOGLE_NEWS_PUBLICATION_DATE_INVALID", "news:publication_date must use W3C date or datetime format.", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap");
        const publishedAt = Date.parse(entry.publicationDate);
        const twoDaysMs = 2 * 24 * 60 * 60 * 1_000;
        if (!Number.isNaN(publishedAt) && publishedAt < Date.now() - twoDaysMs) {
            addDiagnostic(state, {
                code: "GOOGLE_NEWS_PUBLICATION_DATE_STALE",
                severity: "warning",
                source: "google",
                message: "Google News sitemap metadata should only be included for articles created in the last two days.",
                location: { ...currentLocation(state, parser), path: `${entry.path}/news:publication_date` },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
            });
        }
    }
    if (entry.publicationLanguage !== undefined && !isValidGoogleNewsLanguage(entry.publicationLanguage)) {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_LANGUAGE_INVALID",
            severity: "error",
            source: "google",
            message: "news:language should be a valid-looking ISO language code.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/news:publication/news:language` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
        });
    }
    if (entry.title !== undefined && entry.title.length > 110) {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_TITLE_TOO_LONG",
            severity: "warning",
            source: "google",
            message: "news:title should be concise and no more than 110 characters.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/news:title` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap",
        });
    }
    if (entry.access !== undefined && entry.access !== "Subscription" && entry.access !== "Registration") {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_ACCESS_INVALID",
            severity: "error",
            source: "google",
            message: "news:access must be Subscription or Registration when the legacy XSD field is used.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/news:access` },
            spec: "https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd",
        });
    }
    if (entry.genres !== undefined && !isValidGoogleNewsGenres(entry.genres)) {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_GENRES_INVALID",
            severity: "error",
            source: "google",
            message: "news:genres must contain comma-separated values from the Google News XSD genre list.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/news:genres` },
            spec: "https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd",
        });
    }
    if (entry.stockTickers !== undefined && !isValidGoogleNewsStockTickers(entry.stockTickers)) {
        addDiagnostic(state, {
            code: "GOOGLE_NEWS_STOCK_TICKERS_INVALID",
            severity: "error",
            source: "google",
            message: "news:stock_tickers must contain up to five comma-separated exchange:ticker values.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/news:stock_tickers` },
            spec: "https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd",
        });
    }
}
function validateVideoEntry(state, entry, parser) {
    const required = [
        ["thumbnailLoc", "video:thumbnail_loc"],
        ["title", "video:title"],
        ["description", "video:description"],
    ];
    for (const [key, label] of required) {
        if (!entry[key]) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_REQUIRED_FIELD",
                severity: "error",
                source: "google",
                message: `video:video must contain ${label}.`,
                location: { ...currentLocation(state, parser), path: entry.path },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
            });
        }
    }
    if (!entry.contentLoc && !entry.playerLoc) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_LOCATION_REQUIRED",
            severity: "error",
            source: "google",
            message: "video:video must contain either video:content_loc or video:player_loc.",
            location: { ...currentLocation(state, parser), path: entry.path },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.contentLoc !== undefined && entry.contentLoc === state.currentUrl?.loc) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_CONTENT_LOC_EQUALS_PAGE_LOC",
            severity: "error",
            source: "google",
            message: "video:content_loc must not be the same URL as the parent page loc.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:content_loc` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.contentLoc !== undefined && hasUnsupportedVideoContentLocFormat(entry.contentLoc)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_CONTENT_LOC_FORMAT_UNSUPPORTED",
            severity: "error",
            source: "google",
            message: "video:content_loc should point directly to a supported video file, not an HTML page or Flash file.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:content_loc` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.contentSegmentLocCount > 0 && !entry.playerLoc) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_CONTENT_SEGMENT_REQUIRES_PLAYER_LOC",
            severity: "error",
            source: "google",
            message: "video:content_segment_loc can be used only in conjunction with video:player_loc.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:content_segment_loc` },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
    if (entry.playerLoc !== undefined && entry.playerLoc === state.currentUrl?.loc) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_PLAYER_LOC_EQUALS_PAGE_LOC",
            severity: "error",
            source: "google",
            message: "video:player_loc must not be the same URL as the parent page loc.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:player_loc` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.title !== undefined && entry.title.length > 100) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_TITLE_TOO_LONG",
            severity: "error",
            source: "google",
            message: "video:title must be no more than 100 characters.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:title` },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
    if (entry.description !== undefined && entry.description.length > 2_048) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_DESCRIPTION_TOO_LONG",
            severity: "error",
            source: "google",
            message: "video:description must be no more than 2048 characters.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:description` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.duration !== undefined) {
        const duration = Number(entry.duration);
        if (!/^(?:[1-9]\d*)$/.test(entry.duration) || !Number.isInteger(duration) || duration > 28_800) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_DURATION_INVALID",
                severity: "error",
                source: "google",
                message: "video:duration must be an integer number of seconds from 1 to 28800.",
                location: { ...currentLocation(state, parser), path: `${entry.path}/video:duration` },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
            });
        }
    }
    if (entry.category !== undefined && entry.category.length > 256) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_CATEGORY_TOO_LONG",
            severity: "error",
            source: "google",
            message: "video:category must be no more than 256 characters when the legacy XSD field is used.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:category` },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
    if (entry.rating !== undefined) {
        const rating = Number(entry.rating);
        if (entry.rating.length === 0 || Number.isNaN(rating) || rating < 0 || rating > 5) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_RATING_INVALID",
                severity: "error",
                source: "google",
                message: "video:rating must be a number from 0.0 to 5.0.",
                location: { ...currentLocation(state, parser), path: `${entry.path}/video:rating` },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
            });
        }
    }
    if (entry.viewCount !== undefined && (!/^\d+$/.test(entry.viewCount) || Number(entry.viewCount) < 0)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_VIEW_COUNT_INVALID",
            severity: "error",
            source: "google",
            message: "video:view_count must be a non-negative integer.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:view_count` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.familyFriendly !== undefined && !isVideoYesNo(entry.familyFriendly)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_FAMILY_FRIENDLY_INVALID",
            severity: "error",
            source: "google",
            message: "video:family_friendly must be yes or no, using a case variant allowed by the video sitemap XSD.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:family_friendly` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.live !== undefined && !isVideoYesNo(entry.live)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_LIVE_INVALID",
            severity: "error",
            source: "google",
            message: "video:live must be yes or no, using a case variant allowed by the video sitemap XSD.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:live` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.requiresSubscription !== undefined && !isVideoYesNo(entry.requiresSubscription)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_REQUIRES_SUBSCRIPTION_INVALID",
            severity: "error",
            source: "google",
            message: "video:requires_subscription must be yes or no, using a case variant allowed by the video sitemap XSD.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:requires_subscription` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (!entry.restrictionRelationship && entry.restrictionValue !== undefined) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_RESTRICTION_RELATIONSHIP_INVALID",
            severity: "error",
            source: "google",
            message: "video:restriction must include a relationship attribute.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:restriction/@relationship` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.restrictionRelationship && entry.restrictionRelationship !== "allow" && entry.restrictionRelationship !== "deny") {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_RESTRICTION_RELATIONSHIP_INVALID",
            severity: "error",
            source: "google",
            message: "video:restriction relationship must be allow or deny.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:restriction/@relationship` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.restrictionValue !== undefined && !isSpaceSeparatedIso3166List(entry.restrictionValue)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_RESTRICTION_COUNTRY_INVALID",
            severity: "error",
            source: "google",
            message: "video:restriction must contain a space-delimited list of ISO 3166 alpha-2 country codes.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:restriction` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (!entry.platformRelationship && entry.platformValue !== undefined) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_PLATFORM_RELATIONSHIP_INVALID",
            severity: "error",
            source: "google",
            message: "video:platform must include a relationship attribute.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:platform/@relationship` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.platformRelationship && entry.platformRelationship !== "allow" && entry.platformRelationship !== "deny") {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_PLATFORM_RELATIONSHIP_INVALID",
            severity: "error",
            source: "google",
            message: "video:platform relationship must be allow or deny.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:platform/@relationship` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.platformValue !== undefined && !isSpaceSeparatedVideoPlatformList(entry.platformValue)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_PLATFORM_VALUE_INVALID",
            severity: "error",
            source: "google",
            message: "video:platform must contain web, mobile, tv, or a space-delimited combination of those values.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:platform` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.uploader !== undefined && entry.uploader.length > 255) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_UPLOADER_TOO_LONG",
            severity: "error",
            source: "google",
            message: "video:uploader must be no more than 255 characters.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:uploader` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    if (entry.uploaderInfo !== undefined) {
        validateLoc(state, entry.uploaderInfo, `${entry.path}/video:uploader/@info`, parser, "google", { enforceSitemapLocation: false });
        if (state.currentUrl?.loc && !hasSameHostname(entry.uploaderInfo, state.currentUrl.loc)) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_UPLOADER_INFO_DOMAIN_INVALID",
                severity: "error",
                source: "google",
                message: "video:uploader info must be on the same domain as the parent page loc.",
                location: { ...currentLocation(state, parser), path: `${entry.path}/video:uploader/@info` },
                spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
            });
        }
    }
    if (entry.tagCount > 32) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_TAG_LIMIT_EXCEEDED",
            severity: "error",
            source: "google",
            message: "video:video must not contain more than 32 video:tag elements.",
            location: { ...currentLocation(state, parser), path: `${entry.path}/video:tag` },
            spec: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps",
        });
    }
    validateVideoTvShow(state, entry, parser);
    if (entry.expirationDate !== undefined) {
        validateGoogleDateTime(state, entry.expirationDate, `${entry.path}/video:expiration_date`, parser, "GOOGLE_VIDEO_EXPIRATION_DATE_INVALID", "video:expiration_date must use W3C date or datetime format; datetime values must include seconds and a timezone.", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps", { requireTimeSeconds: true });
    }
    if (entry.publicationDate !== undefined) {
        validateGoogleDateTime(state, entry.publicationDate, `${entry.path}/video:publication_date`, parser, "GOOGLE_VIDEO_PUBLICATION_DATE_INVALID", "video:publication_date must use W3C date or datetime format; datetime values must include seconds and a timezone.", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps", { requireTimeSeconds: true });
    }
    if (entry.thumbnailLoc !== undefined) {
        validateLoc(state, entry.thumbnailLoc, `${entry.path}/video:thumbnail_loc`, parser, "google", {
            enforceSitemapLocation: false,
            allowedProtocols: VIDEO_ALLOWED_PROTOCOLS,
        });
    }
    if (entry.contentLoc !== undefined) {
        validateLoc(state, entry.contentLoc, `${entry.path}/video:content_loc`, parser, "google", {
            enforceSitemapLocation: false,
            allowedProtocols: VIDEO_ALLOWED_PROTOCOLS,
        });
    }
    if (entry.playerLoc !== undefined) {
        validateLoc(state, entry.playerLoc, `${entry.path}/video:player_loc`, parser, "google", {
            enforceSitemapLocation: false,
            allowedProtocols: VIDEO_ALLOWED_PROTOCOLS,
        });
    }
    if (entry.galleryLoc !== undefined) {
        validateLoc(state, entry.galleryLoc, `${entry.path}/video:gallery_loc`, parser, "google", {
            enforceSitemapLocation: false,
            allowedProtocols: VIDEO_ALLOWED_PROTOCOLS,
        });
    }
}
function validateVideoPriceEntry(state, entry, parser) {
    const hasValue = entry.value.length > 0;
    const hasValidPriceValue = !hasValue || /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(entry.value);
    const hasValidCurrency = entry.currency === undefined || /^[A-Z]{3}$/.test(entry.currency);
    const hasValidType = entry.type === undefined || VIDEO_PRICE_TYPE_VALUES.has(entry.type);
    const hasValidResolution = entry.resolution === undefined || VIDEO_PRICE_RESOLUTION_VALUES.has(entry.resolution);
    const hasRequiredCurrency = !hasValue || entry.currency !== undefined;
    const hasRequiredType = hasValue || entry.type !== undefined;
    if (!hasValidPriceValue
        || !hasValidCurrency
        || !hasValidType
        || !hasValidResolution
        || !hasRequiredCurrency
        || !hasRequiredType) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_PRICE_INVALID",
            severity: "error",
            source: "google",
            message: "video:price must follow the legacy video XSD value, currency, type, and resolution constraints.",
            location: { ...currentLocation(state, parser), path: entry.path },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
            context: {
                hasValue,
                currency: entry.currency,
                type: entry.type,
                resolution: entry.resolution,
            },
        });
    }
}
function validatePageMapAttributeEntry(state, entry, text, parser) {
    const hasText = text.length > 0;
    const hasValue = entry.value !== undefined && entry.value.length > 0;
    if (hasText === hasValue) {
        addDiagnostic(state, {
            code: "GOOGLE_PAGEMAP_ATTRIBUTE_VALUE_INVALID",
            severity: "error",
            source: "google",
            message: "pagemap:Attribute must include either text content or @value, but not both.",
            location: { ...currentLocation(state, parser), path: entry.path },
            spec: "https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd",
        });
    }
}
function validateVideoTvShow(state, entry, parser) {
    if (!entry.tvShowPath) {
        return;
    }
    if (!entry.tvShowShowTitle) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_TVSHOW_REQUIRED_FIELD",
            severity: "error",
            source: "google",
            message: "video:tvshow must contain video:show_title.",
            location: { ...currentLocation(state, parser), path: entry.tvShowPath },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
    if (!entry.tvShowVideoType) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_TVSHOW_REQUIRED_FIELD",
            severity: "error",
            source: "google",
            message: "video:tvshow must contain video:video_type.",
            location: { ...currentLocation(state, parser), path: entry.tvShowPath },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
    else if (!VIDEO_TVSHOW_VIDEO_TYPE_VALUES.has(entry.tvShowVideoType)) {
        addDiagnostic(state, {
            code: "GOOGLE_VIDEO_TVSHOW_VIDEO_TYPE_INVALID",
            severity: "error",
            source: "google",
            message: "video:tvshow/video_type must be one of full, preview, clip, interview, news, or other.",
            location: { ...currentLocation(state, parser), path: `${entry.tvShowPath}/video:video_type` },
            spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
        });
    }
    for (const [value, label] of [
        [entry.tvShowSeasonNumber, "season_number"],
        [entry.tvShowEpisodeNumber, "episode_number"],
    ]) {
        if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1)) {
            addDiagnostic(state, {
                code: "GOOGLE_VIDEO_TVSHOW_NUMBER_INVALID",
                severity: "error",
                source: "google",
                message: `video:tvshow/${label} must be an integer greater than or equal to 1.`,
                location: { ...currentLocation(state, parser), path: `${entry.tvShowPath}/video:${label}` },
                spec: "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd",
            });
        }
    }
    if (entry.tvShowPremierDate !== undefined) {
        validateGoogleDateTime(state, entry.tvShowPremierDate, `${entry.tvShowPath}/video:premier_date`, parser, "GOOGLE_VIDEO_TVSHOW_PREMIER_DATE_INVALID", "video:tvshow/video:premier_date must use W3C date or datetime format; datetime values must include seconds and a timezone.", "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd", { requireTimeSeconds: true });
    }
}
function isValidGoogleNewsLanguage(value) {
    const normalized = value.toLowerCase();
    if (normalized === "zh-cn" || normalized === "zh-tw") {
        return true;
    }
    if (/^[a-z]{2}$/i.test(value)) {
        return isIso639Alpha2LanguageCode(value);
    }
    return isIso639Alpha3LanguageCode(value);
}
function isValidGoogleNewsGenres(value) {
    const allowed = new Set(["PressRelease", "Satire", "Blog", "OpEd", "Opinion", "UserGenerated"]);
    const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
    return parts.length > 0 && parts.every((part) => allowed.has(part));
}
function isValidGoogleNewsStockTickers(value) {
    if (value.length === 0) {
        return true;
    }
    const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
    return parts.length <= 5 && parts.every((part) => /^\w+:\w+$/.test(part));
}
function isVideoYesNo(value) {
    return value === "yes" || value === "Yes" || value === "YES" || value === "no" || value === "No" || value === "NO";
}
function isSpaceSeparatedIso3166List(value) {
    const parts = value.trim().split(/\s+/).filter((part) => part.length > 0);
    return parts.length > 0 && parts.every((part) => isIso3166Alpha2RegionCode(part));
}
function isSpaceSeparatedVideoPlatformList(value) {
    const parts = value.trim().split(/\s+/).filter((part) => part.length > 0);
    return parts.length > 0 && parts.every((part) => VIDEO_PLATFORM_VALUES.has(part));
}
function hasSameHostname(left, right) {
    try {
        return new URL(left).hostname === new URL(right).hostname;
    }
    catch {
        return false;
    }
}
function hasUnsupportedVideoContentLocFormat(value) {
    try {
        const pathname = new URL(value).pathname.toLowerCase();
        return pathname.endsWith(".html") || pathname.endsWith(".htm") || pathname.endsWith(".swf");
    }
    catch {
        return false;
    }
}
function validateHreflangLink(state, node, parser) {
    const attributes = node.attributes;
    const rel = getAttribute(attributes, "rel");
    const hreflang = getAttribute(attributes, "hreflang");
    const href = getAttribute(attributes, "href");
    const path = state.stack.at(-1)?.path ?? "";
    if (rel !== "alternate") {
        addDiagnostic(state, {
            code: "GOOGLE_HREFLANG_REL_INVALID",
            severity: "error",
            source: "google",
            message: "xhtml:link hreflang annotations must use rel=\"alternate\".",
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
        });
    }
    if (!hreflang) {
        addDiagnostic(state, {
            code: "GOOGLE_HREFLANG_REQUIRED",
            severity: "error",
            source: "google",
            message: "xhtml:link alternate annotations must include hreflang.",
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
        });
    }
    else if (!isValidBcp47LanguageTag(hreflang)) {
        addDiagnostic(state, {
            code: "GOOGLE_HREFLANG_INVALID",
            severity: "error",
            source: "google",
            message: "hreflang must be x-default or a valid-looking language/region code.",
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
        });
    }
    else if (!isGoogleSupportedHreflangTag(hreflang)) {
        addDiagnostic(state, {
            code: "GOOGLE_HREFLANG_UNSUPPORTED_CODE",
            severity: "error",
            source: "google",
            message: "hreflang is valid BCP 47, but Google sitemap hreflang supports a two-letter language code with optional script and two-letter region, or x-default.",
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
        });
    }
    if (!href) {
        addDiagnostic(state, {
            code: "GOOGLE_HREFLANG_HREF_REQUIRED",
            severity: "error",
            source: "google",
            message: "xhtml:link alternate annotations must include href.",
            location: currentLocation(state, parser),
            spec: "https://developers.google.com/search/docs/specialty/international/localized-versions",
        });
    }
    else {
        validateLoc(state, href, `${path}/@href`, parser, "google", { enforceSitemapLocation: false });
    }
    state.currentUrl?.hreflangs.push({ hreflang, href, path });
}
function getAttribute(attributes, name) {
    const attribute = attributes[name];
    return typeof attribute?.value === "string" ? attribute.value : undefined;
}
function isAllowedUrlsetElement(parent, child) {
    if (parent === "urlset")
        return child === "url";
    if (parent === "url")
        return child === "loc" || child === "lastmod" || child === "changefreq" || child === "priority";
    return false;
}
function isAllowedSitemapIndexElement(parent, child) {
    if (parent === "sitemapindex")
        return child === "sitemap";
    if (parent === "sitemap")
        return child === "loc" || child === "lastmod";
    return false;
}
function isExtensionNamespace(uri) {
    return uri === IMAGE_NS || uri === NEWS_NS || uri === VIDEO_NS || uri === PAGEMAP_NS || uri === XHTML_NS;
}
function isUtf8Encoding(value) {
    return /^utf-?8$/i.test(value.trim());
}
function unexpectedElement(path, parser, state) {
    return {
        code: "UNEXPECTED_SITEMAP_ELEMENT",
        severity: "error",
        source: "sitemaps.org",
        message: "Element is not allowed at this location in the sitemap protocol.",
        sourceId: state.sourceId,
        location: { ...currentLocation(state, parser), path },
        spec: "https://www.sitemaps.org/protocol.html",
    };
}
function addDiagnostic(state, diagnostic) {
    if (!isDiagnosticEnabled(state, diagnostic)) {
        return;
    }
    const definition = getRuleDefinition(diagnostic.code);
    const severity = state.options.severityOverrides?.[diagnostic.code] ?? diagnostic.severity;
    const withSource = {
        ...diagnostic,
        severity,
        source: diagnostic.source ?? definition?.source,
        spec: diagnostic.spec ?? definition?.spec,
        sourceId: state.sourceId,
    };
    if (severity === "error")
        state.diagnosticCounts.errors += 1;
    if (severity === "warning")
        state.diagnosticCounts.warnings += 1;
    if (severity === "info")
        state.diagnosticCounts.info += 1;
    emit(state, { type: "diagnostic", sourceId: state.sourceId, diagnostic: withSource });
}
function isDiagnosticEnabled(state, diagnostic) {
    if (state.options.disabledRules?.includes(diagnostic.code)) {
        return false;
    }
    if (diagnostic.source === "google" && state.options.google === false) {
        return false;
    }
    const extension = extensionForCode(diagnostic.code);
    if (!extension || !state.options.extensions) {
        return true;
    }
    return state.options.extensions.includes(extension);
}
function extensionForCode(code) {
    if (code.startsWith("GOOGLE_IMAGE_"))
        return "image";
    if (code.startsWith("GOOGLE_NEWS_"))
        return "news";
    if (code.startsWith("GOOGLE_VIDEO_"))
        return "video";
    if (code.startsWith("GOOGLE_PAGEMAP_"))
        return "pagemap";
    if (code.startsWith("GOOGLE_HREFLANG_"))
        return "hreflang";
    return undefined;
}
function emit(state, event) {
    state.pending.push(event);
    state.options.onProgress?.(event);
}
async function* drain(state) {
    const events = state.pending;
    state.pending = [];
    for (const event of events) {
        yield event;
    }
}
function createSummary(state) {
    return {
        valid: state.diagnosticCounts.errors === 0,
        sourceId: state.sourceId,
        rootType: state.rootType,
        urls: state.urls,
        sitemaps: state.sitemaps,
        sitemapLocations: state.sitemapLocations,
        bytes: state.bytes,
        diagnostics: {
            ...state.diagnosticCounts,
        },
    };
}
function currentLocation(state, parser) {
    const location = parser.location();
    return {
        line: location.line,
        column: location.column,
        position: location.position,
        path: state.stack.at(-1)?.path,
    };
}
