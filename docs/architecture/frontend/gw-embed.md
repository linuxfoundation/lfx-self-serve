# Gatewaze Embed Host

How a React application is mounted inside the Angular app without an iframe, and what the host owes it.

The server half — the `/api/gw/*` proxy, its authorization and header policy — is documented separately in [Gatewaze Embed Proxy](../backend/gw-proxy.md).

## Files

| File                                                    | Role                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `src/app/modules/gw/gw-module-outlet/`                  | The outlet component, template and spec                |
| `src/app/modules/gw/gw.routes.ts`                       | Route definitions for both mounts                      |
| `src/app/shared/guards/gatewaze-embed-enabled.guard.ts` | `CanMatch` flag gate                                   |
| `packages/shared/src/constants/gw-embed.constants.ts`   | Mount prefixes, enabled modules/features, storage keys |
| `packages/shared/src/interfaces/gw-embed.interface.ts`  | The `GwHostContext` mount contract                     |
| `apps/lfx-one/scripts/contain-gw-embed-css.mjs`         | Stylesheet containment build step                      |

## Why embed rather than port

The newsletter module is 22,000+ lines of React including a block editor with ~110 block types. Porting means rebuilding that plus the shared UI layer beneath it. Embedding pays for the integration once — outlet, proxy, auth bootstrap, style containment — and later modules reuse it.

The cost is that two frameworks share one document. Most of what follows is about keeping that from leaking.

## Two mounts, one component

The embed is reachable from two lenses, so `GW_EMBED_ROUTE_PREFIXES` declares both `/foundation/gw` and `/project/gw`, and each is a `**` wildcard route. One component serves both: it resolves its own basename from `window.location.pathname` via `resolveGwEmbedRoutePrefix()` and passes it to the embed as `GwHostContext.basename`, so the embed's router builds links under whichever prefix the user arrived on.

Prefix matching is anchored on a segment boundary everywhere it happens (`pathname === prefix || pathname.startsWith(prefix + '/')`). A bare `startsWith` would match a future `/foundation/gwidgets` and resolve it to the wrong basename. The server anchors its `/api/gw` mount test the same way.

## Mounting is client-only

The outlet follows the same SSR-safe lazy-mount shape as `rich-editor.component.ts`:

- `afterNextRender` + `isPlatformBrowser` — on the server this renders two empty mount points and nothing else.
- `@gatewaze/admin-embed` is a **dynamic `import()`** inside that guard, never a static top-level import, so the React bundle is not pulled into the SSR graph.
- Teardown on `DestroyRef.onDestroy` calls the handle's `unmount()`.

A skeleton shows from the first browser render until the embed mounts or fails, because the bundle is large and the container would otherwise sit empty.

The template carries three mutually exclusive states — loading, sign-in-required, mount-error — rather than a single generic failure.

## Two routers in one document

This is the part most likely to surprise someone.

The embed navigates internally with its **own** `pushState`. Angular never observes those calls, so the Angular Router's idea of the current URL diverges from the address bar as soon as the user moves around inside the embed.

The host syncs in one direction only: on `NavigationEnd`, if the new URL is inside this mount's prefix, it re-dispatches a `popstate` event, which is the only thing the embed's router listens to. A durable `lastSyncedUrl` comparison guards it.

The guard must be durable, not a synchronous re-entrancy flag. Angular wraps its own `popstate` handling in a `setTimeout` (`router2.mjs`, "added in #12160"), so a flag set and cleared around `dispatchEvent` is already cleared when Angular's handler runs. Combined with `onSameUrlNavigation: 'reload'` that produced an unbounded loop: `NavigationEnd → dispatch → same-URL navigation → NavigationEnd`. With the default `'ignore'`, the re-entry is answered with `NavigationSkipped` instead, and the URL comparison is sufficient.

**Known limitation.** Because Angular's URL does not track the embed's `pushState`, a host link whose target equals Angular's _stale_ current URL is skipped entirely — no `NavigationEnd`, nothing to sync. In practice: the sidebar's Newsletters link clicked from inside an edition does nothing. Moving between two different embed URLs works. Fixing it properly means mirroring the embed's navigations into the Angular Router; tracked on #2262.

## Style containment

The embed ships one large stylesheet. Loaded as-is it would restyle the host.

`scripts/contain-gw-embed-css.mjs` transforms the published `admin.css` into `public/assets/gw/admin-embed.css` at build time — a deliberate build step, not runtime work, so the output is deterministic and diffable. It:

- scopes every selector under the embed containers,
- strips root-element rules,
- namespaces keyframes,
- drops `@import`,
- rebases `rem` to the host's 14px root, so the embed does not shrink.

