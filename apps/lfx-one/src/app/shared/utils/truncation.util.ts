// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Records whether `element`'s text is currently cut off, under `key`, in a set of truncated keys.
 * @description For "tooltip only when truncated" labels: measure on hover/focus, keep the keys whose label
 * overflows, and bind the tooltip text only for those. Returns `keys` itself when nothing changed, so writing
 * the result back into a signal is a no-op in that case.
 */
export function updateTruncatedKeys(keys: ReadonlySet<string>, key: string, element: HTMLElement): ReadonlySet<string> {
  const truncated = element.scrollWidth > element.clientWidth;

  if (truncated === keys.has(key)) {
    return keys;
  }

  const next = new Set(keys);
  if (truncated) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}
