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
  'broadcasts',
  // Capability checks the newsletters and broadcasts UI make via useHasModule,
  // plus broadcasts' declared dependencies (ai, bulk-emailing, segments) and the
  // list module its unsubscribe model ties a send to.
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
  'broadcasts',
  'broadcasts.send',
  'broadcasts.copilot',
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
 * Where the embed's stylesheet is served from.
 *
 * The embed's Vite lib build runs with `cssCodeSplit: false`, so it emits its CSS as a single
 * `admin-embed.css` file *beside* the JS chunk rather than inlining it — its own build config notes
 * that "the host must load it alongside the JS chunk". The dynamic `import()` of the JS therefore
 * pulls in no styles at all, and the outlet injects a `<link>` to this path instead.
 *
 * Note the emitted file is `dist-embed/admin.css`, not `admin-embed.css` — `vite.embed.config.ts`
 * predicts the latter in a comment, but Vite names the lib stylesheet after the package rather than
 * the `fileName` given for the JS entry. Whatever ships it to `public/assets/gw/` renames it.
 */
export const GW_EMBED_STYLESHEET_PATH = '/assets/gw/admin-embed.css';

/**
 * What the embed resolves an empty `apiBaseUrl` to — the same-origin BFF proxy mount.
 *
 * Duplicated from the embed's own `mount()` rather than left implicit, because the host has to
 * pre-seed the runtime-config global before the chunk evaluates and must use the identical value,
 * or the pre-seed and `mount()`'s own write would disagree for the window between them.
 */
export const GW_EMBED_DEFAULT_API_BASE_URL = '/api/gw';

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
 * `<Navigate to="/login">` always falls through to the catch-all and comes back to the host.
 */
export const GW_EMBED_LOGIN_PATH = '/login';

/**
 * Where to send the user after signing in, relative to the prefix.
 *
 * Sign-in cannot return to wherever the user happened to be, because that is usually
 * `GW_EMBED_LOGIN_PATH` — the embed sent them there precisely because they were unauthenticated,
 * and it is a path the embed has no route for. Returning there lands them back on a dead end with a
 * freshly minted session they can't use, so sign-in returns to a real module route instead.
 */
export const GW_EMBED_LANDING_PATH = '/newsletters';

/**
 * Suffix passed as `GwHostContext.storageKeySuffix`, isolating the embedded session from a
 * standalone Gatewaze admin session on the same origin.
 *
 * Passed explicitly rather than left to the embed's default so the host can derive the exact
 * storage key below; the embed's default would work equally well but leaves the host guessing.
 */
export const GW_EMBED_STORAGE_KEY_SUFFIX = 'lfx_embed';

/**
 * Prefix the embed's `configureEmbedSupabase` puts in front of `GW_EMBED_STORAGE_KEY_SUFFIX` when
 * it builds the supabase-js `storageKey`.
 *
 * **This couples the host to an internal detail of the embed.** It exists because the host has to
 * write the session itself (see the outlet's URL bootstrap): the embed's own `detectSessionInUrl`
 * never runs early enough, since its router's catch-all sits outside the auth boundary and hands
 * navigation back to the host before the Supabase client is ever constructed. If the embed changes
 * this prefix, the host silently writes to a key nothing reads — so this belongs in the embed's
 * public contract, and the workaround should be deleted once that lands.
 */
export const GW_EMBED_STORAGE_KEY_PREFIX = 'gatewaze-admin-auth-token-';

/**
 * How long before the outlet will retry reloading onto a real route to recover a stored session.
 *
 * Bounds the recovery in the outlet's `navigateHost` handler: one reload, then fall through to the
 * sign-in prompt, so a session the embed rejects for some other reason cannot reload forever.
 */
export const GW_EMBED_SESSION_RECOVERY_COOLDOWN_MS = 30_000;

/**
 * Sidebar destination for the Project Lens Newsletters entry.
 *
 * MOCK (pilot): this points the project sidebar at the embedded Gatewaze newsletters module rather
 * than LFX's own `/project/newsletters` page. Change it back to that path to restore the original
 * behaviour — nothing else depends on this constant.
 */
/**
 * Sidebar destination for the Foundation Lens Newsletters entry, when the embed is on for this
 * tenant. Mirrors the project pair below; AAIF is a foundation, so this is the mount it actually
 * uses day to day.
 */
export const GW_EMBED_FOUNDATION_NEWSLETTERS_LINK = `${GW_EMBED_ROUTE_PREFIX}${GW_EMBED_LANDING_PATH}`;

/** Foundation Lens Broadcasts entry. LFX has no broadcasts page, so this exists only with the embed on. */
export const GW_EMBED_FOUNDATION_BROADCASTS_LINK = `${GW_EMBED_ROUTE_PREFIX}/broadcasts`;

export const GW_EMBED_PROJECT_NEWSLETTERS_LINK = `${GW_EMBED_PROJECT_ROUTE_PREFIX}${GW_EMBED_LANDING_PATH}`;

/**
 * Sidebar destination for the Project Lens Broadcasts entry.
 *
 * MOCK (pilot): like the Newsletters entry above, this is the embedded Gatewaze module — LFX has no
 * broadcasts page of its own, so removing this item is the way to take it out of the sidebar.
 */
export const GW_EMBED_PROJECT_BROADCASTS_LINK = `${GW_EMBED_PROJECT_ROUTE_PREFIX}/broadcasts`;

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
 * sessionStorage key holding the single-use nonce that binds an LFID sign-in to this browser.
 *
 * Minted in `startSignIn`, required back before any token from the returned URL fragment is
 * adopted — see `GwModuleOutletComponent.consumeSignInState`.
 */
export const GW_EMBED_SIGNIN_STATE_KEY = 'lfx-gw-embed-signin-state';

/** Query parameter the sign-in nonce travels on: out via `return_url`, back on the LFID return. */
export const GW_EMBED_SIGNIN_STATE_PARAM = 'gw_state';

/** sessionStorage key for the one-shot claim on reloading to recover a session. */
export const GW_EMBED_SESSION_RECOVERY_KEY = 'lfx-gw-embed-session-recovery';

/**
 * Marks that an automatic sign-in has already been started in this tab.
 *
 * The embed asks the host to open `/login` on EVERY unauthenticated render, so starting the LFID
 * round trip automatically needs a "we already tried" record or a failure to establish a session
 * becomes an endless redirect through the identity provider. One attempt per tab; after that the
 * user gets the manual panel, which cannot loop.
 *
 * `sessionStorage`, not `localStorage`: the guard should last as long as the tab and no longer, so
 * a genuinely new visit is free to try again.
 */
export const GW_EMBED_AUTO_SIGNIN_KEY = 'lfx-gw-embed-auto-signin-attempted';

/**
 * How many times a tab may start LFID automatically before falling back to the manual panel.
 *
 * Not one. A single attempt makes any transient failure permanent for the life of the tab — a
 * cancelled sign-in, a blip, a misconfiguration fixed a minute later — and a reload does not clear
 * it, because the record is per-tab. The user is then stuck clicking a button that says their LFX
 * session lacks access, which is both wrong and unexplained.
 *
 * Two recovers from one bad attempt without becoming a loop: the failure mode this guards against
 * is unbounded cycling through the identity provider, and a hard ceiling of two redirects is not
 * that. Beyond it the manual panel takes over permanently for the tab, which cannot loop and gives
 * the user something to act on.
 */
export const GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS = 2;

/** Session lifetime assumed when the LFID fragment carries no usable `expires_in`, in seconds. */
export const GW_EMBED_DEFAULT_SESSION_TTL_S = 3600;
