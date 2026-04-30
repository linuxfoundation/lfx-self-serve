// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Plausible analytics script URL.
 *
 * The site identity is baked into the script ID itself (`pa-…`), so this
 * value is invariant across all environments — only `environment.plausible.enabled`
 * gates whether the script is actually injected.
 */
export const PLAUSIBLE_SRC = 'https://plausible.io/js/pa-5WzbGW1iBhdv7vxTOxXEQ.js';

/**
 * Domain registered in the Plausible site that owns the script ID above.
 * Forwarded as the `data-domain` attribute on the injected `<script>` tag.
 */
export const PLAUSIBLE_DOMAIN = 'app.lfx.dev';
