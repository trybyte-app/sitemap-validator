export type LiveFetchAdapter = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ResolveHostAdapter = (hostname: string) => Promise<readonly {
    address: string;
    family: number;
}[]>;
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
export declare function createGuardedLiveFetcher(options: GuardedLiveFetcherOptions): GuardedLiveFetcher;
