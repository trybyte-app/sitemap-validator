import {
  isGoogleSupportedHreflangTag,
  isIso3166Alpha2RegionCode,
  isIso639Alpha2LanguageCode,
  isIso639Alpha3LanguageCode,
  isValidBcp47LanguageTag,
} from "./standards.js";
import type { LocValidationOptions } from "./loc-rules.js";
import type { HreflangAlternate, SitemapDiagnostic, SourceLocation, ValidationLimits } from "./types.js";
import type { XmlAttribute, XmlElement } from "./xml-parser.js";

export const IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1";
export const NEWS_NS = "http://www.google.com/schemas/sitemap-news/0.9";
export const VIDEO_NS = "http://www.google.com/schemas/sitemap-video/1.1";
export const PAGEMAP_NS = "http://www.google.com/schemas/sitemap-pagemap/1.0";
export const XHTML_NS = "http://www.w3.org/1999/xhtml";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const IMAGE_SPEC = "https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps";
const NEWS_SPEC = "https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap";
const VIDEO_SPEC = "https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps";
const HREFLANG_SPEC = "https://developers.google.com/search/docs/specialty/international/localized-versions";
const PAGEMAP_XSD = "https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd";
const IMAGE_XSD = "https://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd";
const NEWS_XSD = "https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd";
const VIDEO_XSD = "https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd";

const DEPRECATED_IMAGE_TAGS = new Set(["caption", "geo_location", "title", "license"]);
const KNOWN_IMAGE_TAGS = new Set(["image", "loc", ...DEPRECATED_IMAGE_TAGS]);
const IMAGE_CHILD_ORDER = new Map([["loc", 0], ["caption", 1], ["geo_location", 2], ["title", 3], ["license", 4]]);
const DEPRECATED_NEWS_TAGS = new Set(["access", "genres", "keywords", "stock_tickers"]);
const KNOWN_NEWS_TAGS = new Set(["news", "publication", "name", "language", "publication_date", "title", ...DEPRECATED_NEWS_TAGS]);
const NEWS_CHILD_ORDER = new Map([["publication", 0], ["access", 1], ["genres", 2], ["publication_date", 3], ["title", 4], ["keywords", 5], ["stock_tickers", 6]]);
const NEWS_PUBLICATION_CHILD_ORDER = new Map([["name", 0], ["language", 1]]);
const VIDEO_REPEATABLE_TAGS = new Set(["tag", "content_segment_loc", "id", "price"]);
const DEPRECATED_VIDEO_TAGS = new Set(["category", "content_segment_loc", "gallery_loc", "id", "price", "tvshow"]);
const DEPRECATED_VIDEO_PLAYER_LOC_ATTRIBUTES = new Set(["autoplay", "allow_embed"]);
const VIDEO_ID_TYPE_VALUES = new Set(["tms:series", "tms:program", "rovi:series", "rovi:program", "freebase", "url"]);
const VIDEO_PLATFORM_VALUES = new Set(["web", "mobile", "tv"]);
const VIDEO_PRICE_TYPE_VALUES = new Set(["purchase", "PURCHASE", "rent", "RENT"]);
const VIDEO_PRICE_RESOLUTION_VALUES = new Set(["sd", "SD", "hd", "HD"]);
const VIDEO_TVSHOW_VIDEO_TYPE_VALUES = new Set(["full", "preview", "clip", "interview", "news", "other"]);
const VIDEO_ALLOWED_PROTOCOLS = ["http:", "https:", "ftp:"] as const;
const VIDEO_TVSHOW_TAGS = new Set(["show_title", "video_type", "episode_title", "season_number", "episode_number", "premier_date"]);
const VIDEO_CHILD_ORDER = new Map([
  ["thumbnail_loc", 0], ["title", 1], ["description", 2], ["content_loc", 3], ["player_loc", 4],
  ["duration", 5], ["expiration_date", 6], ["rating", 7], ["content_segment_loc", 8], ["view_count", 9],
  ["publication_date", 10], ["tag", 11], ["category", 12], ["family_friendly", 13], ["restriction", 14],
  ["gallery_loc", 15], ["price", 16], ["requires_subscription", 17], ["uploader", 18], ["tvshow", 19],
  ["platform", 20], ["live", 21], ["id", 22],
]);
const KNOWN_VIDEO_TAGS = new Set([
  "video", "thumbnail_loc", "title", "description", "content_loc", "content_segment_loc", "player_loc", "duration",
  "expiration_date", "rating", "view_count", "publication_date", "family_friendly", "restriction", "platform",
  "requires_subscription", "uploader", "live", "tag", "id", "show_title", "video_type", "episode_title",
  "season_number", "episode_number", "premier_date", ...DEPRECATED_VIDEO_TAGS,
]);
const KNOWN_PAGEMAP_TAGS = new Set(["PageMap", "Template", "DataObject", "Attribute"]);
const PAGEMAP_CHILD_ORDER = new Map([["Template", 0], ["DataObject", 1]]);

export interface ExtensionElement {
  local: string;
  uri: string;
  path: string;
}

export interface ExtensionValidationContext {
  addDiagnostic(diagnostic: Omit<SitemapDiagnostic, "sourceId">): void;
  location(path?: string): SourceLocation;
  validateLoc(value: string, path: string, options: LocValidationOptions): URL | undefined;
}

interface ImageEntry {
  hasLoc: boolean;
  locCount: number;
  seenChildren: Set<string>;
  lastChildOrder: number;
  path: string;
}

interface NewsEntry {
  path: string;
  seenChildren: Set<string>;
  seenPublicationChildren: Set<string>;
  lastChildOrder: number;
  lastPublicationChildOrder: number;
  publicationCount: number;
  publicationName?: string;
  publicationLanguage?: string;
  access?: string;
  genres?: string;
  publicationDate?: string;
  title?: string;
  keywords?: string;
  stockTickers?: string;
}

interface VideoEntry {
  path: string;
  seenChildren: Set<string>;
  lastChildOrder: number;
  thumbnailLoc?: string;
  title?: string;
  description?: string;
  contentLoc?: string;
  playerLoc?: string;
  galleryLoc?: string;
  duration?: string;
  expirationDate?: string;
  publicationDate?: string;
  category?: string;
  rating?: string;
  viewCount?: string;
  familyFriendly?: string;
  live?: string;
  restrictionRelationship: string | undefined;
  restrictionValue?: string;
  platformRelationship: string | undefined;
  platformValue?: string;
  requiresSubscription?: string;
  uploader?: string;
  uploaderInfo: string | undefined;
  contentSegmentLocCount: number;
  tvShowPath: string | undefined;
  tvShowShowTitle?: string;
  tvShowVideoType?: string;
  tvShowSeasonNumber?: string;
  tvShowEpisodeNumber?: string;
  tvShowPremierDate?: string;
  tagCount: number;
}

