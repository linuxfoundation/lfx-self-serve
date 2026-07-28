// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** PrimeNG `pt` (passthrough) shape accepted for a Button's root slot. */
export interface ButtonRootPassThrough {
  root: { 'aria-pressed': boolean };
}

/**
 * Resolves the `pt` passthrough object that forwards `aria-pressed` to the native `<button>`
 * PrimeNG's `<p-button>` renders internally.
 *
 * Returns `undefined` — not an object with `aria-pressed: undefined` inside it — when `pressed` is
 * unset, so an ordinary button (the vast majority of `<lfx-button>` usages, which never pass
 * `ariaPressed`) doesn't get handed a `pt` object at all. `undefined` is the "no pt config" value
 * PrimeNG expects; an object carrying an `undefined` value is a different (and version-sensitive)
 * thing — some PrimeNG versions stringify it to the literal attribute `aria-pressed="undefined"`,
 * and a stray `pt` object also pre-empts any global `pt` config for that button.
 */
export function resolveAriaPressedPt(pressed: boolean | undefined): ButtonRootPassThrough | undefined {
  return pressed === undefined ? undefined : { root: { 'aria-pressed': pressed } };
}
