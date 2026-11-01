// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Scrolls `list` just far enough to bring `row` into view. It moves the list only, where `scrollIntoView` would also move the page
 * or a dialog around it. The boxes are measured on screen, so a scaled ancestor (a dialog that scales in) is undone with
 * `offsetHeight`, which is not transformed; `scrollTop` is not scaled either.
 */
export function revealRowInList(row: HTMLElement, list: HTMLElement): void {
  const rowBox = row.getBoundingClientRect();
  const listBox = list.getBoundingClientRect();
  const scale = list.offsetHeight ? listBox.height / list.offsetHeight : 1;
  if (rowBox.top < listBox.top) list.scrollTop -= (listBox.top - rowBox.top) / scale;
  else if (rowBox.bottom > listBox.bottom) list.scrollTop += (rowBox.bottom - listBox.bottom) / scale;
}
