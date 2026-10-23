// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Module ids the embedded Gatewaze admin pilot enables, passed to the embed as
 * `GwHostContext.enabled.moduleIds`.
 *
 * **The overlay narrows, it never widens.** `EmbedModulesProvider` intersects this list with
 * Gatewaze's own DB-backed enablement (`isModuleEnabled: (id) => overlay.has(id) && base.isModuleEnabled(id)`),
 * so an empty array disables *everything* — it does not mean "no restriction". Gatewaze's
 * `installed_modules` state and RLS remain the system of record; this only subtracts from it.
 *
 * That makes the list easy to get wrong in a way that fails silently. It must cover two groups:
 *
 * 1. The modules compiled into the embed (`gatewaze.embed.config.ts`) — newsletters and its
 *    declared dependencies. These own the routes the pilot renders.
 * 2. Every module the compiled UI *asks about* via `useHasModule`. These need no compiled code,
 *    but omitting one makes its check return false and quietly removes working features — which
 *    is exactly how the embed lost the edition Sending tab, Replies, Stats and the Substack and
 *    Beehiiv actions while the standalone admin showed them all.
 *
 * Listing a module that is disabled in Gatewaze is harmless: the intersection keeps it off, and it
 * turns on by itself the day someone enables it there. So the second group is deliberately
 * exhaustive rather than trimmed to what happens to be enabled today.
 */
export const GW_EMBED_ENABLED_MODULE_IDS = [
  // Compiled into the embed.
  'newsletters',
  'content-platform',
  'host-media',
  'templates',
  'editor-ai-copilot',
  // Broadcasts is deliberately absent. It shares the newsletter module's editor and send path, so
  // enabling it looked like free reuse rather than a second product surface — but #2261 asks for
  // the newsletter module "with no second module included" and #2260 puts every other module out
  // of pilot scope, so shipping it would have been a scope change made in a constant.
  //
  // Capability checks the newsletters UI makes via useHasModule, plus the send path's own
  // dependencies and the list module its unsubscribe model ties a send to. These stay: newsletters
  // needs them whether or not broadcasts is enabled.
  'bulk-emailing',
  'ai',
  'segments',
  'lists',
  'newsletters-output-substack',
  'newsletters-output-beehiiv',
  'redirects-bitly',
  'redirects-shortio',
  'redirects-umami',
] as const;

/**
 * Feature ids enabled inside the modules above, passed as `GwHostContext.enabled.features` and
 * intersected the same narrowing way (an empty array disables every feature).
 *
 * Same rule as the module list: include the features of every module named there, so the embed
 * behaves as it does standalone and Gatewaze's own enablement stays the only thing deciding.
 */
export const GW_EMBED_ENABLED_FEATURES = [
  'newsletters',
  'newsletters.editor',
  'newsletters.editions',
  'newsletters.subscribers',
  'newsletters.templates',
  'newsletters.sending',
  'newsletters.output.substack',
  'newsletters.output.beehiiv',
  'content-platform',
  'content-platform.inbox',
  'content-platform.admin',
  'host-media',
  'host-media.albums',
  'host-media.youtube',
  'host-media.zip-unpack',
  'host-media.chunked-upload',
  'templates',
  'templates.editor',
  'templates.git-sources',
  'templates.ab.builtin',
  'editor-ai-copilot',
  'bulk-emailing',
  'bulk-emailing.send',
  'bulk-emailing.templates',
  'bulk-emailing.tracking',
  'ai',
  'ai.manage',
  'ai.usage.read',
  'segments',
  'segments.create',
  'segments.manage',
  'lists',
  'lists.manage',
  'lists.webhooks',
  'lists.import',
  'redirects-bitly',
  'redirects-shortio',
  'redirects-umami',
] as const;

