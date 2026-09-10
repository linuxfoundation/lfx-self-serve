// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Module ids the embedded Gatewaze admin pilot enables, passed to the embed as
 * `GwHostContext.enabled.moduleIds`.
 *
 * These are NOT arbitrary host-side names — they come from Gatewaze's own module registry and must
 * match the allow-list the embed is compiled against (`gatewaze.embed.config.ts`: newsletters plus
 * its declared dependencies). An id that isn't compiled in is ignored with a console warning rather
 * than being fatal, so a stale entry here degrades quietly.
 *
 * **The overlay narrows, it never widens.** `EmbedModulesProvider` intersects this list with
 * Gatewaze's own DB-backed enablement (`isModuleEnabled: (id) => overlay.has(id) && base.isModuleEnabled(id)`),
 * so an empty array disables *everything* — it does not mean "no restriction". Gatewaze's
 * `installed_modules` state and RLS remain the system of record; this only subtracts from it.
 */
export const GW_EMBED_ENABLED_MODULE_IDS: readonly string[] = ['newsletters', 'content-platform', 'host-media', 'templates', 'editor-ai-copilot'];

/**
 * Feature ids enabled inside the modules above, passed as `GwHostContext.enabled.features` and
 * intersected the same narrowing way (an empty array disables every feature).
 *
 * This is currently the full set the compiled modules declare, so the pilot exercises everything
 * the embed ships. Narrowing to the smaller cohort subset — list, editions, block editor, sends,
 * basic stats, holding back `templates.git-sources` and `content-platform.inbox` — is a one-line
 * edit here and needs no rebuild of the embed.
 */
export const GW_EMBED_ENABLED_FEATURES: readonly string[] = [
  'newsletters',
  'newsletters.editor',
  'newsletters.editions',
  'newsletters.subscribers',
  'newsletters.templates',
  'newsletters.sending',
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
];

/**
 * Where the embed's stylesheet is served from.
 *
 * The embed's Vite lib build runs with `cssCodeSplit: false`, so it emits its CSS as a single
 * `admin-embed.css` file *beside* the JS chunk rather than inlining it — its own build config notes
 * that "the host must load it alongside the JS chunk". The dynamic `import()` of the JS therefore
 * pulls in no styles at all, and the outlet injects a `<link>` to this path instead.
 */
export const GW_EMBED_STYLESHEET_PATH = '/assets/gw/admin-embed.css';