interface VideoPriceEntry {
  path: string;
  value: string;
  currency: string | undefined;
  type: string | undefined;
  resolution: string | undefined;
}

interface HreflangEntry {
  hreflang: string | undefined;
  href: string | undefined;
  path: string;
}

interface PageMapEntry {
  path: string;
  seenChildren: Set<string>;
  lastChildOrder: number;
}

interface PageMapAttributeEntry {
  path: string;
  value: string | undefined;
}

export class ExtensionValidator {
  readonly #limits: ValidationLimits;
  #urlActive = false;
  #imageCount = 0;
  #newsCount = 0;
  #newsEntries = 0;
  #hreflangs: HreflangEntry[] = [];
  #currentImage: ImageEntry | undefined;
  #currentNews: NewsEntry | undefined;
  #currentVideo: VideoEntry | undefined;
  #currentVideoPrice: Omit<VideoPriceEntry, "value"> | undefined;
  #currentPageMap: PageMapEntry | undefined;
  #currentPageMapAttribute: PageMapAttributeEntry | undefined;

  constructor(limits: ValidationLimits) {
    this.#limits = limits;
  }

  startUrl(): void {
    this.#urlActive = true;
    this.#imageCount = 0;
    this.#newsCount = 0;
    this.#hreflangs = [];
  }

  finishUrl(loc: string | undefined, path: string, context: ExtensionValidationContext): HreflangAlternate[] | undefined {
    const alternates = this.#validateHreflangs(loc, path, context);
    this.#urlActive = false;
    this.#currentImage = undefined;
    this.#currentNews = undefined;
    this.#currentVideo = undefined;
    this.#currentVideoPrice = undefined;
    this.#currentPageMap = undefined;
    this.#currentPageMapAttribute = undefined;
    return alternates;
  }

  isTopLevelUrlExtension(element: ExtensionElement, parent: ExtensionElement | undefined): boolean {
    return this.#urlActive
      && parent?.uri === SITEMAP_NS
      && parent.local === "url"
      && isExtensionNamespace(element.uri);
  }

  validatePlacement(
    element: ExtensionElement,
    parent: ExtensionElement | undefined,
    grandparent: ExtensionElement | undefined,
    context: ExtensionValidationContext,
  ): void {
    if (!isExtensionNamespace(element.uri)) return;
    if (!this.#urlActive) {
      this.#add(context, "EXTENSION_OUTSIDE_URL", "Sitemap extension elements must be nested inside a url entry.", element.path,
        "https://developers.google.com/search/docs/crawling-indexing/sitemaps/combine-sitemap-extensions");
      return;
    }
    if (!parent) return;

    let valid = true;
    let code = "";
    let message = "";
    let spec = "";
    if (element.uri === IMAGE_NS) {
      valid = element.local === "image"
        ? parent.uri === SITEMAP_NS && parent.local === "url"
        : parent.uri === IMAGE_NS && parent.local === "image";
      code = "GOOGLE_IMAGE_ELEMENT_PLACEMENT_INVALID";
      message = "image:image must be a direct child of url, and image child fields must be direct children of image:image.";
      spec = IMAGE_SPEC;
    } else if (element.uri === NEWS_NS) {
      valid = isValidNewsPlacement(element.local, parent, grandparent);
      code = "GOOGLE_NEWS_ELEMENT_PLACEMENT_INVALID";
      message = "news:news must be a direct child of url, with publication fields in the documented news hierarchy.";
      spec = NEWS_SPEC;
    } else if (element.uri === VIDEO_NS) {
      valid = element.local === "video"
        ? parent.uri === SITEMAP_NS && parent.local === "url"
        : isValidVideoPlacement(element.local, parent);
      code = "GOOGLE_VIDEO_ELEMENT_PLACEMENT_INVALID";
      message = "video:video must be a direct child of url, and video child fields must be direct children of video:video.";
      spec = VIDEO_SPEC;
    } else if (element.uri === PAGEMAP_NS) {
      valid = element.local === "PageMap"
        ? parent.uri === SITEMAP_NS && parent.local === "url"
        : isValidPageMapPlacement(element.local, parent, grandparent);
      code = "GOOGLE_PAGEMAP_ELEMENT_PLACEMENT_INVALID";
      message = "PageMap must be a direct child of url, with Template/DataObject/Attribute in the PageMap schema hierarchy.";
      spec = PAGEMAP_XSD;
    } else if (element.uri === XHTML_NS) {
      valid = element.local === "link" && parent.uri === SITEMAP_NS && parent.local === "url";
      code = "GOOGLE_HREFLANG_ELEMENT_PLACEMENT_INVALID";
      message = "hreflang sitemap annotations must use xhtml:link as a direct child of url.";
      spec = HREFLANG_SPEC;
    }

