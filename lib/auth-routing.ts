const PUBLIC_AUTH_PATHS = ["/sign-in", "/sign-up"] as const;
const PUBLIC_PATH_PREFIXES = [...PUBLIC_AUTH_PATHS, "/share"] as const;
const PUBLIC_METADATA_PATHS = [
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
] as const;

/**
 * Accepts only same-origin, root-relative destinations.
 *
 * Exactly one leading slash is required. Protocol-relative URLs and paths that
 * begin with a backslash after the slash are rejected because browsers can
 * interpret both as cross-origin navigation. Control characters are rejected
 * outright: browsers strip tab/newline/CR before URL resolution, so a value
 * like "/\n/evil.com" would otherwise pass the prefix checks yet resolve
 * protocol-relative.
 */
function sanitizeRedirectUrl(value: string | null | undefined): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/";
  }

  return value;
}

/** Adds a validated destination to an auth-page URL. */
function buildAuthPageUrl(
  pathname: (typeof PUBLIC_AUTH_PATHS)[number],
  redirectUrl: string
): string {
  const searchParams = new URLSearchParams({
    redirect_url: sanitizeRedirectUrl(redirectUrl),
  });

  return `${pathname}?${searchParams.toString()}`;
}

/** Matches public pages and their optional catch-all path segments. */
function isPublicPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    PUBLIC_METADATA_PATHS.some((publicPath) => pathname === publicPath) ||
    pathname.startsWith("/opengraph-image")
  ) {
    return true;
  }

  return PUBLIC_PATH_PREFIXES.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

/** Returns the quality assigned to the most preferred matching media type. */
function getMediaQuality(accept: string, matches: (type: string) => boolean) {
  return accept.split(",").reduce((quality, mediaRange) => {
    const [rawType, ...parameters] = mediaRange.trim().toLowerCase().split(";");
    if (!matches(rawType)) {
      return quality;
    }

    const qualityParameter = parameters.find((parameter) =>
      parameter.trim().startsWith("q=")
    );
    const parsedQuality = qualityParameter
      ? Number.parseFloat(qualityParameter.trim().slice(2))
      : 1;

    return Number.isNaN(parsedQuality)
      ? quality
      : Math.max(quality, parsedQuality);
  }, 0);
}

/** Detects clients that explicitly prefer JSON over an HTML document. */
function acceptsJsonOverHtml(accept: string | null): boolean {
  if (!accept) {
    return false;
  }

  const jsonQuality = getMediaQuality(
    accept,
    (type) => type === "application/json" || type.endsWith("+json")
  );
  const htmlQuality = getMediaQuality(accept, (type) => type === "text/html");

  return jsonQuality > htmlQuality;
}

export {
  acceptsJsonOverHtml,
  buildAuthPageUrl,
  isPublicPath,
  sanitizeRedirectUrl,
};
