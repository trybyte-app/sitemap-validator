import { parse as parseLanguageTag } from "bcp-47";
import uri from "uri-js";
import { ISO_15924_SCRIPT_CODES, ISO_639_ALPHA3_LANGUAGE_CODES } from "./standards-data.js";
export function validateUriOrIri(value) {
    const issues = [];
    const parsed = uri.parse(value, { iri: true });
    if (parsed.error) {
        issues.push({
            code: containsNonAscii(value) ? "INVALID_RFC3987_IRI" : "INVALID_RFC3986_URI",
            message: parsed.error,
        });
    }
    if (!parsed.scheme) {
        issues.push({
            code: "URI_MISSING_SCHEME",
            message: "URI/IRI is missing a scheme.",
        });
    }
    if (!parsed.host) {
        issues.push({
            code: "URI_MISSING_HOST",
            message: "URI/IRI is missing a host.",
        });
    }
    return { issues };
}
export function isValidBcp47LanguageTag(value) {
    if (value === "x-default") {
        return true;
    }
    try {
        const parsed = parseLanguageTag(value);
        return Boolean(parsed.language);
    }
    catch {
        return false;
    }
}
export function isGoogleSupportedHreflangTag(value) {
    if (value === "x-default") {
        return true;
    }
    const parsed = parseLanguageTag(value);
    if (!parsed.language || !isIso639Alpha2LanguageCode(parsed.language)) {
        return false;
    }
    if (parsed.region && !isIso3166Alpha2RegionCode(parsed.region)) {
        return false;
    }
    if (parsed.script && !isIso15924ScriptCode(parsed.script)) {
        return false;
    }
    return parsed.extendedLanguageSubtags.length === 0
        && parsed.variants.length === 0
        && parsed.extensions.length === 0
        && parsed.privateuse.length === 0
        && !parsed.irregular
        && !parsed.regular;
}
export function isIso3166Alpha2RegionCode(value) {
    return ISO_3166_ALPHA2_REGION_CODES.has(value.toUpperCase());
}
export function isIso639Alpha2LanguageCode(value) {
    return ISO_639_ALPHA2_LANGUAGE_CODES.has(value.toLowerCase());
}
export function isIso639Alpha3LanguageCode(value) {
    if (!/^[a-z]{3}$/i.test(value)) {
        return false;
    }
    return ISO_639_ALPHA3_LANGUAGE_CODES.has(value.toLowerCase());
}
export function isIso15924ScriptCode(value) {
    if (!/^[a-z]{4}$/i.test(value)) {
        return false;
    }
    const normalized = `${value[0]?.toUpperCase() ?? ""}${value.slice(1).toLowerCase()}`;
    return ISO_15924_SCRIPT_CODES.has(normalized);
}
function containsNonAscii(value) {
    return /[^\u0000-\u007F]/u.test(value);
}
const ISO_639_ALPHA2_LANGUAGE_CODES = new Set([
    "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
    "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
    "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
    "da", "de", "dv", "dz",
    "ee", "el", "en", "eo", "es", "et", "eu",
    "fa", "ff", "fi", "fj", "fo", "fr", "fy",
    "ga", "gd", "gl", "gn", "gu", "gv",
    "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
    "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
    "ja", "jv",
    "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
    "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
    "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
    "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
    "oc", "oj", "om", "or", "os",
    "pa", "pi", "pl", "ps", "pt",
    "qu",
    "rm", "rn", "ro", "ru", "rw",
    "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
    "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
    "ug", "uk", "ur", "uz",
    "ve", "vi", "vo",
    "wa", "wo",
    "xh",
    "yi", "yo",
    "za", "zh", "zu",
]);
const ISO_3166_ALPHA2_REGION_CODES = new Set([
    "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
    "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
    "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
    "DE", "DJ", "DK", "DM", "DO", "DZ",
    "EC", "EE", "EG", "EH", "ER", "ES", "ET",
    "FI", "FJ", "FK", "FM", "FO", "FR",
    "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
    "HK", "HM", "HN", "HR", "HT", "HU",
    "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
    "JE", "JM", "JO", "JP",
    "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
    "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
    "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
    "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
    "OM",
    "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
    "QA",
    "RE", "RO", "RS", "RU", "RW",
    "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
    "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
    "UA", "UG", "UM", "US", "UY", "UZ",
    "VA", "VC", "VE", "VG", "VI", "VN", "VU",
    "WF", "WS",
    "YE", "YT",
    "ZA", "ZM", "ZW",
]);
