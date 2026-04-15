// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toPng } from 'html-to-image';

const IGNORE_CLASS = 'ignore-download';

export async function downloadCardAsImage(element: HTMLElement, filename: string): Promise<void> {
  try {
    const dataUrl = await toPng(element, {
      pixelRatio: 2,
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