    if (!valid) this.#add(context, code, message, element.path, spec);
  }

  open(
    element: ExtensionElement,
    node: XmlElement,
    parent: ExtensionElement | undefined,
    context: ExtensionValidationContext,
  ): void {
    if (!isExtensionNamespace(element.uri)) return;
    this.#validateAttributes(element, node, context);

    if (element.uri === IMAGE_NS) this.#openImage(element, parent, context);
    if (element.uri === NEWS_NS) this.#openNews(element, parent, context);
    if (element.uri === VIDEO_NS) this.#openVideo(element, node, parent, context);
    if (element.uri === XHTML_NS && element.local === "link" && this.#urlActive) this.#openHreflang(element, node, context);
    if (element.uri === PAGEMAP_NS) this.#openPageMap(element, node, parent, context);
  }

  close(element: ExtensionElement, text: string, parentUrlLoc: string | undefined, context: ExtensionValidationContext): void {
    if (element.uri === IMAGE_NS) this.#closeImage(element, text, context);
    if (element.uri === NEWS_NS) this.#closeNews(element, text, context);
    if (element.uri === VIDEO_NS) this.#closeVideo(element, text, parentUrlLoc, context);
    if (element.uri === PAGEMAP_NS) this.#closePageMap(element, text, context);
  }

  #openImage(element: ExtensionElement, parent: ExtensionElement | undefined, context: ExtensionValidationContext): void {
    if (element.local === "image" && this.#urlActive) {
      this.#imageCount += 1;
      this.#currentImage = { hasLoc: false, locCount: 0, seenChildren: new Set(), lastChildOrder: -1, path: element.path };
      if (this.#imageCount > this.#limits.maxImagesPerUrl) {
        this.#add(context, "GOOGLE_IMAGE_LIMIT_EXCEEDED", `A url entry must not contain more than ${this.#limits.maxImagesPerUrl} image:image entries.`, element.path, IMAGE_SPEC);
      }
    }
    if (DEPRECATED_IMAGE_TAGS.has(element.local)) {
      this.#add(context, "GOOGLE_IMAGE_TAG_DEPRECATED", `image:${element.local} has been removed from Google's image sitemap documentation.`, element.path, IMAGE_SPEC, "warning");
    }
    if (!KNOWN_IMAGE_TAGS.has(element.local)) {
      this.#add(context, "GOOGLE_IMAGE_UNKNOWN_TAG", `image:${element.local} is not a recognized Google image sitemap tag.`, element.path, IMAGE_SPEC, "warning");
    }
    const image = this.#currentImage;
    if (!image || element.local === "image" || parent?.uri !== IMAGE_NS || parent.local !== "image" || !KNOWN_IMAGE_TAGS.has(element.local)) return;
    this.#validateOrder(image, IMAGE_CHILD_ORDER, "GOOGLE_IMAGE_ELEMENT_OUT_OF_ORDER", element, context);
    if (element.local !== "loc" && image.seenChildren.has(element.local)) {
      this.#add(context, "GOOGLE_IMAGE_ELEMENT_DUPLICATE", `image:${element.local} can appear only once in an image:image entry.`, element.path, IMAGE_XSD);
    }
    image.seenChildren.add(element.local);
  }

  #closeImage(element: ExtensionElement, text: string, context: ExtensionValidationContext): void {
    if (this.#currentImage && element.local === "loc") {
      this.#currentImage.locCount += 1;
      this.#currentImage.hasLoc = true;
      context.validateLoc(text, element.path, { enforceSitemapLocation: false });
      if (this.#currentImage.locCount > 1) {
        this.#add(context, "GOOGLE_IMAGE_LOC_DUPLICATE", "image:image can contain only one image:loc element.", element.path, IMAGE_SPEC);
      }
    }
    if (this.#currentImage && element.local === "license") {
      context.validateLoc(text, element.path, { enforceSitemapLocation: false });
    }
    if (element.local === "image" && this.#currentImage) {
      if (!this.#currentImage.hasLoc) {
        this.#add(context, "GOOGLE_IMAGE_LOC_REQUIRED", "image:image must contain image:loc.", this.#currentImage.path, IMAGE_SPEC);
      }
      this.#currentImage = undefined;
    }
  }

  #openNews(element: ExtensionElement, parent: ExtensionElement | undefined, context: ExtensionValidationContext): void {
    if (element.local === "news" && this.#urlActive) {
      this.#newsCount += 1;
      this.#newsEntries += 1;
      this.#currentNews = {
        path: element.path, seenChildren: new Set(), seenPublicationChildren: new Set(), publicationCount: 0,
        lastChildOrder: -1, lastPublicationChildOrder: -1,
      };
      if (this.#newsCount > 1) this.#add(context, "GOOGLE_NEWS_ENTRY_DUPLICATE", "Each url entry can contain only one news:news element.", element.path, NEWS_SPEC);
      if (this.#newsEntries > this.#limits.maxNewsEntriesPerSitemap) {
        this.#add(context, "GOOGLE_NEWS_ENTRY_LIMIT_EXCEEDED", `A news sitemap must not contain more than ${this.#limits.maxNewsEntriesPerSitemap} news entries.`, element.path, NEWS_SPEC);
      }
    }
    if (!KNOWN_NEWS_TAGS.has(element.local)) {
      this.#add(context, "GOOGLE_NEWS_UNKNOWN_TAG", `news:${element.local} is not a recognized Google news sitemap tag.`, element.path, NEWS_SPEC, "warning");
    }
    if (DEPRECATED_NEWS_TAGS.has(element.local)) {
      this.#add(context, "GOOGLE_NEWS_TAG_DEPRECATED", `news:${element.local} is present in the legacy Google News XSD but is not part of the current Google News sitemap documentation.`, element.path, NEWS_XSD, "warning");
    }
    const news = this.#currentNews;
    if (!news || element.local === "news" || !parent) return;
    if (parent.uri === NEWS_NS && parent.local === "news") {
      this.#validateOrder(news, NEWS_CHILD_ORDER, "GOOGLE_NEWS_ELEMENT_OUT_OF_ORDER", element, context);
      if (element.local === "publication") news.publicationCount += 1;
      if (NEWS_CHILD_ORDER.has(element.local)) {
        if (news.seenChildren.has(element.local)) this.#add(context, "GOOGLE_NEWS_ELEMENT_DUPLICATE", `news:${element.local} can appear only once in a news:news entry.`, element.path, NEWS_SPEC);
        news.seenChildren.add(element.local);
      }
    }
    if (parent.uri === NEWS_NS && parent.local === "publication" && (element.local === "name" || element.local === "language")) {
      const holder = {
        get lastChildOrder() { return news.lastPublicationChildOrder; },
        set lastChildOrder(value: number) { news.lastPublicationChildOrder = value; },
      };
      this.#validateOrder(holder, NEWS_PUBLICATION_CHILD_ORDER, "GOOGLE_NEWS_ELEMENT_OUT_OF_ORDER", element, context);
      if (news.seenPublicationChildren.has(element.local)) this.#add(context, "GOOGLE_NEWS_ELEMENT_DUPLICATE", `news:${element.local} can appear only once in news:publication.`, element.path, NEWS_SPEC);
      news.seenPublicationChildren.add(element.local);
    }
  }

  #closeNews(element: ExtensionElement, text: string, context: ExtensionValidationContext): void {
    const news = this.#currentNews;
    if (news) {
      if (element.local === "name") news.publicationName = text;
      if (element.local === "language") news.publicationLanguage = text;
      if (element.local === "access") news.access = text;
      if (element.local === "genres") news.genres = text;
      if (element.local === "publication_date") news.publicationDate = text;
      if (element.local === "title") news.title = text;
      if (element.local === "keywords") news.keywords = text;
      if (element.local === "stock_tickers") news.stockTickers = text;
    }
    if (element.local === "news" && news) {
      this.#validateNews(news, context);
      this.#currentNews = undefined;
    }
  }

  #validateNews(entry: NewsEntry, context: ExtensionValidationContext): void {
    for (const [value, label] of [
      [entry.publicationName, "news:publication/news:name"], [entry.publicationLanguage, "news:publication/news:language"],
      [entry.publicationDate, "news:publication_date"], [entry.title, "news:title"],
    ] as const) {
      if (!value) this.#add(context, "GOOGLE_NEWS_REQUIRED_FIELD", `news:news must contain ${label}.`, entry.path, NEWS_SPEC);
    }
    if (entry.publicationDate !== undefined) {
      this.#validateDate(context, entry.publicationDate, `${entry.path}/news:publication_date`, "GOOGLE_NEWS_PUBLICATION_DATE_INVALID", "news:publication_date must use W3C date or datetime format.", NEWS_SPEC);
      const publishedAt = Date.parse(entry.publicationDate);
      if (!Number.isNaN(publishedAt) && publishedAt < Date.now() - 2 * 24 * 60 * 60 * 1_000) {
        this.#add(context, "GOOGLE_NEWS_PUBLICATION_DATE_STALE", "Google News sitemap metadata should only be included for articles created in the last two days.", `${entry.path}/news:publication_date`, NEWS_SPEC, "warning");
      }
    }
    if (entry.publicationLanguage !== undefined && !isValidGoogleNewsLanguage(entry.publicationLanguage)) this.#add(context, "GOOGLE_NEWS_LANGUAGE_INVALID", "news:language should be a valid-looking ISO language code.", `${entry.path}/news:publication/news:language`, NEWS_SPEC);
    if (entry.title !== undefined && entry.title.length > 110) this.#add(context, "GOOGLE_NEWS_TITLE_TOO_LONG", "news:title should be concise and no more than 110 characters.", `${entry.path}/news:title`, NEWS_SPEC, "warning");
    if (entry.access !== undefined && entry.access !== "Subscription" && entry.access !== "Registration") this.#add(context, "GOOGLE_NEWS_ACCESS_INVALID", "news:access must be Subscription or Registration when the legacy XSD field is used.", `${entry.path}/news:access`, NEWS_XSD);
    if (entry.genres !== undefined && !isValidGoogleNewsGenres(entry.genres)) this.#add(context, "GOOGLE_NEWS_GENRES_INVALID", "news:genres must contain comma-separated values from the Google News XSD genre list.", `${entry.path}/news:genres`, NEWS_XSD);
    if (entry.stockTickers !== undefined && !isValidGoogleNewsStockTickers(entry.stockTickers)) this.#add(context, "GOOGLE_NEWS_STOCK_TICKERS_INVALID", "news:stock_tickers must contain up to five comma-separated exchange:ticker values.", `${entry.path}/news:stock_tickers`, NEWS_XSD);
  }

  #openVideo(element: ExtensionElement, node: XmlElement, parent: ExtensionElement | undefined, context: ExtensionValidationContext): void {
    if (element.local === "video" && this.#urlActive) {
      this.#currentVideo = {
        path: element.path,
        seenChildren: new Set(),
        lastChildOrder: -1,
        restrictionRelationship: undefined,
        platformRelationship: undefined,
        uploaderInfo: undefined,
        contentSegmentLocCount: 0,
        tvShowPath: undefined,
        tagCount: 0,
      };
    }
    if (DEPRECATED_VIDEO_TAGS.has(element.local)) this.#add(context, "GOOGLE_VIDEO_TAG_DEPRECATED", `video:${element.local} has been removed from Google's video sitemap documentation.`, element.path, VIDEO_SPEC, "warning");
    if (!KNOWN_VIDEO_TAGS.has(element.local)) this.#add(context, "GOOGLE_VIDEO_UNKNOWN_TAG", `video:${element.local} is not a recognized Google video sitemap tag.`, element.path, VIDEO_SPEC, "warning");

    const video = this.#currentVideo;
    if (!video || element.local === "video") return;
    if (parent?.uri === VIDEO_NS && parent.local === "video" && KNOWN_VIDEO_TAGS.has(element.local)) {
      this.#validateOrder(video, VIDEO_CHILD_ORDER, "GOOGLE_VIDEO_ELEMENT_OUT_OF_ORDER", element, context);
      if (!VIDEO_REPEATABLE_TAGS.has(element.local)) {
        if (video.seenChildren.has(element.local)) this.#add(context, "GOOGLE_VIDEO_ELEMENT_DUPLICATE", `video:${element.local} can appear only once in a video:video entry.`, element.path, VIDEO_SPEC);
        video.seenChildren.add(element.local);
      }
      if (element.local === "player_loc") {
        for (const attribute of Object.values(node.attributes)) {
          if (DEPRECATED_VIDEO_PLAYER_LOC_ATTRIBUTES.has(attribute.local)) this.#add(context, "GOOGLE_VIDEO_TAG_DEPRECATED", `video:player_loc @${attribute.local} has been removed from Google's video sitemap documentation.`, `${element.path}/@${attribute.local}`, VIDEO_SPEC, "warning");
        }
        const allowEmbed = getAttribute(node.attributes, "allow_embed");
        if (allowEmbed !== undefined && !isVideoYesNo(allowEmbed)) this.#add(context, "GOOGLE_VIDEO_PLAYER_ALLOW_EMBED_INVALID", "video:player_loc @allow_embed must be yes or no, using a case variant allowed by the video sitemap XSD.", `${element.path}/@allow_embed`, VIDEO_XSD);
      }
    }

    if (element.local === "restriction") video.restrictionRelationship = getAttribute(node.attributes, "relationship");
    if (element.local === "platform") video.platformRelationship = getAttribute(node.attributes, "relationship");
    if (element.local === "uploader") video.uploaderInfo = getAttribute(node.attributes, "info");
    if (element.local === "content_segment_loc") {
      video.contentSegmentLocCount += 1;
      const duration = getAttribute(node.attributes, "duration");
      if (duration !== undefined && (!/^\d+$/.test(duration) || Number(duration) > 28_800)) this.#add(context, "GOOGLE_VIDEO_CONTENT_SEGMENT_DURATION_INVALID", "video:content_segment_loc @duration must be a non-negative integer no greater than 28800.", `${element.path}/@duration`, VIDEO_XSD);
    }
    if (element.local === "id") {
      const type = getAttribute(node.attributes, "type");
      if (!type || !VIDEO_ID_TYPE_VALUES.has(type)) this.#add(context, "GOOGLE_VIDEO_ID_TYPE_INVALID", "video:id must include a type attribute with one of the values defined by the video sitemap XSD.", `${element.path}/@type`, VIDEO_XSD);
    }
    if (element.local === "price") {
      this.#currentVideoPrice = { path: element.path, currency: getAttribute(node.attributes, "currency"), type: getAttribute(node.attributes, "type"), resolution: getAttribute(node.attributes, "resolution") };
    }
    if (element.local === "tvshow") video.tvShowPath = element.path;
  }

  #closeVideo(element: ExtensionElement, text: string, parentUrlLoc: string | undefined, context: ExtensionValidationContext): void {
    const video = this.#currentVideo;
    if (video) {
      const fields: Partial<Record<string, keyof VideoEntry>> = {
        thumbnail_loc: "thumbnailLoc", title: "title", description: "description", content_loc: "contentLoc", player_loc: "playerLoc",
        duration: "duration", expiration_date: "expirationDate", publication_date: "publicationDate", rating: "rating",
        view_count: "viewCount", family_friendly: "familyFriendly", live: "live", requires_subscription: "requiresSubscription",
        restriction: "restrictionValue", gallery_loc: "galleryLoc", category: "category", platform: "platformValue", uploader: "uploader",
        show_title: "tvShowShowTitle", video_type: "tvShowVideoType", season_number: "tvShowSeasonNumber",
        episode_number: "tvShowEpisodeNumber", premier_date: "tvShowPremierDate",
      };
      const field = fields[element.local];
      if (field) (video as unknown as Record<string, unknown>)[field] = text;
      if (element.local === "tag") video.tagCount += 1;
      if (element.local === "content_segment_loc") context.validateLoc(text, element.path, { enforceSitemapLocation: false, allowedProtocols: VIDEO_ALLOWED_PROTOCOLS });
      if (element.local === "price" && this.#currentVideoPrice) {
        this.#validateVideoPrice({ ...this.#currentVideoPrice, value: text }, context);
        this.#currentVideoPrice = undefined;
      }
    }
    if (element.local === "video" && video) {
      this.#validateVideo(video, parentUrlLoc, context);
      this.#currentVideo = undefined;
    }
  }

  #validateVideo(entry: VideoEntry, parentUrlLoc: string | undefined, context: ExtensionValidationContext): void {
    for (const [value, label] of [[entry.thumbnailLoc, "video:thumbnail_loc"], [entry.title, "video:title"], [entry.description, "video:description"]] as const) {
      if (!value) this.#add(context, "GOOGLE_VIDEO_REQUIRED_FIELD", `video:video must contain ${label}.`, entry.path, VIDEO_SPEC);
    }
    if (!entry.contentLoc && !entry.playerLoc) this.#add(context, "GOOGLE_VIDEO_LOCATION_REQUIRED", "video:video must contain either video:content_loc or video:player_loc.", entry.path, VIDEO_SPEC);
    if (entry.contentLoc !== undefined && entry.contentLoc === parentUrlLoc) this.#add(context, "GOOGLE_VIDEO_CONTENT_LOC_EQUALS_PAGE_LOC", "video:content_loc must not be the same URL as the parent page loc.", `${entry.path}/video:content_loc`, VIDEO_SPEC);
    if (entry.contentLoc !== undefined && hasUnsupportedVideoContentLocFormat(entry.contentLoc)) this.#add(context, "GOOGLE_VIDEO_CONTENT_LOC_FORMAT_UNSUPPORTED", "video:content_loc should point directly to a supported video file, not an HTML page or Flash file.", `${entry.path}/video:content_loc`, VIDEO_SPEC);
    if (entry.contentSegmentLocCount > 0 && !entry.playerLoc) this.#add(context, "GOOGLE_VIDEO_CONTENT_SEGMENT_REQUIRES_PLAYER_LOC", "video:content_segment_loc can be used only in conjunction with video:player_loc.", `${entry.path}/video:content_segment_loc`, VIDEO_XSD);
    if (entry.playerLoc !== undefined && entry.playerLoc === parentUrlLoc) this.#add(context, "GOOGLE_VIDEO_PLAYER_LOC_EQUALS_PAGE_LOC", "video:player_loc must not be the same URL as the parent page loc.", `${entry.path}/video:player_loc`, VIDEO_SPEC);
    if (entry.title !== undefined && entry.title.length > 100) this.#add(context, "GOOGLE_VIDEO_TITLE_TOO_LONG", "video:title must be no more than 100 characters.", `${entry.path}/video:title`, VIDEO_XSD);
    if (entry.description !== undefined && entry.description.length > 2_048) this.#add(context, "GOOGLE_VIDEO_DESCRIPTION_TOO_LONG", "video:description must be no more than 2048 characters.", `${entry.path}/video:description`, VIDEO_SPEC);
    if (entry.duration !== undefined && (!/^(?:[1-9]\d*)$/.test(entry.duration) || Number(entry.duration) > 28_800)) this.#add(context, "GOOGLE_VIDEO_DURATION_INVALID", "video:duration must be an integer number of seconds from 1 to 28800.", `${entry.path}/video:duration`, VIDEO_SPEC);
    if (entry.category !== undefined && entry.category.length > 256) this.#add(context, "GOOGLE_VIDEO_CATEGORY_TOO_LONG", "video:category must be no more than 256 characters when the legacy XSD field is used.", `${entry.path}/video:category`, VIDEO_XSD);
    if (entry.rating !== undefined && (entry.rating.length === 0 || Number.isNaN(Number(entry.rating)) || Number(entry.rating) < 0 || Number(entry.rating) > 5)) this.#add(context, "GOOGLE_VIDEO_RATING_INVALID", "video:rating must be a number from 0.0 to 5.0.", `${entry.path}/video:rating`, VIDEO_SPEC);
    if (entry.viewCount !== undefined && (!/^\d+$/.test(entry.viewCount) || Number(entry.viewCount) < 0)) this.#add(context, "GOOGLE_VIDEO_VIEW_COUNT_INVALID", "video:view_count must be a non-negative integer.", `${entry.path}/video:view_count`, VIDEO_SPEC);
    if (entry.familyFriendly !== undefined && !isVideoYesNo(entry.familyFriendly)) this.#add(context, "GOOGLE_VIDEO_FAMILY_FRIENDLY_INVALID", "video:family_friendly must be yes or no, using a case variant allowed by the video sitemap XSD.", `${entry.path}/video:family_friendly`, VIDEO_SPEC);
    if (entry.live !== undefined && !isVideoYesNo(entry.live)) this.#add(context, "GOOGLE_VIDEO_LIVE_INVALID", "video:live must be yes or no, using a case variant allowed by the video sitemap XSD.", `${entry.path}/video:live`, VIDEO_SPEC);
    if (entry.requiresSubscription !== undefined && !isVideoYesNo(entry.requiresSubscription)) this.#add(context, "GOOGLE_VIDEO_REQUIRES_SUBSCRIPTION_INVALID", "video:requires_subscription must be yes or no, using a case variant allowed by the video sitemap XSD.", `${entry.path}/video:requires_subscription`, VIDEO_SPEC);
    this.#validateRelationship(entry.restrictionRelationship, entry.restrictionValue, "restriction", "GOOGLE_VIDEO_RESTRICTION_RELATIONSHIP_INVALID", context, entry.path);
    if (entry.restrictionValue !== undefined && !isSpaceSeparatedIso3166List(entry.restrictionValue)) this.#add(context, "GOOGLE_VIDEO_RESTRICTION_COUNTRY_INVALID", "video:restriction must contain a space-delimited list of ISO 3166 alpha-2 country codes.", `${entry.path}/video:restriction`, VIDEO_SPEC);
    this.#validateRelationship(entry.platformRelationship, entry.platformValue, "platform", "GOOGLE_VIDEO_PLATFORM_RELATIONSHIP_INVALID", context, entry.path);
    if (entry.platformValue !== undefined && !isSpaceSeparatedVideoPlatformList(entry.platformValue)) this.#add(context, "GOOGLE_VIDEO_PLATFORM_VALUE_INVALID", "video:platform must contain web, mobile, tv, or a space-delimited combination of those values.", `${entry.path}/video:platform`, VIDEO_SPEC);
    if (entry.uploader !== undefined && entry.uploader.length > 255) this.#add(context, "GOOGLE_VIDEO_UPLOADER_TOO_LONG", "video:uploader must be no more than 255 characters.", `${entry.path}/video:uploader`, VIDEO_SPEC);
    if (entry.uploaderInfo !== undefined) {
      context.validateLoc(entry.uploaderInfo, `${entry.path}/video:uploader/@info`, { enforceSitemapLocation: false });
      if (parentUrlLoc && !hasSameHostname(entry.uploaderInfo, parentUrlLoc)) this.#add(context, "GOOGLE_VIDEO_UPLOADER_INFO_DOMAIN_INVALID", "video:uploader info must be on the same domain as the parent page loc.", `${entry.path}/video:uploader/@info`, VIDEO_SPEC);
    }
    if (entry.tagCount > 32) this.#add(context, "GOOGLE_VIDEO_TAG_LIMIT_EXCEEDED", "video:video must not contain more than 32 video:tag elements.", `${entry.path}/video:tag`, VIDEO_SPEC);
    this.#validateVideoTvShow(entry, context);
    if (entry.expirationDate !== undefined) this.#validateDate(context, entry.expirationDate, `${entry.path}/video:expiration_date`, "GOOGLE_VIDEO_EXPIRATION_DATE_INVALID", "video:expiration_date must use W3C date or datetime format; datetime values must include seconds and a timezone.", VIDEO_SPEC, true);
    if (entry.publicationDate !== undefined) this.#validateDate(context, entry.publicationDate, `${entry.path}/video:publication_date`, "GOOGLE_VIDEO_PUBLICATION_DATE_INVALID", "video:publication_date must use W3C date or datetime format; datetime values must include seconds and a timezone.", VIDEO_SPEC, true);
    for (const [value, label] of [[entry.thumbnailLoc, "thumbnail_loc"], [entry.contentLoc, "content_loc"], [entry.playerLoc, "player_loc"], [entry.galleryLoc, "gallery_loc"]] as const) {
      if (value !== undefined) context.validateLoc(value, `${entry.path}/video:${label}`, { enforceSitemapLocation: false, allowedProtocols: VIDEO_ALLOWED_PROTOCOLS });
    }
  }

  #validateRelationship(relationship: string | undefined, value: string | undefined, label: string, code: string, context: ExtensionValidationContext, path: string): void {
    if (!relationship && value !== undefined) this.#add(context, code, `video:${label} must include a relationship attribute.`, `${path}/video:${label}/@relationship`, VIDEO_SPEC);
    if (relationship && relationship !== "allow" && relationship !== "deny") this.#add(context, code, `video:${label} relationship must be allow or deny.`, `${path}/video:${label}/@relationship`, VIDEO_SPEC);
  }

  #validateVideoPrice(entry: VideoPriceEntry, context: ExtensionValidationContext): void {
    const hasValue = entry.value.length > 0;
    const invalid = (hasValue && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(entry.value))
      || (entry.currency !== undefined && !/^[A-Z]{3}$/.test(entry.currency))
      || (entry.type !== undefined && !VIDEO_PRICE_TYPE_VALUES.has(entry.type))
      || (entry.resolution !== undefined && !VIDEO_PRICE_RESOLUTION_VALUES.has(entry.resolution))
      || (hasValue && entry.currency === undefined)
      || (!hasValue && entry.type === undefined);
    if (invalid) context.addDiagnostic({
      code: "GOOGLE_VIDEO_PRICE_INVALID", severity: "error", source: "google",
      message: "video:price must follow the legacy video XSD value, currency, type, and resolution constraints.",
      location: context.location(entry.path), spec: VIDEO_XSD,
      context: { hasValue, currency: entry.currency, type: entry.type, resolution: entry.resolution },
    });
  }

  #validateVideoTvShow(entry: VideoEntry, context: ExtensionValidationContext): void {
    if (!entry.tvShowPath) return;
    if (!entry.tvShowShowTitle) this.#add(context, "GOOGLE_VIDEO_TVSHOW_REQUIRED_FIELD", "video:tvshow must contain video:show_title.", entry.tvShowPath, VIDEO_XSD);
    if (!entry.tvShowVideoType) this.#add(context, "GOOGLE_VIDEO_TVSHOW_REQUIRED_FIELD", "video:tvshow must contain video:video_type.", entry.tvShowPath, VIDEO_XSD);
    else if (!VIDEO_TVSHOW_VIDEO_TYPE_VALUES.has(entry.tvShowVideoType)) this.#add(context, "GOOGLE_VIDEO_TVSHOW_VIDEO_TYPE_INVALID", "video:tvshow/video_type must be one of full, preview, clip, interview, news, or other.", `${entry.tvShowPath}/video:video_type`, VIDEO_XSD);
    for (const [value, label] of [[entry.tvShowSeasonNumber, "season_number"], [entry.tvShowEpisodeNumber, "episode_number"]] as const) {
      if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1)) this.#add(context, "GOOGLE_VIDEO_TVSHOW_NUMBER_INVALID", `video:tvshow/${label} must be an integer greater than or equal to 1.`, `${entry.tvShowPath}/video:${label}`, VIDEO_XSD);
    }
    if (entry.tvShowPremierDate !== undefined) this.#validateDate(context, entry.tvShowPremierDate, `${entry.tvShowPath}/video:premier_date`, "GOOGLE_VIDEO_TVSHOW_PREMIER_DATE_INVALID", "video:tvshow/video:premier_date must use W3C date or datetime format; datetime values must include seconds and a timezone.", VIDEO_XSD, true);
  }

  #openHreflang(element: ExtensionElement, node: XmlElement, context: ExtensionValidationContext): void {
    const rel = getAttribute(node.attributes, "rel");
    const hreflang = getAttribute(node.attributes, "hreflang");
    const href = getAttribute(node.attributes, "href");
    if (rel !== "alternate") this.#add(context, "GOOGLE_HREFLANG_REL_INVALID", "xhtml:link hreflang annotations must use rel=\"alternate\".", element.path, HREFLANG_SPEC);
    if (!hreflang) this.#add(context, "GOOGLE_HREFLANG_REQUIRED", "xhtml:link alternate annotations must include hreflang.", element.path, HREFLANG_SPEC);
    else if (!isValidBcp47LanguageTag(hreflang)) this.#add(context, "GOOGLE_HREFLANG_INVALID", "hreflang must be x-default or a valid-looking language/region code.", element.path, HREFLANG_SPEC);
    else if (!isGoogleSupportedHreflangTag(hreflang)) this.#add(context, "GOOGLE_HREFLANG_UNSUPPORTED_CODE", "hreflang is valid BCP 47, but Google sitemap hreflang supports a two-letter language code with optional script and two-letter region, or x-default.", element.path, HREFLANG_SPEC);
    if (!href) this.#add(context, "GOOGLE_HREFLANG_HREF_REQUIRED", "xhtml:link alternate annotations must include href.", element.path, HREFLANG_SPEC);
    else context.validateLoc(href, `${element.path}/@href`, { enforceSitemapLocation: false });
    this.#hreflangs.push({ hreflang, href, path: element.path });
  }

  #validateHreflangs(loc: string | undefined, path: string, context: ExtensionValidationContext): HreflangAlternate[] | undefined {
    if (this.#hreflangs.length === 0) return undefined;
    const seen = new Set<string>();
    let hasSelfReference = false;
    const locKey = loc ? normalizeUrlKey(loc) : undefined;
    for (const entry of this.#hreflangs) {
      if (entry.href && locKey && normalizeUrlKey(entry.href) === locKey) hasSelfReference = true;
      if (entry.hreflang) {
        const normalized = entry.hreflang.toLowerCase();
        if (seen.has(normalized)) this.#add(context, "GOOGLE_HREFLANG_DUPLICATE", "Each url entry should not repeat the same hreflang value.", entry.path, HREFLANG_SPEC);
        seen.add(normalized);
      }
    }
    if (loc && !hasSelfReference) this.#add(context, "GOOGLE_HREFLANG_SELF_REFERENCE_MISSING", "Each url entry with hreflang annotations must include an alternate link for its own loc URL.", path, HREFLANG_SPEC);
    const alternates = this.#hreflangs.flatMap((entry) => entry.hreflang && entry.href ? [{ hreflang: entry.hreflang, href: entry.href }] : []);
    return alternates.length > 0 ? alternates : undefined;
  }

  #openPageMap(element: ExtensionElement, node: XmlElement, parent: ExtensionElement | undefined, context: ExtensionValidationContext): void {
    if (element.local === "PageMap" && this.#urlActive) this.#currentPageMap = { path: element.path, seenChildren: new Set(), lastChildOrder: -1 };
    if (!KNOWN_PAGEMAP_TAGS.has(element.local)) this.#add(context, "GOOGLE_PAGEMAP_UNKNOWN_TAG", `pagemap:${element.local} is not a recognized Google PageMap sitemap tag.`, element.path, PAGEMAP_XSD, "warning");
    const required = requiredPageMapAttribute(element.local);
    if (required && !getAttribute(node.attributes, required)) this.#add(context, "GOOGLE_PAGEMAP_REQUIRED_ATTRIBUTE", `pagemap:${element.local} must include @${required}.`, `${element.path}/@${required}`, PAGEMAP_XSD);
    const pageMap = this.#currentPageMap;
    if (pageMap && element.local !== "PageMap" && parent?.uri === PAGEMAP_NS && parent.local === "PageMap") {
      this.#validateOrder(pageMap, PAGEMAP_CHILD_ORDER, "GOOGLE_PAGEMAP_ELEMENT_OUT_OF_ORDER", element, context);
      if (element.local === "Template") {
        if (pageMap.seenChildren.has(element.local)) this.#add(context, "GOOGLE_PAGEMAP_ELEMENT_DUPLICATE", "pagemap:Template can appear only once in pagemap:PageMap.", element.path, PAGEMAP_XSD);
        pageMap.seenChildren.add(element.local);
      }
    }
    if (element.local === "Attribute" && pageMap) this.#currentPageMapAttribute = { path: element.path, value: getAttribute(node.attributes, "value") };
  }

  #closePageMap(element: ExtensionElement, text: string, context: ExtensionValidationContext): void {
    if (element.local === "Attribute" && this.#currentPageMapAttribute) {
      const hasText = text.length > 0;
      const hasValue = this.#currentPageMapAttribute.value !== undefined && this.#currentPageMapAttribute.value.length > 0;
      if (hasText === hasValue) this.#add(context, "GOOGLE_PAGEMAP_ATTRIBUTE_VALUE_INVALID", "pagemap:Attribute must include either text content or @value, but not both.", this.#currentPageMapAttribute.path, PAGEMAP_XSD);
      this.#currentPageMapAttribute = undefined;
    }
    if (element.local === "PageMap") this.#currentPageMap = undefined;
  }

  #validateAttributes(element: ExtensionElement, node: XmlElement, context: ExtensionValidationContext): void {
    for (const attribute of Object.values(node.attributes)) {
      if (isSchemaUtilityAttribute(attribute)) continue;
      let allowed = false;
      let code = "";
      if (element.uri === IMAGE_NS) code = "GOOGLE_IMAGE_ATTRIBUTE_UNEXPECTED";
      if (element.uri === NEWS_NS) code = "GOOGLE_NEWS_ATTRIBUTE_UNEXPECTED";
      if (element.uri === VIDEO_NS) { code = "GOOGLE_VIDEO_ATTRIBUTE_UNEXPECTED"; allowed = isAllowedVideoAttribute(element.local, attribute.local); }
      if (element.uri === PAGEMAP_NS) { code = "GOOGLE_PAGEMAP_ATTRIBUTE_UNEXPECTED"; allowed = isAllowedPageMapAttribute(element.local, attribute.local); }
      if (element.uri === XHTML_NS && element.local === "link") { code = "GOOGLE_HREFLANG_ATTRIBUTE_UNEXPECTED"; allowed = isAllowedHreflangAttribute(attribute.local); }
      if (code && !allowed) this.#add(context, code, `Attribute ${attribute.name} is not allowed on this sitemap element.`, `${element.path}/@${attribute.name}`);
    }
  }

  #validateOrder(entry: { lastChildOrder: number }, orderMap: ReadonlyMap<string, number>, code: string, element: ExtensionElement, context: ExtensionValidationContext): void {
    const order = orderMap.get(element.local);
    if (order === undefined) return;
    if (order < entry.lastChildOrder) this.#add(context, code, `${element.local} appears outside the extension schema order.`, element.path);
    if (order > entry.lastChildOrder) entry.lastChildOrder = order;
  }

  #validateDate(context: ExtensionValidationContext, value: string, path: string, code: string, message: string, spec: string, requireTimeSeconds = false): void {
    if (!isValidCompleteW3cDateOrDateTime(value, { requireTimeSeconds })) this.#add(context, code, message, path, spec);
  }

  #add(
    context: ExtensionValidationContext,
    code: string,
    message: string,
    path: string,
    spec?: string,
    severity: "error" | "warning" = "error",
  ): void {
    context.addDiagnostic({ code, severity, source: "google", message, location: context.location(path), spec });
  }
}

