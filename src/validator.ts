import {
  ExtensionValidator,
  isElementOnlyExtensionContainer,
  isExtensionNamespace,
  isValidCompleteW3cDateOrDateTime,
  shouldCollectExtensionText,
} from "./extension-validation.js";
import { normalizeInput, readableForXml } from "./input.js";
import { validateLocRule, validateSingleHostRule } from "./loc-rules.js";
import { getRuleDefinition } from "./rules.js";
import { createSaxesParserAdapter } from "./xml-parser.js";
import { DEFAULT_LIMITS } from "./types.js";
import type { LocRuleContext, LocValidationOptions } from "./loc-rules.js";
import type {
  SitemapDiagnostic,
  SitemapExtension,
  SitemapInput,
  SourceLocation,
  ValidationEvent,
  ValidationLimits,
  ValidationOptions,
  ValidationResult,
  ValidationSummary,
} from "./types.js";
import type { XmlAttribute, XmlElement, XmlParserAdapter } from "./xml-parser.js";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
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


interface StackItem {
  name: string;
  local: string;
  uri: string;
  path: string;
  text: string | undefined;
}

interface UrlEntry {
  loc?: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  seenCoreChildren: Set<string>;
  lastCoreChildOrder: number;
}

interface SitemapEntry {
  loc?: string;
  lastmod?: string;
  seenCoreChildren: Set<string>;
  lastCoreChildOrder: number;
}



interface State {
  sourceId: string;
  options: ValidationOptions;
  limits: ValidationLimits;
  pending: ValidationEvent[];
  diagnosticCounts: ValidationSummary["diagnostics"];
  stack: StackItem[];
  rootType: "urlset" | "sitemapindex" | undefined;
  rootSeen: boolean;
  urls: number;
  sitemaps: number;
  sitemapLocations: string[];
  bytes: number;
  currentUrl: UrlEntry | undefined;
  currentSitemap: SitemapEntry | undefined;
  extensions: ExtensionValidator;
  sitemapLocation: URL | undefined;
  urlsetHost: string | undefined;
  sitemapIndexHost: string | undefined;
}

