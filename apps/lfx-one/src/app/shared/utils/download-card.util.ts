// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toPng } from 'html-to-image';

import type { DownloadCardOptions } from '@lfx-one/shared/interfaces';

const IGNORE_CLASS = 'ignore-download';

/** Exports the element as a PNG download; resolves false (and warns) when capture fails so callers can surface it. */
export async function downloadCardAsImage(element: HTMLElement, filename: string, options?: DownloadCardOptions): Promise<boolean> {
  try {
    // Wait for webfonts so icon-font glyphs (Font Awesome) render in the capture. `document.fonts`
    // is absent in older WebViews / jsdom — the capture still works there, just without the wait.
    if (document.fonts?.ready) await document.fonts.ready;

    const dataUrl = await toPng(element, {
      pixelRatio: 2,
      backgroundColor: options?.backgroundColor,
      filter: (node: HTMLElement) => !node.classList?.contains(IGNORE_CLASS),
    });

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
    return true;
  } catch (error) {
    console.warn(`[downloadCardAsImage] Failed to export "${filename}":`, error);
    return false;
  }
}
