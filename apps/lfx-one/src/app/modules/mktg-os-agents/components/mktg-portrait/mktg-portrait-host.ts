// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The host style of every grammar and book component (a frame, a cover, an opener, a back cover, a book and each of
 * its page components, the framework print host). Angular leaves a host element `display: inline`; Google Chrome 156
 * (the editor's engine; the bundled Chromium does not reproduce it) breaks a sheet at the anonymous-block boundary an
 * inline host puts around a block frame, which is where the blank sheets came from. In the component's own styles, not
 * a utility class, so it holds in any document the component is cloned into.
 */
export const MKTG_PORTRAIT_BLOCK_HOST = ':host { display: block; }';
