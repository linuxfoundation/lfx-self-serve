// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Saves a Blob to the user's device through a temporary anchor click. Browser-only: callers guard with `isPlatformBrowser`.
 * @description The object URL is revoked after a delay, not synchronously — iOS Safari and Firefox can cancel the download
 * when the URL disappears in the same task as the click.
 */
export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
