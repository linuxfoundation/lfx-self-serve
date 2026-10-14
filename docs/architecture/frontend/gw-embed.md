# Gatewaze Embed Host

How a React application is mounted inside the Angular app without an iframe, and what the host owes it.

The server half — the `/api/gatewaze` session routes and proxies, their authorization and header policy — is documented separately in [Gatewaze Host Session](../backend/gw-host-session.md).

## Files

| File                                                       | Role                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `src/app/modules/gw/gw-module-outlet/`                     | The outlet component, template and spec                     |
| `src/app/modules/gw/gw.routes.ts`                          | Route definitions for both mounts                           |
| `src/app/shared/guards/gatewaze-embed-enabled.guard.ts`    | `CanMatch` flag gate                                        |
| `src/app/shared/guards/gw-embed-tenant.guard.ts`           | `CanActivate` tenant allowlist gate                         |
| `packages/shared/src/constants/gw-embed.constants.ts`      | Mount prefixes, enabled modules/features, host-session URLs |
| `packages/shared/src/utils/gw-embed.utils.ts`              | Route-prefix resolution and the tenant allowlist test       |
| `packages/shared/src/interfaces/gw-embed.interface.ts`     | The `GwHostContext` mount contract                          |
| `apps/lfx-one/scripts/lib/contain-gw-embed-css.mjs`        | Stylesheet containment transform                            |
| `src/server/services/gw-embed-stylesheet.service.ts`       | Fetches, scopes, themes and caches the stylesheet           |
| `src/server/controllers/gw-embed-stylesheet.controller.ts` | HTTP boundary for it (`GW_EMBED_STYLESHEET_ROUTE`)          |

## Why embed rather than port

The newsletter module is 22,000+ lines of React including a block editor with ~110 block types. Porting means rebuilding that plus the shared UI layer beneath it. Embedding pays for the integration once — outlet, proxy, auth bootstrap, style containment — and later modules reuse it.

The cost is that two frameworks share one document. Most of what follows is about keeping that from leaking.

## Two mounts, one component

The embed is reachable from two lenses, so `GW_EMBED_ROUTE_PREFIXES` declares both `/foundation/gw` and `/project/gw`, and each is a `**` wildcard route. One component serves both: it resolves its own basename from `window.location.pathname` via `resolveGwEmbedRoutePrefix()` and passes it to the embed as `GwHostContext.basename`, so the embed's router builds links under whichever prefix the user arrived on.

Prefix matching is anchored on a segment boundary everywhere it happens (`pathname === prefix || pathname.startsWith(prefix + '/')`). A bare `startsWith` would match a future `/project/gwidgets` and resolve it to the wrong basename. The server anchors its `/api/gatewaze` mount test the same way.

## Mounting is client-only

The outlet follows the same SSR-safe lazy-mount shape as `rich-editor.component.ts`:

- `afterNextRender` + `isPlatformBrowser` — on the server this renders two empty mount points and nothing else.
- `@gatewaze/admin-embed` is a **dynamic `import()`** inside that guard, never a static top-level import, so nothing of the embed is pulled into the SSR graph.
- Teardown on `DestroyRef.onDestroy` calls the handle's `unmount()`. Calling it before the handle's `ready` promise resolves cancels the mount.

A skeleton shows from the first browser render until the embed mounts or fails, because the bundle is large and the container would otherwise sit empty.

## Where the admin comes from

`@gatewaze/admin-embed` is a small loader, not the admin. The Gatewaze deployment serves a library build of its admin at `GW_EMBED_URL` (e.g. `https://admin.dev.aaif.live/embed`): a `manifest.json` naming the current content-hashed entry and stylesheet, plus the files. The loader reads the manifest, checks that the bundle implements the host contract it was built for, injects the stylesheet, imports the entry and mounts it.

Two consequences:

- Admin changes reach this page on the next load. Gatewaze ships them by deploying its own image; no LFX release is involved.
- The loader is bumped when its host contract changes, or to use a capability the loader checks for. A bundle built for a different contract is refused with `gw_embed_contract_mismatch` rather than mounted, which is the signal that the dependency needs a bump. The `host-session` capability is the second case: it needed loader 1.1.0 with the contract still at 1.

The bundle is served by the same deployment as the API this host proxies to and the database behind it, so the embed can never run ahead of its own backend.

The template carries two mutually exclusive states, loading and the error panel, and the error panel always says which failure it is rather than showing a single generic message.

## Two routers in one document

This is the part most likely to surprise someone.

The embed navigates internally with its **own** `pushState`. Angular never observes those calls, so the Angular Router's idea of the current URL diverges from the address bar as soon as the user moves around inside the embed.

The host syncs in one direction only: on `NavigationEnd`, if the new URL is inside this mount's prefix, it re-dispatches a `popstate` event, which is the only thing the embed's router listens to. A durable `lastSyncedUrl` comparison guards it.

