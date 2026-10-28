// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_SLIDE_HEIGHT_PX, VOTE_SLIDE_WIDTH_PX } from '@lfx-one/shared/constants';
import type { VoteSlideExportResult, VoteSlideRenderer } from '@lfx-one/shared/interfaces';
import { slugify } from '@lfx-one/shared/utils';
import type { ToastMessageOptions } from 'primeng/api';

async function renderSlideToBlob(element: HTMLElement): Promise<Blob | null> {
  const { toBlob } = await import('html-to-image');
  if (document.fonts?.ready) await document.fonts.ready;
  return toBlob(element, { width: VOTE_SLIDE_WIDTH_PX, height: VOTE_SLIDE_HEIGHT_PX, pixelRatio: 1, backgroundColor: 'white' });
}

/** `<vote-slug>-vote-slide` — the download name without extension. */
export function voteSlideFileName(voteName: string): string {
  return `${slugify(voteName) || 'vote'}-vote-slide`;
}

/** App-toast message for an export result — the slide export never reports inline. */
export function voteSlideToast(result: VoteSlideExportResult): ToastMessageOptions {
  switch (result) {
    case 'copied':
      return { severity: 'success', summary: 'Slide copied', detail: 'Paste it into Slides or PowerPoint.' };
    case 'downloaded':
      return { severity: 'info', summary: 'Slide downloaded', detail: "Your browser couldn't copy the image, so it was saved as a file." };
    default:
      return { severity: 'error', summary: "Couldn't create the slide image", detail: 'Please try again.' };
  }
}

/**
 * Renders the slide element to a 1920×1080 PNG, copies it to the clipboard, and falls back to a download when the
 * browser lacks `ClipboardItem` image support or denies the write. Browser-only; `html-to-image` is dynamic-imported
 * so it stays out of the initial and server bundles. Resolves 'failed' (and warns) if the capture itself fails.
 */
export async function exportVoteSlide(element: HTMLElement, fileName: string, render: VoteSlideRenderer = renderSlideToBlob): Promise<VoteSlideExportResult> {
  let blob: Blob | null;
  try {
    blob = await render(element);
  } catch (error) {
    console.warn(`[exportVoteSlide] Failed to render "${fileName}":`, error);
    return 'failed';
  }
  if (!blob) return 'failed';

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    }
  } catch {
    // Clipboard denied (permissions, non-secure context, unsupported type) — fall through to the download.
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${fileName}.png`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
