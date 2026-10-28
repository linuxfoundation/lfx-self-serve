// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportVoteSlide, voteSlideFileName, voteSlideToast } from './vote-slide.util';

describe('voteSlideFileName', () => {
  it('slugs the vote title and appends -vote-slide', () => {
    expect(voteSlideFileName('Approve the 2027 Budget!')).toBe('approve-the-2027-budget-vote-slide');
  });

  it('falls back to "vote" for an unsluggable title', () => {
    expect(voteSlideFileName('!!!')).toBe('vote-vote-slide');
  });
});

describe('exportVoteSlide', () => {
  const toBlob = vi.fn();
  const el = document.createElement('div');
  const blob = new Blob(['png'], { type: 'image/png' });
  let write: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toBlob.mockResolvedValue(blob);
    write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        public constructor(public readonly items: Record<string, Blob>) {}
      }
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders the slide and copies the PNG to the clipboard', async () => {
    expect(await exportVoteSlide(el, 'budget-vote-slide', toBlob)).toBe('copied');
    expect(toBlob).toHaveBeenCalledWith(el);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('falls back to a named download when the clipboard write is denied', async () => {
    write.mockRejectedValue(new Error('denied'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await exportVoteSlide(el, 'budget-vote-slide', toBlob)).toBe('downloaded');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('reports failure when the render throws', async () => {
    toBlob.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await exportVoteSlide(el, 'x', toBlob)).toBe('failed');
  });
});

describe('voteSlideToast', () => {
  it.each([
    ['copied', 'success', 'Slide copied'],
    ['downloaded', 'info', 'Slide downloaded'],
    ['failed', 'error', "Couldn't create the slide image"],
  ] as const)('maps %s to a %s toast', (result, severity, summary) => {
    expect(voteSlideToast(result)).toMatchObject({ severity, summary });
  });
});
