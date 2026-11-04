// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { mktgRunAnsweredElsewhereNotice } from './mktg-run-answered-notice.utils';

describe('mktgRunAnsweredElsewhereNotice', () => {
  it('names the answerer a lost send reported, else the shared fallback', () => {
    expect(mktgRunAnsweredElsewhereNotice('Synthetic writer')).toBe(
      'Synthetic writer already answered these — the agent is writing. Your draft is kept below.'
    );
    expect(mktgRunAnsweredElsewhereNotice(null)).toBe('Someone on your team already answered these — the agent is writing. Your draft is kept below.');
  });

  it('says another window when this profile answered the block elsewhere', () => {
    expect(mktgRunAnsweredElsewhereNotice(null, true)).toBe('These were answered in another window — the agent is writing. Your draft is kept below.');
  });

  it('says the asset is ready when the poll found the run already landed', () => {
    expect(mktgRunAnsweredElsewhereNotice(null, false, true)).toBe(
      'Someone on your team already answered these — the asset is ready. Your draft is kept below.'
    );
    expect(mktgRunAnsweredElsewhereNotice(null, true, true)).toBe('These were answered in another window — the asset is ready. Your draft is kept below.');
  });
});
