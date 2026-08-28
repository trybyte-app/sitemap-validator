import type { LocValidationOptions } from "./loc-rules.js";
import type { HreflangAlternate, SitemapDiagnostic, SourceLocation, ValidationLimits } from "./types.js";
import type { XmlElement } from "./xml-parser.js";
export declare const IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1";
export declare const NEWS_NS = "http://www.google.com/schemas/sitemap-news/0.9";
export declare const VIDEO_NS = "http://www.google.com/schemas/sitemap-video/1.1";
export declare const PAGEMAP_NS = "http://www.google.com/schemas/sitemap-pagemap/1.0";
export declare const XHTML_NS = "http://www.w3.org/1999/xhtml";
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
export declare class ExtensionValidator {
    #private;
    constructor(limits: ValidationLimits);
    startUrl(): void;
    finishUrl(loc: string | undefined, path: string, context: ExtensionValidationContext): HreflangAlternate[] | undefined;
    isTopLevelUrlExtension(element: ExtensionElement, parent: ExtensionElement | undefined): boolean;
    validatePlacement(element: ExtensionElement, parent: ExtensionElement | undefined, grandparent: ExtensionElement | undefined, context: ExtensionValidationContext): void;
    open(element: ExtensionElement, node: XmlElement, parent: ExtensionElement | undefined, context: ExtensionValidationContext): void;
    close(element: ExtensionElement, text: string, parentUrlLoc: string | undefined, context: ExtensionValidationContext): void;
}
export declare function isExtensionNamespace(uri: string): boolean;
export declare function shouldCollectExtensionText(element: Pick<ExtensionElement, "local" | "uri">): boolean;
export interface DateTimeValidationOptions {
    requireTimeSeconds?: boolean;
}
export declare function isValidCompleteW3cDateOrDateTime(value: string, options?: DateTimeValidationOptions): boolean;
