// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Declarations for contain-gw-embed-css.mjs so the server (TypeScript) can import the same
 * transform the build script and its spec use. Kept next to the module rather than converting it:
 * the spec runs it under plain Node without a compile step.
 */
export const SCOPE: string;
export const NAME_PREFIX: string;
export const REM_BASELINE_PX: number;

export interface ContainCssResult {
  css: string;
  stats: { rules: number; keyframes: number; dropped: number; remValues: number };
  keyframeNames: Set<string>;
  compoundRootSelectors: Set<string>;
}

export function containCss(css: string): ContainCssResult;
