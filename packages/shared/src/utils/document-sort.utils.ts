// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MyDocumentItem } from '../interfaces/my-document.interface';

/**
 * Orders documents for display: folders first and alphabetical, then documents by their displayed
 * date, newest first. Undated documents follow every dated one (including dates before the Unix
 * epoch); ties fall back to name, then id, so the order is stable.
 */
export function compareDocumentsByRecency(a: MyDocumentItem, b: MyDocumentItem): number {
  if (!!a.isFolder !== !!b.isFolder) return a.isFolder ? -1 : 1;

  if (!a.isFolder) {
    const aTime = Date.parse(a.date);
    const bTime = Date.parse(b.date);
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (aValid && bValid && aTime !== bTime) return bTime - aTime;
  }

  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
