// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting-attachment.utils imports meeting.utils, which transitively imports @angular/common/http; the
// Angular JIT compiler has to be loaded first when that module runs under Vitest.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { RecurrenceType } from '../enums';
import { Meeting, MeetingOccurrence } from '../interfaces';
import {
  applyAttachmentScopeOverrides,
  canScopeAttachmentToOccurrence,
  filterAttachmentsForOccurrence,
  getAttachmentScope,
  settledAttachmentScopeOverrides,
} from './meeting-attachment.utils';

const FUTURE_START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const FUTURE_ID = String(Math.floor(FUTURE_START.getTime() / 1000));
const OTHER_ID = String(Math.floor(FUTURE_START.getTime() / 1000) + 7 * 24 * 60 * 60);

function occurrence(partial: Partial<MeetingOccurrence> = {}): MeetingOccurrence {
  return { occurrence_id: FUTURE_ID, start_time: FUTURE_START.toISOString(), duration: 60, ...partial };
}

type AttachmentMeeting = Pick<Meeting, 'recurrence' | 'cancelled_occurrences'>;

/** A weekly recurring meeting unless a test overrides it. */
function meeting(partial: Partial<AttachmentMeeting> = {}): AttachmentMeeting {
  return { recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, ...partial };
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
  const recurring = meeting();

  it('allows an upcoming occurrence of a recurring meeting', () => {
    expect(canScopeAttachmentToOccurrence(recurring, occurrence())).toBe(true);
  });

  it('rejects a meeting that does not recur', () => {
    expect(canScopeAttachmentToOccurrence(meeting({ recurrence: undefined }), occurrence())).toBe(false);
  });

  it('rejects a missing occurrence', () => {
    expect(canScopeAttachmentToOccurrence(recurring, null)).toBe(false);
  });

  it('rejects a cancelled occurrence', () => {
    expect(canScopeAttachmentToOccurrence(recurring, occurrence({ status: 'cancel' }))).toBe(false);
    expect(canScopeAttachmentToOccurrence(meeting({ cancelled_occurrences: [FUTURE_ID] }), occurrence())).toBe(false);
  });

  it('rejects an occurrence that already happened', () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(canScopeAttachmentToOccurrence(recurring, occurrence({ start_time: past.toISOString() }))).toBe(false);
  });
});

describe('attachment scope overrides', () => {
  interface Item {
    uid: string;
    occurrence_id?: string;
  }
  const series: Item = { uid: 'series' };
  const mine: Item = { uid: 'mine', occurrence_id: FUTURE_ID };

  describe('applyAttachmentScopeOverrides', () => {
    it('returns the list untouched when nothing is overridden', () => {
      const list = [series, mine];
      expect(applyAttachmentScopeOverrides(list, new Map())).toBe(list);
    });

    it('shows an attachment saved as scoped to an occurrence with that occurrence', () => {
      const result = applyAttachmentScopeOverrides([series, mine], new Map([['series', OTHER_ID]]));
      expect(result.find((a) => a.uid === 'series')?.occurrence_id).toBe(OTHER_ID);
    });

    it('shows an attachment saved as applying to all occurrences without an occurrence', () => {
      const result = applyAttachmentScopeOverrides([series, mine], new Map([['mine', '']]));
      expect(result.find((a) => a.uid === 'mine')?.occurrence_id).toBeUndefined();
    });

    it('leaves other attachments as they were read', () => {
      const result = applyAttachmentScopeOverrides([series, mine], new Map([['series', OTHER_ID]]));
      expect(result.find((a) => a.uid === 'mine')).toBe(mine);
    });
  });

  describe('settledAttachmentScopeOverrides', () => {
    it('settles an override once the read shows the same occurrence, in seconds or milliseconds', () => {
      expect(settledAttachmentScopeOverrides([mine], new Map([['mine', FUTURE_ID]]))).toEqual(['mine']);
      expect(settledAttachmentScopeOverrides([mine], new Map([['mine', String(Number(FUTURE_ID) * 1000)]]))).toEqual(['mine']);
    });

    it('settles an all-occurrences override once the read has no occurrence', () => {
      expect(settledAttachmentScopeOverrides([series], new Map([['series', '']]))).toEqual(['series']);
    });

    it('keeps an override while the read still shows the old scope', () => {
      expect(settledAttachmentScopeOverrides([mine], new Map([['mine', '']]))).toEqual([]);
      expect(settledAttachmentScopeOverrides([series], new Map([['series', FUTURE_ID]]))).toEqual([]);
    });

    it('ignores attachments with no override', () => {
      expect(settledAttachmentScopeOverrides([series, mine], new Map())).toEqual([]);
    });
  });
});