**Portalled content is the hard part**, because it renders outside the outlet's subtree:

- **Radix** components portal to `document.body` by default. The embed build threads a `container` prop so they land inside the scope instead.
- **Puck** portals its overlay to the _editor iframe's_ `<body>`, a sibling of `#frame-root` — hence the fourth arm in the scope selector. Until that was added, the block outline and action bar were invisible: an `outline` referencing an undefined custom property is an invalid declaration, not a fallback.

The LFX theme layer is appended **after** the contained CSS, so its token overrides win on source order without `!important`.

> Every build script (`start`, `build`, `build:development`, `build:staging`, `build:production`, `watch`) runs `build:gw-css` first. It exits non-zero if `@gatewaze/admin-embed/admin.css` cannot be resolved, so a failed `yarn start` immediately after a dependency change usually means the embed package is not installed.

## Sign-in

The embed has its own session, established through LFID. The host drives the round trip:

1. `startSignIn()` sends the user to `GW_LFID_START_URL` with a return URL carrying a single-use nonce (`crypto.randomUUID()`, held in `sessionStorage`).
2. On return, `adoptAuthFragment()` reads the token fragment, **requires the nonce back**, checks the returned account's email against the LFX user, clamps `expires_in`, and writes the session under an isolated storage key.
3. `clearAuthFragment()` removes the fragment, preserving `history.state`.

The nonce is the control that fails closed. Without it, anyone who could get the user to open a crafted link could hand them a Supabase session — the session-fixation hole this replaced.

Two rules about that fragment, both learned the hard way:

- **Never put `window.location.href` into a URL handed onward.** Both `startSignIn`'s return URL and the embed context's `signIn.returnUrl` strip the hash, because a fragment on a query parameter survives into a third party's access logs.
- **Do not clear it early.** Datadog RUM captures `window.location.href` at app init, before the outlet runs, so the tokens would reach analytics. That is fixed by redacting in RUM's `beforeSend` (`redactAuthFragment`), _not_ by clearing the fragment sooner — the outlet still needs to read it.

## Enablement

**Three** gates, all of which must pass:

| Gate                             | Kind                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `GW_EMBED_ALLOWED_PROJECT_SLUGS` | Hard-coded tenant allowlist — currently `agentic-ai-foundation` only |
| `gatewaze-embed-enabled`         | Client flag (`CanMatch`)                                             |
| `LFX_GATEWAZE_EMBED_ENABLED`     | Server env                                                           |

The tenant allowlist is a **data-isolation control, not a rollout convenience**. Gatewaze has no multi-foundation scoping yet — one deployment serves one tenant's content — so opening the embed from another foundation would render _that_ foundation's chrome around AAIF's newsletters. Wrong data under the wrong brand, not an empty state.

It is deliberately a constant rather than a flag: a flag can be switched on for the wrong audience, and there is no correct value here until the engine can resolve content per foundation. `isGwEmbedAllowedForSlug()` fails closed on an absent slug, because not knowing the tenant is exactly the case that renders the wrong one.

Enforced in two places, because the sidebar alone is not enough — the URL is guessable and shareable:

- `sidebar-nav.service.ts` — the Communications entries fall back to LFX's own newsletters page.
- `gatewazeEmbedEnabledGuard` — the route itself refuses, reading `?project=` from the URL (a `CanMatch` guard runs before the route activates, so there is no snapshot to read).

The flag gates below are the rollout half:

| Gate                                               | Effect                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `gatewaze-embed-enabled` (client flag, `CanMatch`) | Route does not match; chunk never fetched; excluded from preloading |
| `LFX_GATEWAZE_EMBED_ENABLED` (server env)          | `/api/gw/*` answers a uniform 404                                   |

Routes additionally run `newsletterAccessGuard` (ED or project writer) and `projectQueryParamGuard`.

Module and feature enablement is passed at runtime through `GwHostContext.enabled`, so toggling what the embed shows needs no rebuild. **The overlay narrows, it never widens** — the embed intersects these lists with its own database-backed enablement, so an empty array disables everything rather than meaning "no restriction". That is why the lists are deliberately exhaustive: omitting a module the embed merely _asks about_ silently removes working features.

## Related

- [Gatewaze Embed Proxy](../backend/gw-proxy.md) — the `/api/gw/*` server half
- [Feature Flags](./feature-flags.md) — OpenFeature wiring the `CanMatch` guard reads
- [Persona × Lens Content Matrix](./persona-content-matrix.md) — which personas see the sidebar entries
