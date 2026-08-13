// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toPng } from 'html-to-image';

const IGNORE_CLASS = 'ignore-download';

/** Optional capture tweaks for `downloadCardAsImage`. */
export interface DownloadCardOptions {
  /**
   * Canvas background color (default: transparent, the historical behavior). Multi-panel
   * dashboards want an explicit background — the captured container is transparent where the
   * page background shows through (single cards are white themselves, so they don't need it).
   */
  backgroundColor?: string;
}

export async function downloadCardAsImage(element: HTMLElement, filename: string, options?: DownloadCardOptions): Promise<void> {
  try {
    // Wait for webfonts so icon-font glyphs (Font Awesome) render in the capture — the browser
    // may still be swapping them in when the export is triggered right after a tab switch.
    await document.fonts.ready;

    const dataUrl = await toPng(element, {
      pixelRatio: 2,
      backgroundColor: options?.backgroundColor,
      filter: (node: HTMLElement) => !node.classList?.contains(IGNORE_CLASS),
    });

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.warn(`[downloadCardAsImage] Failed to export "${filename}":`, error);
  }
}