/**
 * LFX project/foundation slugs the embed may be shown for.
 *
 * Gatewaze has no multi-foundation scoping yet: one deployment serves one tenant's content. Without
 * this gate, opening the embed from any other foundation would render THAT foundation's chrome
 * around AAIF's newsletters — the wrong data under the wrong brand, not an empty state.
 *
 * So the restriction is a data-isolation control, not a rollout convenience, and it is deliberately
 * a hard-coded constant rather than a flag: a flag can be switched on for the wrong audience, and
 * there is no correct value here until Gatewaze supports scoping.
 *
 * Remove this gate only when the engine can resolve content per foundation. Tracked as the
 * multi-foundation scoping work that follows the pilot.
 */
export const GW_EMBED_ALLOWED_PROJECT_SLUGS = ['agentic-ai-foundation'] as const;

/**
 * Same-origin route that serves the embed's stylesheet scoped to the host chrome. The loader
 * resolves the manifest's hashed stylesheet URL to `<route>/<file name>`; the server fetches that
 * file from `GW_EMBED_URL`, runs the containment transform once and caches it by name (the name
 * is content-hashed, so a cached copy never goes stale).
 */
export const GW_EMBED_STYLESHEET_ROUTE = '/public/api/gw-embed-stylesheet';

/** What a hashed embed stylesheet file name looks like; anything else is rejected by the route. */
export const GW_EMBED_STYLESHEET_NAME_PATTERN = /^admin-embed-[A-Za-z0-9_-]{1,32}\.css$/;

/** How long the upstream stylesheet fetch may take; the file is ~2MB from a CDN-fronted origin. */
export const GW_EMBED_STYLESHEET_UPSTREAM_TIMEOUT_MS = 15_000;

/** Largest upstream stylesheet accepted, in bytes; the real one is ~2.3MB, so this is headroom. */
export const GW_EMBED_STYLESHEET_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Scoped stylesheets kept in memory per server process. Names are content-hashed, so a cached
 * copy never goes stale on the upstream side; the cap only bounds memory across Gatewaze releases.
 */
export const GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES = 4;

/**
 * How long a failed upstream fetch is remembered per name. Without this every distinct valid name
 * would cost a fresh upstream request, and the route is anonymous, so it needs a brake beyond
 * the per-IP limiter.
 */
export const GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS = 60_000;

/**
 * Failed names remembered at once. The route is anonymous and any regex-valid name can be asked
 * for, so without a cap the failure memory would grow with every distinct bad name for the life
 * of the process. Oldest entries go first.
 */
export const GW_EMBED_STYLESHEET_FAILURE_CACHE_MAX_ENTRIES = 64;

/** Upstream fetches allowed at once across all names; requests beyond this get a 503. */
export const GW_EMBED_STYLESHEET_MAX_IN_FLIGHT = 2;

/**
 * Browser/CDN caching for the scoped stylesheet requested WITHOUT the server's key (the fallback
 * form, `<route>/<name>`). The body is LFX output (containment transform plus theme layer) under an
 * upstream-hashed name, so that URL is not content-addressed: a theme or transform fix must reach
 * users without a URL change. Short max-age with stale-while-revalidate and an ETag bound the
 * staleness. Cloudflare in front of the app raises a max-age below the zone's Browser Cache TTL
 * (4 hours) to that TTL, so in practice this form can be stale for up to 4 hours.
 */
export const GW_EMBED_STYLESHEET_MAX_AGE_S = 300;
export const GW_EMBED_STYLESHEET_STALE_WHILE_REVALIDATE_S = 7 * 24 * 60 * 60;

/**
 * Browser/CDN lifetime of the content-addressed form, `<route>/<key>/<name>`: the name carries the
 * upstream content hash and the key carries LFX's own share (theme layer and transform), so the URL
 * names exactly one body and is served `immutable`. Only when the key matches this server's own.
 *
 * A week, not a year. The upstream body is not checked against the hash in its name (the embed
 * build names it with Rollup's `[hash]`, an xxhash this server does not implement), so a bad body Gatewaze served under a valid
 * name would be pinned for this long. A week still spans many visits, and both Gatewaze releases
 * (a new name) and LFX releases that touch the theme or transform (a new key) change the URL long
 * before it runs out. Recovery before then is in `docs/architecture/frontend/gw-embed.md`.
 */