export function isExtensionNamespace(uri: string): boolean {
  return uri === IMAGE_NS || uri === NEWS_NS || uri === VIDEO_NS || uri === PAGEMAP_NS || uri === XHTML_NS;
}

export function shouldCollectExtensionText(element: Pick<ExtensionElement, "local" | "uri">): boolean {
  if (element.uri === IMAGE_NS) return element.local === "loc" || element.local === "license";
  if (element.uri === NEWS_NS) return new Set(["name", "language", "access", "genres", "publication_date", "title", "keywords", "stock_tickers"]).has(element.local);
  if (element.uri === VIDEO_NS) return new Set([
    "thumbnail_loc", "title", "description", "content_loc", "content_segment_loc", "player_loc", "duration", "expiration_date",
    "rating", "view_count", "publication_date", "tag", "category", "family_friendly", "restriction", "gallery_loc", "price",
    "requires_subscription", "uploader", "platform", "live", "id", ...VIDEO_TVSHOW_TAGS,
  ]).has(element.local);
  return element.uri === PAGEMAP_NS && element.local === "Attribute";
}

export interface DateTimeValidationOptions {
  requireTimeSeconds?: boolean;
}

export function isValidCompleteW3cDateOrDateTime(value: string, options: DateTimeValidationOptions = {}): boolean {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dateTime = options.requireTimeSeconds
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
    : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
  const match = date.exec(value) ?? dateTime.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidNewsPlacement(local: string, parent: ExtensionElement, grandparent: ExtensionElement | undefined): boolean {
  if (local === "news") return parent.uri === SITEMAP_NS && parent.local === "url";
  if (NEWS_CHILD_ORDER.has(local)) return parent.uri === NEWS_NS && parent.local === "news";
  if (local === "name" || local === "language") return parent.uri === NEWS_NS && parent.local === "publication" && grandparent?.uri === NEWS_NS && grandparent.local === "news";
  return parent.uri === NEWS_NS && (parent.local === "news" || parent.local === "publication");
}

function isValidVideoPlacement(local: string, parent: ExtensionElement): boolean {
  if (parent.uri !== VIDEO_NS) return false;
  if (parent.local === "video") return !VIDEO_TVSHOW_TAGS.has(local);
  return parent.local === "tvshow" && VIDEO_TVSHOW_TAGS.has(local);
}

function isValidPageMapPlacement(local: string, parent: ExtensionElement, grandparent: ExtensionElement | undefined): boolean {
  if (parent.uri !== PAGEMAP_NS) return false;
  if (local === "Template" || local === "DataObject") return parent.local === "PageMap";
  if (local === "Attribute") return parent.local === "DataObject" && grandparent?.uri === PAGEMAP_NS && grandparent.local === "PageMap";
  return parent.local === "PageMap" || parent.local === "DataObject";
}

function isSchemaUtilityAttribute(attribute: XmlAttribute): boolean {
  return attribute.uri === XMLNS_NS || attribute.name === "xmlns" || attribute.name.startsWith("xmlns:") || attribute.uri === XSI_NS;
}

function isAllowedVideoAttribute(element: string, attribute: string): boolean {
  if (element === "player_loc") return attribute === "allow_embed" || attribute === "autoplay";
  if (element === "restriction" || element === "platform") return attribute === "relationship";
  if (element === "uploader") return attribute === "info";
  if (element === "gallery_loc") return attribute === "title";
  if (element === "content_segment_loc") return attribute === "duration";
  if (element === "id") return attribute === "type";
  if (element === "price") return attribute === "currency" || attribute === "type" || attribute === "resolution";
  return false;
}

function isAllowedPageMapAttribute(element: string, attribute: string): boolean {
  if (element === "Template") return attribute === "src";
  if (element === "DataObject") return attribute === "type" || attribute === "id";
  if (element === "Attribute") return attribute === "name" || attribute === "value";
  return false;
}

function isAllowedHreflangAttribute(attribute: string): boolean {
  return attribute === "rel" || attribute === "hreflang" || attribute === "href";
}

function requiredPageMapAttribute(element: string): string | undefined {
  if (element === "Template") return "src";
  if (element === "DataObject") return "type";
  if (element === "Attribute") return "name";
  return undefined;
}

function getAttribute(attributes: Record<string, XmlAttribute>, name: string): string | undefined {
  const attribute = attributes[name];
  return typeof attribute?.value === "string" ? attribute.value : undefined;
}

function normalizeUrlKey(value: string): string {
  try { return new URL(value).href; } catch { return value; }
}

function isValidGoogleNewsLanguage(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "zh-cn" || normalized === "zh-tw") return true;
  if (/^[a-z]{2}$/i.test(value)) return isIso639Alpha2LanguageCode(value);
  return isIso639Alpha3LanguageCode(value);
}

function isValidGoogleNewsGenres(value: string): boolean {
  const allowed = new Set(["PressRelease", "Satire", "Blog", "OpEd", "Opinion", "UserGenerated"]);
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => allowed.has(part));
}

function isValidGoogleNewsStockTickers(value: string): boolean {
  if (value.length === 0) return true;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length <= 5 && parts.every((part) => /^\w+:\w+$/.test(part));
}

function isVideoYesNo(value: string): boolean {
  return value === "yes" || value === "Yes" || value === "YES" || value === "no" || value === "No" || value === "NO";
}

function isSpaceSeparatedIso3166List(value: string): boolean {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => isIso3166Alpha2RegionCode(part));
}

function isSpaceSeparatedVideoPlatformList(value: string): boolean {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => VIDEO_PLATFORM_VALUES.has(part));
}

function hasSameHostname(left: string, right: string): boolean {
  try { return new URL(left).hostname === new URL(right).hostname; } catch { return false; }
}

function hasUnsupportedVideoContentLocFormat(value: string): boolean {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return path.endsWith(".html") || path.endsWith(".htm") || path.endsWith(".swf");
  } catch {
    return false;
  }
}
