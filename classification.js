export const requestAreas = {
  auth: "Login / SSO",
  page: "Page navigation",
  media: "Images / CDN",
  api: "API",
  other: "Other requests",
};

export const failureTypes = {
  challenge: "Cloudflare challenge",
  block: "Cloudflare block page",
  forbidden: "HTTP 403 · source unverified",
  rate: "Rate limiting",
  cloudflare5xx: "Cloudflare 5xx",
  server: "HTTP 5xx · source unverified",
  cloudflare: "Cloudflare-generated error",
  orb: "Browser blocked (ORB)",
  network: "Other browser / network error",
  http: "Other HTTP error",
};

function requestArea(failure) {
  const { hostname, pathname } = new URL(failure.url);
  if (/^(?:sso|auth)\./.test(hostname)
      || /^\/(?:api\/)?(?:auth|sso|oauth2?|login|sign-?in)(?:\/|$)/i.test(pathname)) return "auth";
  if (hostname === "image-cdn.flowgpt.com" || hostname.endsWith(".image-cdn.flowgpt.com")
      || failure.type === "image" || failure.type === "media") return "media";
  if (failure.type === "main_frame" || failure.type === "sub_frame") return "page";
  if (failure.type === "xmlhttprequest" || /^\/api(?:\/|$)/i.test(pathname)) return "api";
  return "other";
}

export function classifyFailure(failure) {
  const area = requestArea(failure);
  const { status, error, challenge, blockPage, cfErrorType, cfErrorOrigin } = failure;
  const diagnosedByEdge = Boolean(cfErrorType || cfErrorOrigin);
  if (challenge) return { area, kind: "challenge", signal: "cf-mitigated: challenge" };
  if (cfErrorType === "1020") return { area, kind: "block", signal: "Cloudflare error 1020" };
  if (blockPage) return { area, kind: "block", signal: "Cloudflare block page with a matching Ray ID" };
  if (cfErrorType === "1015") return { area, kind: "rate", signal: "Cloudflare error 1015" };
  if (status === 429) return { area, kind: "rate", signal: "HTTP 429" };
  if (status >= 500) {
    return diagnosedByEdge
      ? { area, kind: "cloudflare5xx", signal: "Cloudflare error diagnostic header" }
      : { area, kind: "server", signal: "HTTP " + status + ". Response source is unverified." };
  }
  if (diagnosedByEdge) return { area, kind: "cloudflare", signal: "Cloudflare error diagnostic header" };
  if (status === 403) return { area, kind: "forbidden", signal: "HTTP 403. Response source is unverified." };
  if (error === "net::ERR_BLOCKED_BY_ORB") return { area, kind: "orb", signal: error };
  if (error) return { area, kind: "network", signal: error };
  return { area, kind: "http", signal: "HTTP " + status };
}

export function failurePriority(failure) {
  const { area, kind } = classifyFailure(failure);
  const weight = {
    block: 12, challenge: 12, cloudflare5xx: 9, cloudflare: 8, forbidden: 7,
    rate: 6, server: 5, http: 2, network: 1, orb: 0,
  };
  return weight[kind] + (area === "auth" ? 5 : area === "page" ? 3 : 0);
}