export const GW_EMBED_STYLESHEET_IMMUTABLE_MAX_AGE_S = 7 * 24 * 60 * 60;

/**
 * What the server's stylesheet key looks like (`getGwEmbedStylesheetKey`): base64url, fixed
 * length. Anything else in the key segment is a 404.
 */
export const GW_EMBED_STYLESHEET_KEY_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/**
 * The containment transform's fingerprint: the SHA-256 (hex) of
 * `apps/lfx-one/scripts/lib/contain-gw-embed-css.mjs`. It feeds the stylesheet key, so a transform
 * change gives the scoped stylesheet a new URL instead of leaving browsers on the immutable old one.
 * A spec (`gw-embed.helper.spec.ts`) fails when the file changes without this being updated, and
 * prints the new value.
 *
 * A `postcss` upgrade does not rotate the key; if one changes the output, update this value by hand.
 */
export const GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT = '7a789f6bbb63afd0d5d2abacc2a0c2c03551724421ebb0ae8c2fc4acde62d498';

/**
 * Longest the outlet's own paint check keeps the skeleton up after the loader reports the embed
 * mounted, in ms. After this the embed is shown whatever it holds, so a render that never produces
 * content cannot strand the skeleton. It applies only to bundles without the `first-paint`
 * capability; for those with it the outlet waits on `handle.rendered`, which the loader bounds
 * itself.
 */
export const GW_EMBED_FIRST_PAINT_TIMEOUT_MS = 10_000;

/**
 * Where LFX One serves host-session mode (`gatewaze.route.ts`, mounted in `server.ts`). The
 * Supabase and API proxy mounts under it are `GW_HOST_SESSION_PROXY_SUPABASE_MOUNT` and
 * `GW_HOST_SESSION_PROXY_API_MOUNT` (`gw-host-session-proxy.constants.ts`).
 */
export const GW_EMBED_HOST_SESSION_MOUNT = '/api/gatewaze';

/** `GwHostContext.session.meUrl`: who the Gatewaze session belongs to, or why there is none. */
export const GW_EMBED_HOST_SESSION_ME_URL = `${GW_EMBED_HOST_SESSION_MOUNT}/session/me`;

/** `GwHostContext.session.logoutUrl`: ends the Gatewaze session and leaves the LFX one alone. */
export const GW_EMBED_HOST_SESSION_LOGOUT_URL = `${GW_EMBED_HOST_SESSION_MOUNT}/session/logout`;

/**
 * The loader's `onFatal` code for a hosted bundle whose manifest does not advertise the
 * `host-session` capability. The loader refuses to mount it, because a bundle that predates the
 * mode would ignore `session` and keep its own session in `localStorage`.
 */
export const GW_EMBED_CAPABILITY_MISSING_CODE = 'gw_embed_capability_missing';

/**
 * The manifest capability of a bundle that signals its own first paint, which makes the loader's
 * `handle.rendered` mean "something is on screen". Without it `rendered` resolves with `ready`,
 * before anything is drawn, and the outlet falls back to its own paint check.
 */
export const GW_EMBED_FIRST_PAINT_CAPABILITY = 'first-paint';

/**
 * Classes of the spinner the outlet hands the embed as `GwHostContext.loadingIndicator`, so the
 * embed's loading states look like the rest of LFX. The CSS ring LFX uses for first-paint spinners
 * (`invite.component.html`), not a Font Awesome icon: the kit is deferred, and an icon whose font
 * has not loaded draws nothing (`.claude/rules/styling.md`). 21px, the size `text-2xl` gave the
 * icon. The embed's stylesheet defines `border-blue-200` with Tailwind's own blue, which wins inside
 * the embed root, so the outlet also sets both border colours inline from `lfxColors`.
 */