The guard must be durable, not a synchronous re-entrancy flag. Angular wraps its own `popstate` handling in a `setTimeout` (`router2.mjs`, "added in #12160"), so a flag set and cleared around `dispatchEvent` is already cleared when Angular's handler runs. Combined with `onSameUrlNavigation: 'reload'` that produced an unbounded loop: `NavigationEnd → dispatch → same-URL navigation → NavigationEnd`. With the default `'ignore'`, the re-entry is answered with `NavigationSkipped` instead, and the URL comparison is sufficient.

**Known limitation.** Because Angular's URL does not track the embed's `pushState`, a host link whose target equals Angular's _stale_ current URL is skipped entirely — no `NavigationEnd`, nothing to sync. In practice: the sidebar's Newsletters link clicked from inside an edition does nothing. Moving between two different embed URLs works. Fixing it properly means mirroring the embed's navigations into the Angular Router; tracked on #2262.

## Style containment

The embed ships one large stylesheet. Loaded as-is it would restyle the host.

The loader lets the host swap the stylesheet URL it fetches (`GwEmbedSource.resolveStylesheetUrl`). The outlet points it at `GW_EMBED_STYLESHEET_ROUTE` with the hashed file name, and `gw-embed-stylesheet.service.ts` fetches that file from `GW_EMBED_URL`, runs `scripts/lib/contain-gw-embed-css.mjs` over it, appends the theme layer and caches the result by name (the name is content-hashed on the Gatewaze side, so the server cache never goes stale). Browsers get a short `max-age` with `stale-while-revalidate` and an `ETag` rather than an immutable year: the body is LFX output under an upstream-hashed name, so a theme or transform fix must reach users without a URL change. The route is anonymous, so it brakes itself: failed names are remembered for a minute, only a few upstream fetches run at once, the upstream must answer `text/css` within the size cap, and a body with no rules is refused. The transform therefore runs once per Gatewaze release per pod, not in every browser, and no CSS parser ships to the client. It:

- scopes every selector under the embed containers,
- remaps root-element rules (`:root`/`html`/`body`) onto the embed containers so their declarations survive,
- namespaces keyframes,
- drops `@import`,
- freezes `rem` to px at the host's 14px root, so the host document and the Puck editor iframe render at one scale.

The rem rebase is the one worth stating precisely, because the obvious reading of it is backwards. It does **not** stop the embed shrinking — it makes the shrink deliberate and uniform. Gatewaze authored against a 16px root; LFX sets `html { font-size: 14px }`. At 14px the embed's `text-sm` (`0.875rem`) resolves to 12.25px, which is exactly what `text-sm` renders everywhere else in LFX, so the panel matches its surroundings rather than its origin. Freezing to px also pins the Puck preview iframe, whose own root is the browser default 16px — without it the same declaration would render at 14px there and 12.25px in the host. See `REM_BASELINE_PX` in `scripts/lib/contain-gw-embed-css.mjs`.

**Portalled content is the hard part**, because it renders outside the outlet's subtree:

- **Radix** components portal to `document.body` by default. The embed build threads a `container` prop so they land inside the scope instead.
- **Puck** portals its overlay to the _editor iframe's_ `<body>`, a sibling of `#frame-root` — hence the fourth arm in the scope selector. Until that was added, the block outline and action bar were invisible: an `outline` referencing an undefined custom property is an invalid declaration, not a fallback.

The LFX theme layer (`src/styles/gw-embed-theme.css`) is appended **after** the contained CSS, so its token overrides win on source order without `!important`. The build copies it beside the server bundle (see the `build` script and the Dockerfile), and `scripts/check-gw-embed-palette.spec.mjs` keeps its hard-coded colours bound to `lfxColors`.

## Session

The embed runs only in host-session mode. LFX One holds the Gatewaze session on the server, keyed off the LFX session cookie (see [Gatewaze Host Session](../backend/gw-host-session.md)). The browser holds no Gatewaze token, so nothing is stored in `localStorage` and nothing arrives on the URL.

`RuntimeConfig.gwHostSession` says whether the mode is on and fully configured. The server computes it with the same check its `/api/gatewaze` routes use, so the outlet and the routes cannot disagree. While it is false the outlet does not mount the embed and shows its not-configured panel, because every `/api/gatewaze` call would answer the uniform 404.

The outlet passes this context to the loader:

| Field                | Value                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session`            | `{ mode: 'host', meUrl: '/api/gatewaze/session/me', logoutUrl: '/api/gatewaze/session/logout' }`                                                                    |
| `supabase.url`       | `<page origin>/api/gatewaze/supabase`, the LFX proxy for REST, Storage and Functions (`gatewaze-proxy.controller.ts`) and Realtime (`gatewaze-realtime.service.ts`) |
| `supabase.publicUrl` | `GW_SUPABASE_URL`, so saved public storage URLs point at Supabase and not at LFX                                                                                    |
| `supabase.anonKey`   | The publishable key                                                                                                                                                 |
| `apiBaseUrl`         | `/api/gatewaze`. The embed calls `${apiBaseUrl}/api/...`, which lands on the `/api/gatewaze/api` proxy                                                              |

It never passes the embed's `signIn` or `storageKeySuffix` fields. With them set, an embed would keep its own session in `localStorage`.

Other rules:

- The outlet never starts a sign-in. When a proxied call reports the session expired, the embed reloads the page, at most twice in 30 seconds, and LFX's own auth guard handles a dead LFX session from there. A 401 from `/session/me`, or a session still lost after those reloads, sends the embed to `/login`, and the outlet shows the error panel there.
- `supabase.publicUrl` must be https, or http on `localhost`, `127.0.0.1` or `*.localhost`. The server allows a plain http `GW_SUPABASE_URL` outside production, but the embed refuses any other http host with `gw_ctx_supabase.publicUrl_invalid`, and the outlet shows the error panel. A local stack must use a `*.localhost` name (e.g. `http://supabase.aaif.localhost`) or https.
- The loader refuses to mount a bundle whose manifest does not list the `host-session` capability, and reports `gw_embed_capability_missing`. A bundle older than the mode would ignore `session` and keep its own token in `localStorage`. The outlet treats that error as terminal whatever its `recoverable` flag says, shows the error panel and logs it with `console.error`. Only a newer Gatewaze deployment fixes it.

