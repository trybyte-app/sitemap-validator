import assert from "node:assert/strict";
import test from "node:test";
import { createGuardedLiveFetcher } from "../dist/guarded-live-fetch.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function createFetcher(options = {}) {
  return createGuardedLiveFetcher({
    fetch: options.fetch ?? (async () => new Response("ok")),
    resolveHost: options.resolveHost ?? publicResolver,
    allowPrivateHosts: options.allowPrivateHosts ?? false,
    timeoutMs: options.timeoutMs ?? 100,
    maxRedirects: options.maxRedirects ?? 5,
    userAgent: "sitemap-validator-test",
  });
}

test("guarded live fetch rejects a redirect to a private target before the second request", async () => {
  let requests = 0;
  const fetcher = createFetcher({
    async fetch() {
      requests += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  });

  await assert.rejects(
    fetcher.fetch("https://example.com/start", {
      method: "GET",
      followRedirects: true,
      maxBytes: 1024,
    }),
    /private, local, reserved, or non-public/,
  );
  assert.equal(requests, 1);
});

test("guarded live fetch follows admitted redirects and reports the final URL", async () => {
  const requested = [];
  const fetcher = createFetcher({
    async fetch(input) {
      const url = String(input);
      requested.push(url);
      return url.endsWith("/start")
        ? new Response(null, { status: 302, headers: { location: "/final" } })
        : new Response("done");
    },
  });
  const result = await fetcher.fetch("https://example.com/start", {
    method: "GET",
    followRedirects: true,
    maxBytes: 16,
  });

  assert.deepEqual(requested, ["https://example.com/start", "https://example.com/final"]);
  assert.equal(result.finalUrl, "https://example.com/final");
  assert.deepEqual(result.redirects, ["https://example.com/final"]);
  assert.equal(new TextDecoder().decode(result.bytes), "done");
});

test("guarded live fetch enforces the redirect limit", async () => {
  const fetcher = createFetcher({
    maxRedirects: 1,
    async fetch(input) {
      const url = new URL(String(input));
      const next = Number(url.searchParams.get("hop") ?? "0") + 1;
      return new Response(null, { status: 302, headers: { location: `/?hop=${next}` } });
    },
  });

  await assert.rejects(
    fetcher.fetch("https://example.com/?hop=0", {
      method: "GET",
      followRedirects: true,
      maxBytes: 16,
    }),
    /exceeded 1 redirects/,
  );
});

test("guarded live fetch rejects non-HTTP URLs before calling the fetch adapter", async () => {
  let requested = false;
  const fetcher = createFetcher({
    async fetch() {
      requested = true;
      return new Response("unexpected");
    },
  });

  await assert.rejects(
    fetcher.fetch("file:///tmp/sitemap.xml", {
      method: "GET",
      followRedirects: true,
    }),
    /must use http:\/\/ or https:\/\//,
  );
  assert.equal(requested, false);
});

test("guarded live fetch rejects reserved IPv4 and IPv6 DNS results", async () => {
  const addresses = [
    "10.0.0.1",
    "169.254.1.1",
    "192.0.2.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ];

  for (const address of addresses) {
    let requested = false;
    const fetcher = createFetcher({
      async fetch() {
        requested = true;
        return new Response("should not run");
      },
      resolveHost: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
    });

    await assert.rejects(
      fetcher.fetch("https://example.com/", { method: "GET", followRedirects: true }),
      /private, local, reserved, or non-public/,
    );
    assert.equal(requested, false);
  }
});

test("guarded live fetch enforces byte limits while reading the response", async () => {
  const fetcher = createFetcher({
    fetch: async () => new Response("12345"),
  });

  await assert.rejects(
    fetcher.fetch("https://example.com/large", {
      method: "GET",
      followRedirects: true,
      maxBytes: 4,
    }),
    /exceeded 4 bytes/,
  );
});

test("guarded live fetch discards unrequested bodies and supplies the configured user agent", async () => {
  let cancelled = false;
  let requestHeaders;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("unused"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher = createFetcher({
    async fetch(_url, init) {
      requestHeaders = new Headers(init.headers);
      return new Response(body, { status: 200 });
    },
  });
  const result = await fetcher.fetch("https://example.com/status", {
    method: "HEAD",
    followRedirects: false,
  });

  assert.equal(result.status, 200);
  assert.equal(result.bytes, undefined);
  assert.equal(cancelled, true);
  assert.equal(requestHeaders.get("user-agent"), "sitemap-validator-test");
});

test("guarded live fetch aborts requests at the configured timeout", async () => {
  const fetcher = createFetcher({
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  });

  await assert.rejects(
    fetcher.fetch("https://example.com/slow", {
      method: "GET",
      followRedirects: true,
    }),
    /abort|timeout/i,
  );
});

test("guarded live fetch keeps the timeout active while reading the body", async () => {
  const fetcher = createFetcher({
    timeoutMs: 5,
    fetch: async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
        },
      });
      return new Response(body);
    },
  });

  await assert.rejects(
    fetcher.fetch("https://example.com/slow-body", {
      method: "GET",
      followRedirects: true,
      maxBytes: 1024,
    }),
    /timeout/i,
  );
});
