// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ButtonRootPassThrough } from '../interfaces/components.interface';

/**
 * Resolves the `pt` passthrough object that forwards `aria-pressed` to the native `<button>`
 * PrimeNG's `<p-button>` renders internally.
 *
 * Returns `undefined` — not an object with `aria-pressed: undefined` inside it — when `pressed` is
 * unset, so an ordinary button (the vast majority of `<lfx-button>` usages, which never pass
 * `ariaPressed`) doesn't get handed a `pt` object at all. `undefined` is the "no pt config" value
 * PrimeNG expects; an object carrying an `undefined` value is a different (and version-sensitive)
 * thing — some PrimeNG versions stringify it to the literal attribute `aria-pressed="undefined"`,
 * and PrimeNG merges a component-level `pt.root` shallowly over any global `pt` config's `root`, so
 * an unnecessary object here would still shadow individual global root attributes even though it
 * doesn't replace the config outright.
 */
export function resolveAriaPressedPt(pressed: boolean | undefined): ButtonRootPassThrough | undefined {
  return pressed === undefined ? undefined : { root: { 'aria-pressed': pressed } };
}