export const GW_EMBED_LOADING_INDICATOR_CLASS = 'h-6 w-6 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-500 animate-spin';

/**
 * Route prefixes the embed can be mounted under, and the value handed to the embed as
 * `GwHostContext.basename` so both routers agree on where its subtree begins.
 *
 * There is more than one because the same embed is reachable from two lenses: the Foundation Lens
 * route and a Project Lens route that keeps the project sidebar in place. The basename must match
 * whichever path the user actually arrived on, or React Router resolves every route against the
 * wrong root and nothing matches.
 */
export const GW_EMBED_ROUTE_PREFIXES = ['/foundation/gw', '/project/gw'] as const;

/** The Foundation Lens mount — also the fallback when the current URL matches no prefix. */
export const GW_EMBED_ROUTE_PREFIX = GW_EMBED_ROUTE_PREFIXES[0];

/** The Project Lens mount, so the embed can open without leaving the project's sidebar. */
export const GW_EMBED_PROJECT_ROUTE_PREFIX = GW_EMBED_ROUTE_PREFIXES[1];

/**
 * Path (relative to the prefix) the embed navigates to when it has no authenticated user.
 *
 * The embed compiles in module routes only and has no `/login` among them, so its `FeatureGuard`'s
 * `<Navigate to="/login">` always falls through to the catch-all and comes back to the host. The
 * host holds the Gatewaze session, so the outlet answers it with an error panel rather than a
 * sign-in flow.
 */
export const GW_EMBED_LOGIN_PATH = '/login';

/** The embed's landing page, relative to the prefix. The sidebar's Newsletters links point here. */
export const GW_EMBED_LANDING_PATH = '/newsletters';

/**
 * Sidebar destination for the Foundation Lens Newsletters entry, when the embed is on for this
 * tenant. Mirrors the project pair below; AAIF is a foundation, so this is the mount it actually
 * uses day to day.
 */
export const GW_EMBED_FOUNDATION_NEWSLETTERS_LINK = `${GW_EMBED_ROUTE_PREFIX}${GW_EMBED_LANDING_PATH}`;

/**
 * Sidebar destination for the Project Lens Newsletters entry, when the embed is on for this tenant.
 *
 * Not a switch: `buildProjectCommunicationsSection()` chooses between this and LFX's own
 * `/project/newsletters` at runtime, on the pilot flag AND the tenant allowlist. Editing this
 * constant repoints the embed entry; it does not restore the LFX page.
 */
export const GW_EMBED_PROJECT_NEWSLETTERS_LINK = `${GW_EMBED_PROJECT_ROUTE_PREFIX}${GW_EMBED_LANDING_PATH}`;

/**
 * The sidebar destinations that open the embed. Hovering or focusing a link to one of them is the
 * intent signal `GwEmbedWarmupService` warms the Gatewaze session on.
 */
export const GW_EMBED_NAV_LINK_PATHS: readonly string[] = [GW_EMBED_FOUNDATION_NEWSLETTERS_LINK, GW_EMBED_PROJECT_NEWSLETTERS_LINK];

/**
 * Elements that count as painted content in the embed even without text: a loading indicator
 * (`role="status"`, which the embed's `PageLoadingSpinner` carries, or `aria-busy`) or media. Used
 * with any non-whitespace text by the outlet's first-paint check, which must not count the embed's
 * empty provider wrappers. Radix's root `Theme` is one of those and has `min-height: 100vh`, so a
 * child-and-height test passes before anything is drawn.
 */
export const GW_EMBED_PAINTED_CONTENT_SELECTOR = '[role="status"], [aria-busy="true"], img, svg, canvas, video';

