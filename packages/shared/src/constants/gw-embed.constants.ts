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
export const GW_EMBED_ENABLED_MODULE_IDS: readonly string[] = [
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
];

/**
 * Feature ids enabled inside the modules above, passed as `GwHostContext.enabled.features` and
 * intersected the same narrowing way (an empty array disables every feature).
 *
 * Same rule as the module list: include the features of every module named there, so the embed
 * behaves as it does standalone and Gatewaze's own enablement stays the only thing deciding.
 */
export const GW_EMBED_ENABLED_FEATURES: readonly string[] = [
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
];

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
 * Picks the prefix the given path is mounted under.
 *
 * Falls back to the Foundation Lens prefix so a caller always gets a usable basename, which keeps
 * the embed mountable from a test or a future route without special-casing.
 */
export function resolveGwEmbedRoutePrefix(pathname: string): string {
  return GW_EMBED_ROUTE_PREFIXES.find((prefix) => pathname.startsWith(prefix)) ?? GW_EMBED_ROUTE_PREFIX;
}

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

/** Session lifetime assumed when the LFID fragment carries no usable `expires_in`, in seconds. */
export const GW_EMBED_DEFAULT_SESSION_TTL_S = 3600;

/**
 * Which Gatewaze newsletter template collection an LFX scope publishes with.
 *
 * Keyed by LFX slug — the same slug the sidebar links with (`?project=<slug>`) and the one the
 * staging seed deliberately makes production-faithful, so a mapping written here behaves the same
 * in both places. Values are `newsletters_template_collections.slug` in Gatewaze; each collection
 * already carries its own `git_url`/`git_branch`, so naming the collection is what selects the
 * template repo — LFX never names a repo directly.
 *
 * A CONSTANT ON PURPOSE, and temporary. Assigning foundations and projects to publications belongs
 * in Gatewaze's own data model and lands with multi-brand support after the pilot; until then this
 * is the bridge, and it is deliberately the smallest thing that can express the rule.
 */
export const GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG: Readonly<Record<string, string>> = {
  'agentic-ai-foundation': 'usercommunity',
};

/**
 * Collection used when neither the project nor its foundation names one.
 *
 * Matches the `is_default` collection in Gatewaze rather than hard-coding a brand, so an unmapped
 * scope gets the generic template instead of somebody else's.
 */
export const GW_EMBED_DEFAULT_TEMPLATE_COLLECTION = 'default';

/**
 * Resolves the template collection for the scope currently being viewed.
 *
 * Project first, then its foundation, then the default — a project may publish its own newsletter
 * with its own template, and inherits its foundation's when it does not. Foundation-level scopes
 * simply pass no project slug.
 *
 * Slugs are matched exactly. They come from LFX's own project records rather than user input, and
 * a near-miss should fall through to the foundation or the default rather than be guessed at.
 */
export function resolveGwEmbedTemplateCollection(projectSlug?: string | null, foundationSlug?: string | null): string {
  const fromProject = projectSlug ? GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG[projectSlug] : undefined;
  const fromFoundation = foundationSlug ? GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG[foundationSlug] : undefined;

  return fromProject ?? fromFoundation ?? GW_EMBED_DEFAULT_TEMPLATE_COLLECTION;
}
