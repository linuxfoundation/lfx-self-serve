// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Build a sliding window of page numbers for a pagination bar.
 *
 * - Returns a centered window of `windowSize` pages around `current`.
 * - Clamps to 1 on the left and `total` on the right.
 * - Returns fewer than `windowSize` entries only when `total < windowSize`.
 * - Returns an empty array when `total <= 0`.
 *
 * Example: buildVisiblePages(7, 20, 5) → [5, 6, 7, 8, 9]
 * Example: buildVisiblePages(1, 3, 5)  → [1, 2, 3]
 */
export function buildVisiblePages(current: number, total: number, windowSize: number = 5): number[] {
  if (total <= 0 || windowSize <= 0) {
    return [];
  }
  const count = Math.min(windowSize, total);
  const halfFloor = Math.floor(windowSize / 2);
  const halfCeil = Math.ceil(windowSize / 2);

  let start: number;
  if (total <= windowSize) {
    start = 1;
  } else if (current <= halfCeil) {
    start = 1;
  } else if (current >= total - halfFloor) {
    start = total - windowSize + 1;
  } else {
    start = current - halfFloor;
  }

  return Array.from({ length: count }, (_, i) => start + i);
}
