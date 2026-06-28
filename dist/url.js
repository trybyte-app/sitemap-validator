import { validateUriOrIri } from "./standards.js";
export function validateSitemapUrlValue(value, source, options = {}) {
    const diagnostics = [];
    const allowedProtocols = options.allowedProtocols ?? ["http:", "https:"];
    const isIri = /[^\u0000-\u007F]/u.test(value);
    let url;
    if (/[\u0000-\u001F\u007F]/u.test(value)) {
        diagnostics.push({
            code: "URL_CONTROL_CHARACTER",
            severity: "error",
            source: "rfc3986",
            message: "URL must not contain control characters.",
            spec: "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "rfc3986",
        });
    }
    try {
        url = new URL(value);
    }
    catch {
        diagnostics.push({
            code: "INVALID_ABSOLUTE_URL",
            severity: "error",
            source: source === "google" ? "google" : "rfc3986",
            message: "loc must be a valid absolute URL.",
            spec: source === "google"
                ? "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap"
                : "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "whatwg",
        });
    }
    for (const issue of validateUriOrIri(value).issues) {
        diagnostics.push({
            code: issue.code,
            severity: "error",
            source: issue.code === "INVALID_RFC3987_IRI" ? "rfc3987" : "rfc3986",
            message: issue.message,
            spec: issue.code === "INVALID_RFC3987_IRI"
                ? "https://www.rfc-editor.org/rfc/rfc3987"
                : "https://www.rfc-editor.org/rfc/rfc3986",
            layer: issue.code === "INVALID_RFC3987_IRI" ? "rfc3987" : "rfc3986",
        });
    }
    if (url && !allowedProtocols.includes(url.protocol)) {
        diagnostics.push({
            code: "UNSUPPORTED_URL_SCHEME",
            severity: "error",
            source: "sitemaps.org",
            message: `Sitemap URLs should use ${allowedProtocols.map((protocol) => protocol.replace(":", "")).join(" or ")}.`,
            spec: "https://www.sitemaps.org/protocol.html",
            layer: "sitemap",
        });
    }
    addPercentEncodingDiagnostics(value, diagnostics);
    addUnsafeCharacterDiagnostics(value, diagnostics);
    if (url?.hash) {
        diagnostics.push({
            code: "URL_FRAGMENT_PRESENT",
            severity: "warning",
            source: "sitemaps.org",
            message: "Sitemap URLs should identify crawlable resources; URL fragments are client-side identifiers and are not useful for sitemap discovery.",
            spec: "https://www.sitemaps.org/protocol.html",
            layer: "sitemap",
        });
    }
    if (url?.username || url?.password) {
        diagnostics.push({
            code: "URL_CREDENTIALS_PRESENT",
            severity: "warning",
            source: "rfc3986",
            message: "URL contains userinfo credentials, which is valid URI syntax but inappropriate for sitemap discovery.",
            spec: "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "rfc3986",
        });
    }
    if (url) {
        addHostDiagnostics(url, diagnostics);
    }
    return {
        url,
        metadata: {
            original: value,
            isIri,
            whatwgHref: url?.href,
            protocol: url?.protocol,
            hostname: url?.hostname,
            asciiHostname: url ? toAsciiHostname(url.hostname) : undefined,
            pathname: url?.pathname,
            search: url?.search,
            hash: url?.hash,
        },
        diagnostics,
    };
}
function toAsciiHostname(hostname) {
    try {
        return new URL(`https://${hostname}`).hostname;
    }
    catch {
        return undefined;
    }
}
function addPercentEncodingDiagnostics(value, diagnostics) {
    if (/%(?![0-9A-Fa-f]{2})/.test(value)) {
        diagnostics.push({
            code: "INVALID_PERCENT_ENCODING",
            severity: "error",
            source: "rfc3986",
            message: "URL contains invalid percent encoding.",
            spec: "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "rfc3986",
        });
        return;
    }
    const encodedBytes = [...value.matchAll(/%([0-9A-Fa-f]{2})/g)].map((match) => Number.parseInt(match[1] ?? "0", 16));
    for (const byte of encodedBytes) {
        if (byte <= 0x1F || byte === 0x7F) {
            diagnostics.push({
                code: "URL_PERCENT_ENCODED_CONTROL_CHARACTER",
                severity: "error",
                source: "rfc3986",
                message: "URL contains a percent-encoded control character.",
                spec: "https://www.rfc-editor.org/rfc/rfc3986",
                layer: "rfc3986",
            });
            break;
        }
    }
    if (!hasValidPercentEncodedUtf8Runs(value)) {
        diagnostics.push({
            code: "URL_PERCENT_ENCODING_INVALID_UTF8",
            severity: "error",
            source: "rfc3987",
            message: "URL contains percent-encoded non-ASCII bytes that are not valid UTF-8.",
            spec: "https://www.rfc-editor.org/rfc/rfc3987",
            layer: "rfc3987",
        });
    }
    if (/%25[0-9A-Fa-f]{2}/.test(value)) {
        diagnostics.push({
            code: "URL_SUSPICIOUS_DOUBLE_ENCODING",
            severity: "warning",
            source: "rfc3986",
            message: "URL contains a percent-encoded percent sign followed by hex digits, which may indicate double encoding.",
            spec: "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "rfc3986",
        });
    }
}
function addUnsafeCharacterDiagnostics(value, diagnostics) {
    if (/[\u0020"<>\\^`{|}]/u.test(value)) {
        diagnostics.push({
            code: "URL_UNSAFE_CHARACTER",
            severity: "error",
            source: "rfc3986",
            message: "URL contains characters that must be percent-encoded in a URI.",
            spec: "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "rfc3986",
        });
    }
}
function addHostDiagnostics(url, diagnostics) {
    const asciiHostname = toAsciiHostname(url.hostname);
    if (!asciiHostname) {
        diagnostics.push({
            code: "URL_INVALID_IDN_HOSTNAME",
            severity: "error",
            source: "rfc3987",
            message: "URL hostname cannot be converted to a valid ASCII domain name.",
            spec: "https://www.rfc-editor.org/rfc/rfc3987",
            layer: "rfc3987",
        });
        return;
    }
    if (asciiHostname.length > 253) {
        diagnostics.push({
            code: "URL_HOSTNAME_TOO_LONG",
            severity: "error",
            source: "rfc3986",
            message: "URL hostname exceeds the 253 character DNS length limit.",
            spec: "https://www.rfc-editor.org/rfc/rfc3986",
            layer: "rfc3986",
        });
    }
    for (const label of asciiHostname.split(".")) {
        if (label.length > 63) {
            diagnostics.push({
                code: "URL_HOST_LABEL_TOO_LONG",
                severity: "error",
                source: "rfc3986",
                message: "URL hostname contains a label longer than 63 characters.",
                spec: "https://www.rfc-editor.org/rfc/rfc3986",
                layer: "rfc3986",
            });
            break;
        }
    }
    if (/[^\u0000-\u007F]/u.test(url.hostname) && asciiHostname.includes("xn--")) {
        diagnostics.push({
            code: "URL_IDN_NORMALIZED",
            severity: "info",
            source: "rfc3987",
            message: "URL hostname is an internationalized domain name and normalizes to punycode.",
            spec: "https://www.rfc-editor.org/rfc/rfc3987",
            layer: "rfc3987",
        });
    }
}
function hasValidPercentEncodedUtf8Runs(value) {
    for (const run of value.matchAll(/(?:%[0-9A-Fa-f]{2})+/g)) {
        const bytes = [...run[0].matchAll(/%([0-9A-Fa-f]{2})/g)].map((match) => Number.parseInt(match[1] ?? "0", 16));
        if (!bytes.some((byte) => byte >= 0x80)) {
            continue;
        }
        try {
            const decoder = new TextDecoder("utf-8", { fatal: true });
            decoder.decode(Uint8Array.from(bytes));
        }
        catch {
            return false;
        }
    }
    return true;
}
