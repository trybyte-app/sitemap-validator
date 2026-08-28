import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type LiveFetchAdapter = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ResolveHostAdapter = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

export interface GuardedLiveFetcherOptions {
  fetch?: LiveFetchAdapter | undefined;
  resolveHost?: ResolveHostAdapter | undefined;
  allowPrivateHosts: boolean;
  timeoutMs: number;
  maxRedirects: number;
  userAgent: string;
}

export interface GuardedLiveFetchRequest {
  method: string;
  headers?: HeadersInit | undefined;
  followRedirects: boolean;
  maxBytes?: number | undefined;
}

export interface GuardedLiveFetchResult {
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: Uint8Array | undefined;
  finalUrl: string;
  redirects: string[];
}

export interface GuardedLiveFetcher {
  fetch(url: string, request: GuardedLiveFetchRequest): Promise<GuardedLiveFetchResult>;
}

export function createGuardedLiveFetcher(options: GuardedLiveFetcherOptions): GuardedLiveFetcher {
  const fetchAdapter = options.fetch ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolveHost;

  return {
    async fetch(rawUrl, request): Promise<GuardedLiveFetchResult> {
      let currentUrl = parseHttpUrl(rawUrl);
      const redirects: string[] = [];

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
        } finally {
          clearTimeout(timeout);
        }
      }
    },
  };
}

function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
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

async function assertFetchAllowed(
  url: URL,
  allowPrivateHosts: boolean,
  resolveHost: ResolveHostAdapter,
): Promise<void> {
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

async function defaultResolveHost(hostname: string): Promise<readonly { address: string; family: number }[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

function assertPublicIp(address: string, url: string): void {
  if (isNonPublicIp(address)) {
    throw new Error(`Refusing to fetch ${url} because ${address} is private, local, reserved, or non-public. Pass --allow-private-hosts only when you trust the target.`);
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

function isNonPublicIp(address: string): boolean {
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

function normalizeIpAddress(address: string): string {
  const withoutBrackets = stripIpv6Brackets(address.toLowerCase());
  const zoneIndex = withoutBrackets.indexOf("%");
  return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}

function isNonPublicIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  const [first, second, third] = octets;

  if (
    first === undefined
    || second === undefined
    || third === undefined
    || octets.length !== 4
    || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
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

function isNonPublicIpv6(address: string): boolean {
  if (address.startsWith("::ffff:")) {
    return isNonPublicIp(address.slice("::ffff:".length));
  }

  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || address.startsWith("fe8")
    || address.startsWith("fe9")
    || address.startsWith("fea")
    || address.startsWith("feb")
    || address.startsWith("ff")
    || address.startsWith("2001:db8");
}

function isRedirectStatus(status: number): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}

async function discardResponseBody(response: Response): Promise<undefined> {
  await response.body?.cancel();
  return undefined;
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();

  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > maxBytes) {
      throw new Error(`Response exceeded ${maxBytes} bytes.`);
    }

    return bytes;
  }

  const chunks: Uint8Array[] = [];
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
