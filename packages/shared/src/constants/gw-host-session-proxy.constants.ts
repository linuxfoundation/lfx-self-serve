// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Constants for the host-session Supabase and Gatewaze API proxies under `/api/gatewaze`
 * (`gatewaze-proxy.controller.ts`). See `docs/architecture/backend/gw-host-session.md`.
 */

/** Log operation name for every proxied request. */
export const GW_HOST_SESSION_PROXY_OPERATION = 'gatewaze_proxy_request';

/** Where the embed's Supabase client points: `supabase.url` is `<origin>/api/gatewaze/supabase`. */
export const GW_HOST_SESSION_PROXY_SUPABASE_MOUNT = '/api/gatewaze/supabase';

/**
 * Query params that can carry a credential on a proxied URL, redacted from LFX's request log, its
 * HTTP spans and Datadog RUM. `token` is a Storage signed-URL token or an edge function's own signed
 * value, and `access_token` the placeholder (or, from an older embed, a real token). The same set
 * as `@gatewaze/host-session`'s `redactUrl`. Mirrored in `apps/lfx-one/otel.mjs`.
 */
export const GW_HOST_SESSION_PROXY_CREDENTIAL_QUERY_PARAMS = ['token', 'access_token', 'refresh_token', 'code'] as const;

/** Where the embed's API calls land: `apiBaseUrl` is `/api/gatewaze`, and it calls `${apiBaseUrl}/api/...`. */
export const GW_HOST_SESSION_PROXY_API_MOUNT = '/api/gatewaze';

/**
 * Client-address headers removed before forwarding, on top of the package's own drop list (cookie,
 * authorization, origin, referer, apikey, host, `x-forwarded-*`, `forwarded`, hop-by-hop). The proxy
 * does not vouch for them. It sends its own `X-Forwarded-For` with the one client address LFX
 * resolved (`req.ip`).
 */
export const GW_HOST_SESSION_PROXY_STRIPPED_REQUEST_HEADERS = [
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'via',
  'x-forwarded-server',
] as const;

/**
 * Upstream response headers returned to the browser. An allowlist, applied after the package's own
 * drop list (`set-cookie`, `x-gw-session`, hop-by-hop). It keeps Supabase's
 * `Access-Control-Allow-*` headers out, because this origin never answers CORS, and leaves out
 * `www-authenticate`, so an upstream cannot raise a browser credential prompt on the LFX origin.
 *
 * The body is forwarded as the upstream sent it, still encoded, so `content-encoding` and
 * `content-length` travel together. `content-range`, `range-unit` and `preference-applied` are what
 * PostgREST uses for counts and `Prefer` answers. `cache-control` and `vary` carry the package's
 * `private` and `Vary: Cookie` on a response made with the user's session.
 */
export const GW_HOST_SESSION_PROXY_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'content-disposition',
  'content-range',
  'accept-ranges',
  'range-unit',
  'preference-applied',
  'location',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'vary',
  'retry-after',
]);

/** The message `@gatewaze/host-session`'s `proxyRequest` rejects with when the upstream socket sits idle past `timeoutMs`. */
export const GW_HOST_SESSION_PROXY_UPSTREAM_TIMED_OUT = 'upstream timed out';

/**
 * Gatewaze API module routes, `/api/modules/<id>/...`. Case-insensitive and tolerant of repeated
 * slashes, because the Gatewaze API (Express 4) routes both ways and the URL parser keeps `//`.
 */
export const GW_HOST_SESSION_PROXY_API_MODULE_PATH = /^\/api\/+modules\/+([^/]+)(?:\/|$)/i;