export async function validateSitemap(input: SitemapInput, options: ValidationOptions = {}): Promise<ValidationResult> {
  const diagnostics: SitemapDiagnostic[] = [];
  let summary: ValidationSummary | undefined;

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

export async function* validateSitemapEvents(
  input: SitemapInput,
  options: ValidationOptions = {},
): AsyncGenerator<ValidationEvent, void, void> {
  const normalized = await normalizeInput(input, options);
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const state = createState(normalized.sourceId, options, limits);
  const parser = createParser(state);
  const stream = readableForXml(normalized);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let stopParsing = false;

  emit(state, { type: "source:start", sourceId: state.sourceId });
  if (options.sitemapLocation !== undefined && !state.sitemapLocation) {
    addDiagnostic(state, {
      code: "INVALID_ABSOLUTE_URL",
      severity: "error",
      source: "rfc3986",
      message: "sitemapLocation must be a valid absolute URL.",
      spec: "https://www.rfc-editor.org/rfc/rfc3986",
      context: { sitemapLocation: options.sitemapLocation },
    });
  }
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

      let decoded: string;
      try {
        decoded = decoder.decode(chunk, { stream: true });
      } catch {
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

    options.signal?.throwIfAborted();

    if (!stopParsing) {
      try {
        const tail = decoder.decode();
        if (tail.length > 0) {
          parser.write(tail);
        }
      } catch {
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
  } catch (error) {
    options.signal?.throwIfAborted();
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

function createState(sourceId: string, options: ValidationOptions, limits: ValidationLimits): State {
  let sitemapLocation: URL | undefined;

  if (options.sitemapLocation !== undefined) {
    try {
      sitemapLocation = new URL(options.sitemapLocation);
    } catch {
      // The validation event stream reports this option error after source:start.
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
    extensions: new ExtensionValidator(limits),
    sitemapLocation,
    urlsetHost: undefined,
    sitemapIndexHost: undefined,
  };
}

function createParser(state: State): XmlParserAdapter {
  const parser = createSaxesParserAdapter({
    onXmlDeclaration(declaration): void {
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

    onError(error): void {
      addDiagnostic(state, {
        code: "XML_PARSE_ERROR",
        severity: "error",
        source: "xml",
        message: error.message,
        location: currentLocation(state, parser),
        spec: "https://www.w3.org/TR/xml/",
      });
    },

    onOpenElement(baseElement): void {
      const path = `${state.stack.at(-1)?.path ?? ""}/${baseElement.local || baseElement.name}`;
      const element = { ...baseElement, path };
      state.stack.push({ ...element, text: shouldCollectText(element) ? "" : undefined });

      if (!state.rootSeen) {
        validateRoot(state, element, parser);
      } else {
        validateElementPlacement(state, element, parser);
      }

      handleOpenElement(state, element, baseElement, parser);
    },

    onText(text): void {
      const current = state.stack.at(-1);
      if (current?.text !== undefined) {
        current.text += text;
      } else {
        validateUnexpectedText(state, text, parser);
      }
    },

    onCdata(text): void {
      const current = state.stack.at(-1);
      if (current?.text !== undefined) {
        current.text += text;
      } else {
        validateUnexpectedText(state, text, parser);
      }
    },

    onDoctype(): void {
      addDiagnostic(state, {
        code: "XML_DOCTYPE_NOT_ALLOWED",
        severity: "error",
        source: "xml",
        message: "DOCTYPE declarations are not allowed in sitemap XML validation because they can introduce unsafe entity behavior.",
        location: currentLocation(state, parser),
        spec: "https://www.w3.org/TR/xml/",
      });
    },

    onCloseElement(): void {
      const item = state.stack.pop();
      if (!item) {
        return;
      }

      handleCloseElement(state, item, parser);
    },
  });

  return parser;
}

function validateRoot(state: State, element: Pick<StackItem, "local" | "uri" | "path">, parser: XmlParserAdapter): void {
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

function validateRootCardinality(state: State): void {
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

function validateElementPlacement(
  state: State,
  element: Pick<StackItem, "local" | "uri" | "path">,
  parser: XmlParserAdapter,
): void {
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
  } else if (parent.uri === SITEMAP_NS && !(state.rootType === "urlset" && parent.local === "url")) {
    addDiagnostic(state, unexpectedElement(element.path, parser, state));
  }

  state.extensions.validatePlacement(
    element,
    parent,
    state.stack.at(-3),
    extensionContext(state, parser),
  );
}

function validateSitemapProtocolChild(
  state: State,
  element: Pick<StackItem, "local" | "uri" | "path">,
  parser: XmlParserAdapter,
): void {
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

function validateOrderedSingleChild(
  state: State,
  seen: Set<string>,
  orderMap: ReadonlyMap<string, number>,
  element: Pick<StackItem, "local" | "path">,
  parser: XmlParserAdapter,
): void {
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

function handleOpenElement(
  state: State,
  element: Pick<StackItem, "local" | "uri" | "path">,
  node: XmlElement,
  parser: XmlParserAdapter,
): void {
  if (element.uri === SITEMAP_NS && state.rootType === "urlset" && element.local === "url") {
    state.currentUrl = {
      seenCoreChildren: new Set(),
      lastCoreChildOrder: -1,
    };
    state.extensions.startUrl();
  }

  if (element.uri === SITEMAP_NS && state.rootType === "sitemapindex" && element.local === "sitemap") {
    state.currentSitemap = {
      seenCoreChildren: new Set(),
      lastCoreChildOrder: -1,
    };
  }

  validateSitemapProtocolChild(state, element, parser);
  validateUnexpectedAttributes(state, element, node, parser);

  const parent = state.stack.at(-2);
  if (isCustomUrlExtensionElement(state, element) || state.extensions.isTopLevelUrlExtension(element, parent)) {
    markUrlExtensionOrder(state, element, parser);
  }

  state.extensions.open(element, node, parent, extensionContext(state, parser));
}

function markUrlExtensionOrder(
  state: State,
  element: Pick<StackItem, "path">,
  parser: XmlParserAdapter,
): void {
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

function validateUnexpectedAttributes(
  state: State,
  element: Pick<StackItem, "local" | "uri" | "path">,
  node: XmlElement,
  parser: XmlParserAdapter,
): void {
  if (element.uri !== SITEMAP_NS) {
    return;
  }

  for (const attribute of Object.values(node.attributes)) {
    if (!isSchemaUtilityAttribute(attribute)) {
      addUnexpectedAttributeDiagnostic(state, "SITEMAP_ATTRIBUTE_UNEXPECTED", "sitemaps.org", element, attribute, parser);
    }
  }
}

function addUnexpectedAttributeDiagnostic(
  state: State,
  code: string,
  source: "sitemaps.org" | "google",
  element: Pick<StackItem, "path">,
  attribute: XmlAttribute,
  parser: XmlParserAdapter,
): void {
  addDiagnostic(state, {
    code,
    severity: "error",
    source,
    message: `Attribute ${attribute.name} is not allowed on this sitemap element.`,
    location: { ...currentLocation(state, parser), path: `${element.path}/@${attribute.name}` },
  });
}

function isSchemaUtilityAttribute(attribute: XmlAttribute): boolean {
  return attribute.uri === XMLNS_NS
    || attribute.name === "xmlns"
    || attribute.name.startsWith("xmlns:")
    || attribute.uri === XSI_NS;
}

function shouldCollectText(element: Pick<StackItem, "local" | "uri">): boolean {
  if (element.uri === SITEMAP_NS) {
    return element.local === "loc"
      || element.local === "lastmod"
      || element.local === "changefreq"
      || element.local === "priority";
  }

  return shouldCollectExtensionText(element);
}

function validateUnexpectedText(state: State, text: string, parser: XmlParserAdapter): void {
  const current = state.stack.at(-1);
  if (!current || text.trim().length === 0 || !isElementOnlyContainer(current)) {
    return;
  }

  addDiagnostic(state, {
    code: "SITEMAP_TEXT_UNEXPECTED",
    severity: "error",
    source: "sitemaps.org",
    message: "Character data is not allowed in this element-only sitemap container.",
    location: currentLocation(state, parser),
    spec: "https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd",
  });
}

function isElementOnlyContainer(element: Pick<StackItem, "local" | "uri">): boolean {
  if (element.uri === SITEMAP_NS) {
    return element.local === "urlset"
      || element.local === "sitemapindex"
      || element.local === "url"
      || element.local === "sitemap";
  }

  return isElementOnlyExtensionContainer(element);
}

function isCustomUrlExtensionElement(state: State, element: Pick<StackItem, "uri">): boolean {
  const parent = state.stack.at(-2);

  return Boolean(
    state.currentUrl
    && parent?.uri === SITEMAP_NS
    && parent.local === "url"
    && element.uri !== ""
    && element.uri !== SITEMAP_NS
    && !isExtensionNamespace(element.uri),
  );
}

function handleCloseElement(state: State, item: StackItem, parser: XmlParserAdapter): void {
  const text = item.text?.trim() ?? "";

  if (state.currentUrl && item.uri === SITEMAP_NS) {
    if (item.local === "loc") state.currentUrl.loc = text;
    if (item.local === "lastmod") state.currentUrl.lastmod = text;
    if (item.local === "changefreq") state.currentUrl.changefreq = text;
    if (item.local === "priority") state.currentUrl.priority = text;
  }

  if (state.currentSitemap && item.uri === SITEMAP_NS) {
    if (item.local === "loc") state.currentSitemap.loc = text;
    if (item.local === "lastmod") state.currentSitemap.lastmod = text;
  }

  if (isExtensionNamespace(item.uri)) {
    state.extensions.close(item, text, state.currentUrl?.loc, extensionContext(state, parser));
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

function finishUrlEntry(state: State, entry: UrlEntry, path: string, parser: XmlParserAdapter): void {
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
  } else {
    const url = validateLoc(state, entry.loc, `${path}/loc`, parser, "sitemaps.org", { enforceSitemapLocation: true });
    validateSingleHost(state, url, `${path}/loc`, parser, "urlset");
  }

  validateOptionalSitemapFields(state, entry, path, parser);
  const hreflangs = state.extensions.finishUrl(entry.loc, path, extensionContext(state, parser));
  emit(state, {
    type: "sitemap:url",
    sourceId: state.sourceId,
    count: state.urls,
    loc: entry.loc,
    hreflangs,
  });
}

function finishSitemapEntry(state: State, entry: SitemapEntry, path: string, parser: XmlParserAdapter): void {
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
  } else {
    const url = validateLoc(state, entry.loc, `${path}/loc`, parser, "sitemaps.org", { enforceSitemapLocation: true });
    validateSingleHost(state, url, `${path}/loc`, parser, "sitemapindex");
    state.sitemapLocations.push(entry.loc);
  }

  if (entry.lastmod !== undefined) {
    validateLastmod(state, entry.lastmod, `${path}/lastmod`, parser);
  }

  emit(state, { type: "sitemap:entry", sourceId: state.sourceId, count: state.sitemaps, loc: entry.loc });
}

function validateOptionalSitemapFields(state: State, entry: UrlEntry, path: string, parser: XmlParserAdapter): void {
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
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(entry.priority) || !Number.isFinite(priority) || priority < 0 || priority > 1) {
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

function validateLastmod(state: State, value: string, path: string, parser: XmlParserAdapter): void {
  validateDateTimeValue(
    state,
    value,
    path,
    parser,
    "INVALID_LASTMOD",
    "sitemaps.org",
    "lastmod must use a complete W3C date (YYYY-MM-DD) or datetime format.",
    "https://www.sitemaps.org/protocol.html",
  );
}

function validateDateTimeValue(
  state: State,
  value: string,
  path: string,
  parser: XmlParserAdapter,
  code: string,
  source: "sitemaps.org" | "google",
  message: string,
  spec: string,
  options: DateTimeValidationOptions = {},
): void {
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

type DateTimeValidationOptions = import("./extension-validation.js").DateTimeValidationOptions;

function validateLoc(
  state: State,
  value: string,
  path: string,
  parser: XmlParserAdapter,
  source: "sitemaps.org" | "google",
  options: LocValidationOptions,
): URL | undefined {
  return validateLocRule(state, locRuleContext(state, parser), value, path, source, options);
}

function validateSingleHost(
  state: State,
  url: URL | undefined,
  path: string,
  parser: XmlParserAdapter,
  kind: "urlset" | "sitemapindex",
): void {
  validateSingleHostRule(state, locRuleContext(state, parser), url, path, kind);
}

function locRuleContext(state: State, parser: XmlParserAdapter): LocRuleContext {
  return {
    addDiagnostic(diagnostic): void {
      addDiagnostic(state, diagnostic);
    },
    location(path): SourceLocation {
      return { ...currentLocation(state, parser), path };
    },
  };
}

function extensionContext(state: State, parser: XmlParserAdapter) {
  return {
    addDiagnostic(diagnostic: Omit<SitemapDiagnostic, "sourceId">): void {
      addDiagnostic(state, diagnostic);
    },
    location(path?: string): SourceLocation {
      return { ...currentLocation(state, parser), path };
    },
    validateLoc(value: string, path: string, options: LocValidationOptions): URL | undefined {
      return validateLoc(state, value, path, parser, "google", options);
    },
  };
}

function isAllowedUrlsetElement(parent: string, child: string): boolean {
  if (parent === "urlset") return child === "url";
  if (parent === "url") return child === "loc" || child === "lastmod" || child === "changefreq" || child === "priority";
  return false;
}

function isAllowedSitemapIndexElement(parent: string, child: string): boolean {
  if (parent === "sitemapindex") return child === "sitemap";
  if (parent === "sitemap") return child === "loc" || child === "lastmod";
  return false;
}

function isUtf8Encoding(value: string): boolean {
  return /^utf-?8$/i.test(value.trim());
}

function unexpectedElement(path: string, parser: XmlParserAdapter, state: State): SitemapDiagnostic {
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

function addDiagnostic(state: State, diagnostic: Omit<SitemapDiagnostic, "sourceId">): void {
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
  if (severity === "error") state.diagnosticCounts.errors += 1;
  if (severity === "warning") state.diagnosticCounts.warnings += 1;
  if (severity === "info") state.diagnosticCounts.info += 1;
  emit(state, { type: "diagnostic", sourceId: state.sourceId, diagnostic: withSource });
}

function isDiagnosticEnabled(state: State, diagnostic: Omit<SitemapDiagnostic, "sourceId">): boolean {
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

function extensionForCode(code: string): SitemapExtension | undefined {
  if (code.startsWith("GOOGLE_IMAGE_")) return "image";
  if (code.startsWith("GOOGLE_NEWS_")) return "news";
  if (code.startsWith("GOOGLE_VIDEO_")) return "video";
  if (code.startsWith("GOOGLE_PAGEMAP_")) return "pagemap";
  if (code.startsWith("GOOGLE_HREFLANG_")) return "hreflang";
  return undefined;
}

function emit(state: State, event: ValidationEvent): void {
  state.pending.push(event);
  state.options.onProgress?.(event);
}

async function* drain(state: State): AsyncGenerator<ValidationEvent, void, void> {
  const events = state.pending;
  state.pending = [];

  for (const event of events) {
    yield event;
  }
}

function createSummary(state: State): ValidationSummary {
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

function currentLocation(state: State, parser: XmlParserAdapter): SourceLocation {
  const location = parser.location();

  return {
    line: location.line,
    column: location.column,
    position: location.position,
    path: state.stack.at(-1)?.path,
  };
}
