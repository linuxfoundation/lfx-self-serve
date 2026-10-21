// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting-attachment.utils imports meeting.utils, which transitively imports @angular/common/http; the
// Angular JIT compiler has to be loaded first when that module runs under Vitest.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { MeetingOccurrence } from '../interfaces';
import { canScopeAttachmentToOccurrence, filterAttachmentsForOccurrence, getAttachmentScope } from './meeting-attachment.utils';

const FUTURE_START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const FUTURE_ID = String(Math.floor(FUTURE_START.getTime() / 1000));
const OTHER_ID = String(Math.floor(FUTURE_START.getTime() / 1000) + 7 * 24 * 60 * 60);

function occurrence(partial: Partial<MeetingOccurrence> = {}): MeetingOccurrence {
  return { occurrence_id: FUTURE_ID, start_time: FUTURE_START.toISOString(), duration: 60, ...partial } as MeetingOccurrence;
}

describe('getAttachmentScope', () => {
  it('is series for an attachment with no occurrence_id', () => {
    expect(getAttachmentScope({})).toBe('series');
    expect(getAttachmentScope({ occurrence_id: '' })).toBe('series');
  });

  it('is occurrence for an attachment scoped to one', () => {
    expect(getAttachmentScope({ occurrence_id: FUTURE_ID })).toBe('occurrence');
  });
});

describe('filterAttachmentsForOccurrence', () => {
  interface Item {
    uid: string;
    occurrence_id?: string;
  }
  const series: Item = { uid: 'series' };
  const mine: Item = { uid: 'mine', occurrence_id: FUTURE_ID };
  const other: Item = { uid: 'other', occurrence_id: OTHER_ID };

  it('keeps series-wide attachments and the ones scoped to the occurrence', () => {
    expect(filterAttachmentsForOccurrence([series, mine, other], FUTURE_ID).map((a) => a.uid)).toEqual(['series', 'mine']);
  });

  it('matches the same occurrence expressed in milliseconds', () => {
    expect(filterAttachmentsForOccurrence([mine], String(Number(FUTURE_ID) * 1000))).toEqual([mine]);
  });

  it('keeps only series-wide attachments when there is no occurrence', () => {
    expect(filterAttachmentsForOccurrence([series, mine, other], null)).toEqual([series]);
    expect(filterAttachmentsForOccurrence([series, mine], undefined)).toEqual([series]);
  });
});

describe('canScopeAttachmentToOccurrence', () => {
  const recurring = { recurrence: { type: 2 } } as never;

  it('allows an upcoming occurrence of a recurring meeting', () => {
    expect(canScopeAttachmentToOccurrence(recurring, occurrence())).toBe(true);
  });

  it('rejects a meeting that does not recur', () => {
    expect(canScopeAttachmentToOccurrence({ recurrence: undefined } as never, occurrence())).toBe(false);
  });

  it('rejects a missing occurrence', () => {
    expect(canScopeAttachmentToOccurrence(recurring, null)).toBe(false);
  });

  it('rejects a cancelled occurrence', () => {
    expect(canScopeAttachmentToOccurrence(recurring, occurrence({ status: 'cancel' }))).toBe(false);
    expect(canScopeAttachmentToOccurrence({ recurrence: { type: 2 }, cancelled_occurrences: [FUTURE_ID] } as never, occurrence())).toBe(false);
  });

  it('rejects an occurrence that already happened', () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(canScopeAttachmentToOccurrence(recurring, occurrence({ start_time: past.toISOString() }))).toBe(false);
  });
});
