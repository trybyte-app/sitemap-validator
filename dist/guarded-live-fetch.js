import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export function createGuardedLiveFetcher(options) {
    const fetchAdapter = options.fetch ?? fetch;
    const resolveHost = options.resolveHost ?? defaultResolveHost;
    return {
        async fetch(rawUrl, request) {
            let currentUrl = parseHttpUrl(rawUrl);
            const redirects = [];
            while (true) {
                await assertFetchAllowed(currentUrl, options.allowPrivateHosts, resolveHost);
                const headers = new Headers(request.headers);
                if (!headers.has("user-agent")) {
                    headers.set("user-agent", options.userAgent);
                }
                const controller = new AbortController();
                const timeout = setTimeout(() => {
                    controller.abort(new Error(`Fetch timeout after ${options.timeoutMs} ms while loading ${currentUrl.href}.`));
                }, options.timeoutMs);
                try {
                    const response = await fetchAdapter(currentUrl.href, {
                        method: request.method,
                        headers,
                        redirect: "manual",
                        signal: controller.signal,
                    });
                    if (request.followRedirects && isRedirectStatus(response.status)) {
                        const location = response.headers.get("location");
                        if (location) {
                            await response.body?.cancel();
                            if (redirects.length >= options.maxRedirects) {
                                throw new Error(`Fetch exceeded ${options.maxRedirects} redirects while loading ${rawUrl}.`);
                            }
                            currentUrl = parseHttpUrl(new URL(location, currentUrl).href);
                            redirects.push(currentUrl.href);
                            continue;
                        }
                    }
                    const bytes = request.maxBytes === undefined
                        ? await discardResponseBody(response)
                        : await readResponseBytes(response, request.maxBytes);
                    return {
                        status: response.status,
                        ok: response.ok,
                        headers: response.headers,
                        bytes,
                        finalUrl: currentUrl.href,
                        redirects,
                    };
                }
                finally {
                    clearTimeout(timeout);
                }
            }
        },
    };
}
function parseHttpUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        throw new Error(`Live fetch URL is not valid: ${rawUrl}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Live fetch URL must use http:// or https://: ${rawUrl}`);
    }
    if (!parsed.hostname) {
        throw new Error(`Live fetch URL must include a hostname: ${rawUrl}`);
    }
    return parsed;
}
async function assertFetchAllowed(url, allowPrivateHosts, resolveHost) {
    if (allowPrivateHosts) {
        return;
    }
    const hostname = stripIpv6Brackets(url.hostname);
    if (isLocalHostname(hostname)) {
        throw new Error(`Refusing to fetch local hostname ${url.hostname}. Pass --allow-private-hosts only when you trust the target.`);
    }
    if (isIP(hostname)) {
        assertPublicIp(hostname, url.href);
        return;
    }
    const records = await resolveHost(hostname);
    if (records.length === 0) {
        throw new Error(`Hostname ${hostname} did not resolve.`);
    }
    for (const record of records) {
        assertPublicIp(record.address, url.href);
    }
}
async function defaultResolveHost(hostname) {
    return lookup(hostname, { all: true, verbatim: true });
}
function assertPublicIp(address, url) {
    if (isNonPublicIp(address)) {
        throw new Error(`Refusing to fetch ${url} because ${address} is private, local, reserved, or non-public. Pass --allow-private-hosts only when you trust the target.`);
    }
}
function stripIpv6Brackets(hostname) {
    return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
}
function isLocalHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "localhost" || normalized.endsWith(".localhost");
}
function isNonPublicIp(address) {
    const normalized = normalizeIpAddress(address);
    const version = isIP(normalized);
    if (version === 4) {
        return isNonPublicIpv4(normalized);
    }
    if (version === 6) {
        return isNonPublicIpv6(normalized);
    }
    return true;
}
function normalizeIpAddress(address) {
    const withoutBrackets = stripIpv6Brackets(address.toLowerCase());
    const zoneIndex = withoutBrackets.indexOf("%");
    return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}