This mode needs `@gatewaze/admin-embed` 1.1.0 or later.

## Enablement

**Five** gates, all of which must pass:

| Gate                             | Kind                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GW_EMBED_ALLOWED_PROJECT_SLUGS` | Hard-coded tenant allowlist — currently `agentic-ai-foundation` only                                                        |
| `gatewaze-embed-enabled`         | Client flag (`CanMatch`)                                                                                                    |
| `LFX_GATEWAZE_EMBED_ENABLED`     | Server env                                                                                                                  |
| `LFX_GATEWAZE_HOST_SESSION`      | Server env, plus the host-session config it needs (see [Gatewaze Host Session](../backend/gw-host-session.md#feature-flag)) |
| `GW_EMBED_URL`                   | Server env; where the loader fetches the admin from. Empty = the outlet refuses to mount                                    |

The tenant allowlist is a **data-isolation control, not a rollout convenience**. Gatewaze has no multi-foundation scoping yet — one deployment serves one tenant's content — so opening the embed from another foundation would render _that_ foundation's chrome around AAIF's newsletters. Wrong data under the wrong brand, not an empty state.

It is deliberately a constant rather than a flag: a flag can be switched on for the wrong audience, and there is no correct value here until the engine can resolve content per foundation. `isGwEmbedAllowedForSlug()` fails closed on an absent slug, because not knowing the tenant is exactly the case that renders the wrong one.

Enforced in two places, because the sidebar alone is not enough — the URL is guessable and shareable:

- `sidebar-nav.service.ts` — the Communications entries fall back to LFX's own newsletters page.
- `gwEmbedTenantGuard` — a `CanActivate` guard on both mounts; the route itself refuses.

**The guard decides on the route snapshot, not on `ProjectContextService`**, and that distinction is the whole correctness of it. Two earlier versions got it wrong from opposite directions:

1. Reading `?project=` off `window.location` in a `CanMatch` guard — `CanMatch` runs before the URL settles, so it saw the previous route's query string.
2. Reading the resolved context, on the assumption that listing the guard after `projectQueryParamGuard` in `canActivate` made it run afterwards. It does not. Angular subscribes every same-route guard in one tick via `prioritizedGuardValue()` (`combineLatest` over the guard array), so array order decides only which _failing_ result wins, never execution order. This guard is synchronous and `projectQueryParamGuard` is not, so it always won the race and read the cookie-seeded selection — the tenant being navigated **away from**.

That second version was wrong in both directions at once: it admitted a non-allowed tenant whenever the cookie happened to hold AAIF, and refused a shared `?project=agentic-ai-foundation` link whenever it did not. The route snapshot carries the tenant being navigated **to**, which is the only thing worth deciding on; `newsletterAccessGuard` reads the route for the same reason (GH-1570). The context is consulted only when the route names no project — a direct hit on the bare mount — and the guard fails closed when neither is available.

The flag gates below are the rollout half:

| Gate                                               | Effect                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `gatewaze-embed-enabled` (client flag, `CanMatch`) | Route does not match; chunk never fetched; excluded from preloading                |
| `LFX_GATEWAZE_EMBED_ENABLED` (server env)          | `/api/gatewaze/*` answers a uniform 404                                            |
| `LFX_GATEWAZE_HOST_SESSION` (server env)           | `/api/gatewaze/*` answers a uniform 404; the outlet shows its not-configured panel |

Routes additionally run `newsletterAccessGuard` (ED or project writer) and `projectQueryParamGuard`.

Module and feature enablement is passed at runtime through `GwHostContext.enabled`, so toggling what the embed shows needs no rebuild. **The overlay narrows, it never widens** — the embed intersects these lists with its own database-backed enablement, so an empty array disables everything rather than meaning "no restriction". That is why the lists are deliberately exhaustive: omitting a module the embed merely _asks about_ silently removes working features.

## Related

- [Gatewaze Host Session](../backend/gw-host-session.md) — the `/api/gatewaze` server half
- [Feature Flags](./feature-flags.md) — OpenFeature wiring the `CanMatch` guard reads
- [Persona × Lens Content Matrix](./persona-content-matrix.md) — which personas see the sidebar entries