/**
 * Maps the embed's notification levels onto PrimeNG toast severities and the summary line LFX
 * shows above the message.
 *
 * The embed sends a single string; LFX's toast is a summary/detail pair, so the summary is
 * supplied here rather than inventing one from the message. 'warning' becomes PrimeNG's 'warn' —
 * the one place the two vocabularies differ.
 */
export const GW_EMBED_NOTIFICATION_SEVERITY = {
  success: { severity: 'success', summary: 'Success' },
  error: { severity: 'error', summary: 'Error' },
  warning: { severity: 'warn', summary: 'Warning' },
  info: { severity: 'info', summary: 'Info' },
} as const;

/** Fallback lifetime for an embed toast that did not ask for one, in ms. */
export const GW_EMBED_NOTIFICATION_DEFAULT_LIFE_MS = 5000;

/**
 * How long one caller's writer summary is reused across proxied `/api/gatewaze/*` calls, in ms.
 *
 * Matched to `PERSONAS_CACHE_TTL_MS` deliberately: the two lookups gate the same decision on the
 * same route, so a shorter window here would just reintroduce the paginated grant sweep this
 * exists to avoid, and a longer one would hold a revoked grant open past the personas that sit
 * beside it. Short enough that an FGA change takes effect within seconds.
 */
export const GW_WRITER_SUMMARY_CACHE_TTL_MS = 15_000;

/** How often expired writer-summary entries are swept, in ms. Matches the persona cache's sweep. */
export const GW_WRITER_SUMMARY_SWEEP_MS = 60_000;

/** Supabase's privileged JWT role claim — such a key must never reach the browser. */
export const SUPABASE_SERVICE_ROLE = 'service_role';

/** Prefix of Supabase's current-format secret key. Opaque, so there are no claims to inspect. */
export const SUPABASE_SECRET_KEY_PREFIX = 'sb_secret_';

/**
 * Cap on how long a rejected `/api/gatewaze/*` proxy request is drained before answering, in ms.
 *
 * The single definition for the whole route: the pre-stream rejections (404 / 403 / fail-closed
 * 5xx) and the controller's 413 drain protocol — which is where the technique came from — both
 * read it. The 413 path briefly carried its own private 5_000 literal, which was the same cap
 * written twice and free to diverge silently.
 *
 * Bounded on purpose: body-parser waits indefinitely for a client to stop sending, whereas a caller
 * still streaming at this cap gets answered anyway. That is a deliberate trade against letting one
 * caller pin a connection for as long as it likes.
 */
export const GW_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Default ceiling on a proxied `/api/gatewaze` request body, in bytes.
 *
 * Overridable per environment via `GW_PROXY_MAX_BODY_BYTES`. Well above the body parsers' 15MB
 * because `host-media` uploads legitimately pass through this route; the point is a bound, not a
 * tight one. `apiRateLimiter` caps request COUNT, not bytes, so it does not cover this.
 */
export const GW_PROXY_DEFAULT_MAX_BODY_BYTES = 100 * 1024 * 1024;

/**
 * Default idle bound on the upstream socket of a proxied `/api/gatewaze` request, in ms.
 *
 * Overridable per environment via `GW_PROXY_TIMEOUT_MS`. It limits how long the socket may sit with
 * no data moving, not the total length of the request, so a slow upload or a long download that
 * keeps moving is not cut off. A hung upstream is, and the caller sees a 408 rather than a hung
 * socket if no response has started.
 */
export const GW_PROXY_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The largest delay Node's timers accept, 2^31-1 ms (about 24.9 days).
 *
 * A delay above this does NOT throw and does NOT saturate — it overflows the 32-bit signed field
 * and fires on the next tick instead. So `GW_PROXY_TIMEOUT_MS=3000000000` reads as "roughly 35
 * days" and behaves as "abort immediately", turning a units typo into an outage that looks like a
 * dead upstream. Timeout overrides above this are rejected and fall back to the default, which is
 * the same degradation every other invalid value in that parser gets.
 */
export const NODE_MAX_TIMER_DELAY_MS = 2_147_483_647;