function isNonPublicIpv4(address) {
    const octets = address.split(".").map((part) => Number(part));
    const [first, second, third] = octets;
    if (first === undefined
        || second === undefined
        || third === undefined
        || octets.length !== 4
        || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return true;
    }
    return first === 0
        || first === 10
        || first === 127
        || first >= 224
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 192 && second === 0 && third === 0)
        || (first === 192 && second === 0 && third === 2)
        || (first === 198 && (second === 18 || second === 19))
        || (first === 198 && second === 51 && third === 100)
        || (first === 203 && second === 0 && third === 113);
}
function isNonPublicIpv6(address) {
    const value = parseIpv6Address(address);
    if (value === undefined) {
        return true;
    }
    if (isIpv6InCidr(value, "::ffff:0:0", 96)) {
        const embeddedIpv4 = Number(value & 0xffffffffn);
        return isNonPublicIpv4([
            embeddedIpv4 >>> 24,
            (embeddedIpv4 >>> 16) & 0xff,
            (embeddedIpv4 >>> 8) & 0xff,
            embeddedIpv4 & 0xff,
        ].join("."));
    }
    for (const [cidr, prefixLength, globallyReachable] of IPV6_SPECIAL_PURPOSE_POLICY) {
        if (isIpv6InCidr(value, cidr, prefixLength)) {
            return !globallyReachable;
        }
    }
    return !isIpv6InCidr(value, "2000::", 3);
}
// Ordered from the most specific allocation to the least specific parent.
// Values follow the IANA IPv6 Special-Purpose Address Space registry's
// "Globally Reachable" field. N/A and expired allocations are treated as
// non-public for guarded live fetches.
const IPV6_SPECIAL_PURPOSE_POLICY = [
    ["::", 128, false],
    ["::1", 128, false],
    ["64:ff9b::", 96, true],
    ["64:ff9b:1::", 48, false],
    ["100::", 64, false],
    ["100:0:0:1::", 64, false],
    ["2001:1::1", 128, true],
    ["2001:1::2", 128, true],
    ["2001:1::3", 128, true],
    ["2001:2::", 48, false],
    ["2001:3::", 32, true],
    ["2001:4:112::", 48, true],
    ["2001:10::", 28, false],
    ["2001:20::", 28, true],
    ["2001:30::", 28, true],
    ["2001::", 32, false],
    ["2001::", 23, false],
    ["2001:db8::", 32, false],
    ["2002::", 16, false],
    ["3fff::", 20, false],
    ["5f00::", 16, false],
    ["fc00::", 7, false],
    ["fe80::", 10, false],
    ["ff00::", 8, false],
];
function isIpv6InCidr(value, cidrAddress, prefixLength) {
    const cidrValue = parseIpv6Address(cidrAddress);
    if (cidrValue === undefined) {
        return false;
    }
    const shift = BigInt(128 - prefixLength);
    return (value >> shift) === (cidrValue >> shift);
}
function parseIpv6Address(address) {
    const sections = address.split("::");
    if (sections.length > 2) {
        return undefined;
    }
    const left = parseIpv6Sections(sections[0] ?? "");
    const right = parseIpv6Sections(sections[1] ?? "");
    if (!left || !right) {
        return undefined;
    }
    const omittedCount = sections.length === 2 ? 8 - left.length - right.length : 0;
    if (omittedCount < 0 || (sections.length === 1 && left.length !== 8)) {
        return undefined;
    }
    const words = [...left, ...Array(omittedCount).fill(0), ...right];
    if (words.length !== 8) {
        return undefined;
    }
    return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}
function parseIpv6Sections(value) {
    if (value.length === 0) {
        return [];
    }
    const sections = value.split(":");
    const words = [];
    for (const [index, section] of sections.entries()) {
        if (section.includes(".")) {
            if (index !== sections.length - 1) {
                return undefined;
            }
            const octets = section.split(".").map(Number);
            if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
                return undefined;
            }
            words.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0));
            words.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
            continue;
        }
        if (!/^[0-9a-f]{1,4}$/i.test(section)) {
            return undefined;
        }
        words.push(Number.parseInt(section, 16));
    }
    return words;
}
function isRedirectStatus(status) {
    return status === 301
        || status === 302
        || status === 303
        || status === 307
        || status === 308;
}
async function discardResponseBody(response) {
    await response.body?.cancel();
    return undefined;
}
async function readResponseBytes(response, maxBytes) {
    const reader = response.body?.getReader();
    if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) {
            throw new Error(`Response exceeded ${maxBytes} bytes.`);
        }
        return bytes;
    }
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error(`Response exceeded ${maxBytes} bytes.`);
            }
            chunks.push(value);
        }
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}
