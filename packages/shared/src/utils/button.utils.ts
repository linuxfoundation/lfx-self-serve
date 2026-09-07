// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ButtonRootPassThrough } from '../interfaces/components.interface';

/**
 * Resolves the `pt` passthrough forwarding `aria-pressed` / `aria-expanded` to the native `<button>`
 * PrimeNG's `<p-button>` renders internally.
 *
 * Returns `undefined` — not an object with undefined values inside it — when both are unset, so an
 * ordinary button (the vast majority of `<lfx-button>` usages) doesn't get handed a `pt` object at all.
 * `undefined` is the "no pt config" value PrimeNG expects; some PrimeNG versions stringify an
 * `undefined` attribute value, and a component-level `pt.root` shallowly shadows individual global
 * `pt` root attributes even though it doesn't replace the config outright.
 */
export function resolveButtonAriaPt(pressed: boolean | undefined, expanded: boolean | undefined): ButtonRootPassThrough | undefined {
  const root: ButtonRootPassThrough['root'] = {};
  if (pressed !== undefined) root['aria-pressed'] = pressed;
  if (expanded !== undefined) root['aria-expanded'] = expanded;
  return Object.keys(root).length === 0 ? undefined : { root };
}
