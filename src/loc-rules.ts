import { validateSitemapUrlValue } from "./url.js";
import type { SitemapDiagnostic, SourceLocation, ValidationLimits } from "./types.js";

const SITEMAP_LOC_MIN_LENGTH = 12;

export interface LocRuleState {
  limits: Pick<ValidationLimits, "maxLocLength">;
  sitemapLocation: URL | undefined;
  urlsetHost: string | undefined;
  sitemapIndexHost: string | undefined;
}

export interface LocRuleContext {
  addDiagnostic(diagnostic: Omit<SitemapDiagnostic, "sourceId">): void;
  location(path: string): SourceLocation;
}

export interface LocValidationOptions {
  enforceSitemapLocation: boolean;
  allowedProtocols?: readonly string[] | undefined;
}

export function validateLocRule(
  state: LocRuleState,
  context: LocRuleContext,
  value: string,
  path: string,
  source: "sitemaps.org" | "google",
  options: LocValidationOptions,
): URL | undefined {
  if (source === "sitemaps.org" && value.length < SITEMAP_LOC_MIN_LENGTH) {
    context.addDiagnostic({
      code: "LOC_TOO_SHORT",
      severity: "error",
      source: "sitemaps.org",
      message: `loc must contain at least ${SITEMAP_LOC_MIN_LENGTH} characters to satisfy the sitemap schema.`,
      location: context.location(path),
      spec: "https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd",
    });
  }

  if (value.length > state.limits.maxLocLength) {
    context.addDiagnostic({
      code: "LOC_TOO_LONG",
      severity: "error",
      source: "sitemaps.org",
      message: `loc must not exceed ${state.limits.maxLocLength} characters.`,
      location: context.location(path),
      spec: "https://www.sitemaps.org/protocol.html",
    });
  }

  const result = validateSitemapUrlValue(value, source, {
    allowedProtocols: options.allowedProtocols,
  });

  for (const diagnostic of result.diagnostics) {
    context.addDiagnostic({
      ...diagnostic,
      location: context.location(path),
      context: {
        ...diagnostic.context,
        layer: diagnostic.layer,
        url: result.metadata,
      },
    });
  }

  if (options.enforceSitemapLocation && result.url) {
    validateSitemapLocationConstraints(state, context, result.url, path);
  }

  return result.url;
}

export function validateSingleHostRule(
  state: LocRuleState,
  context: LocRuleContext,
  url: URL | undefined,
  path: string,
  kind: "urlset" | "sitemapindex",
): void {
  if (!url) {
    return;
  }

  const host = url.host.toLowerCase();
  const existingHost = kind === "urlset" ? state.urlsetHost : state.sitemapIndexHost;

  if (!existingHost) {
    if (kind === "urlset") {
      state.urlsetHost = host;
    } else {
      state.sitemapIndexHost = host;
    }
    return;
  }

  if (host !== existingHost) {
    context.addDiagnostic({
      code: "SITEMAP_MULTIPLE_HOSTS",
      severity: "error",
      source: "sitemaps.org",
      message: `All ${kind === "urlset" ? "url" : "sitemap index"} locations in one sitemap document must use a single host.`,
      location: context.location(path),
      spec: "https://www.sitemaps.org/protocol.html",
      context: {
        expectedHost: existingHost,
        actualHost: host,
      },
    });
  }
}

function validateSitemapLocationConstraints(
  state: LocRuleState,
  context: LocRuleContext,
  url: URL,
  path: string,
): void {
  if (!state.sitemapLocation) {
    return;
  }

  const sitemapUrl = state.sitemapLocation;

  if (url.protocol !== sitemapUrl.protocol || url.host !== sitemapUrl.host) {
    context.addDiagnostic({
      code: "URL_OUTSIDE_SITEMAP_HOST",
      severity: "error",
      source: "sitemaps.org",
      message: "URL must use the same protocol and host as the sitemap location.",
      location: context.location(path),
      spec: "https://www.sitemaps.org/protocol.html",
    });
  }

  const prefix = sitemapUrl.pathname.endsWith("/")
    ? sitemapUrl.pathname
    : sitemapUrl.pathname.slice(0, sitemapUrl.pathname.lastIndexOf("/") + 1);

  if (!url.pathname.startsWith(prefix)) {
    context.addDiagnostic({
      code: "URL_OUTSIDE_SITEMAP_PATH",
      severity: "error",
      source: "sitemaps.org",
      message: "URL path must be at or below the sitemap file path.",
      location: context.location(path),
      spec: "https://www.sitemaps.org/protocol.html",
    });
  }
}
