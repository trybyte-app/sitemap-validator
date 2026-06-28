export interface UriValidationIssue {
    code: "INVALID_RFC3986_URI" | "INVALID_RFC3987_IRI" | "URI_MISSING_SCHEME" | "URI_MISSING_HOST";
    message: string;
}
export interface UriValidationResult {
    issues: UriValidationIssue[];
}
export declare function validateUriOrIri(value: string): UriValidationResult;
export declare function isValidBcp47LanguageTag(value: string): boolean;
export declare function isGoogleSupportedHreflangTag(value: string): boolean;
export declare function isIso3166Alpha2RegionCode(value: string): boolean;
export declare function isIso639Alpha2LanguageCode(value: string): boolean;
export declare function isIso639Alpha3LanguageCode(value: string): boolean;
export declare function isIso15924ScriptCode(value: string): boolean;
