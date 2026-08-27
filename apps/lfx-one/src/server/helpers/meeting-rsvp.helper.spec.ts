// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingRegistrant, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here (mirrors meeting.helper.spec.ts / meeting.service.spec.ts), and the
// real `@lfx-one/shared/utils` barrel transitively needs @angular/compiler outside an Angular
// bootstrap. Stub `selectApplicableRsvp` with a faithful reimplementation of the real resolver
// (packages/shared/src/utils/rsvp-calculator.util.ts): most-recently-modified first, a `scope:
// 'all'` entry wins over any `single`/`this_and_following` entry for an unrelated occurrence.
// The resolver's own exhaustive behavior (unit normalization, this_and_following anchors, etc.)
// is covered by rsvp-calculator.util.spec.ts — this stub only needs to preserve the one property
// that attachRsvpsToRegistrants' delegation depends on (LFXV2-2864).
vi.mock('@lfx-one/shared/utils', () => ({
  selectApplicableRsvp: (occurrenceId: string | undefined, rsvps: MeetingRsvp[]): MeetingRsvp | null => {
    if (rsvps.length === 0) return null;
    const sorted = [...rsvps].sort((a, b) => new Date(b.modified_at as string).getTime() - new Date(a.modified_at as string).getTime());
    if (!occurrenceId) return sorted[0];
    for (const rsvp of sorted) {
      if (rsvp.scope === 'all') return rsvp;
      if (rsvp.scope === 'single' && rsvp.occurrence_id === occurrenceId) return rsvp;
    }
    return null;
  },
}));

import { attachRsvpsToRegistrants, filterRsvpsToActiveRegistrants } from './meeting-rsvp.helper';

const registrant = (uid: string): MeetingRegistrant => ({ uid } as MeetingRegistrant);
const rsvp = (overrides: Partial<MeetingRsvp>): MeetingRsvp =>
  ({ registrant_id: 'r1', response_type: 'accepted', ...overrides }) as unknown as MeetingRsvp;

describe('filterRsvpsToActiveRegistrants', () => {
  it('keeps only RSVPs whose registrant_id matches a currently-active registrant', () => {
    const registrants = [registrant('r1'), registrant('r2')];
    const rsvps = [rsvp({ registrant_id: 'r1' }), rsvp({ registrant_id: 'stale-registrant' })];

    const result = filterRsvpsToActiveRegistrants(rsvps, registrants);

    expect(result).toHaveLength(1);
    expect(result[0].registrant_id).toBe('r1');
  });

  it('returns an empty array when no RSVPs match', () => {
    expect(filterRsvpsToActiveRegistrants([rsvp({ registrant_id: 'gone' })], [registrant('r1')])).toEqual([]);
  });
});

describe('attachRsvpsToRegistrants', () => {
  it('attaches null when a registrant has no RSVP', () => {
    const [result] = attachRsvpsToRegistrants([registrant('r1')], []);
    expect(result.rsvp).toBeNull();
  });

  it('attaches the single applicable RSVP when there is exactly one', () => {
    const [result] = attachRsvpsToRegistrants([registrant('r1')], [rsvp({ registrant_id: 'r1', response_type: 'declined' })]);
    expect(result.rsvp?.response_type).toBe('declined');
  });

  it('LFXV2-2864: a newer single decline for an unrelated occurrence does not shadow an older all accept', () => {
    const olderAllAccept = rsvp({
      registrant_id: 'r1',
      scope: 'all' as MeetingRsvp['scope'],
      response_type: 'accepted',
      modified_at: '2026-01-01T00:00:00.000Z',
    });
    const newerSingleDeclineElsewhere = rsvp({
      registrant_id: 'r1',
      scope: 'single' as MeetingRsvp['scope'],
      occurrence_id: 'occurrence-other',
      response_type: 'declined',
      modified_at: '2026-02-01T00:00:00.000Z',
    });

    const [result] = attachRsvpsToRegistrants([registrant('r1')], [olderAllAccept, newerSingleDeclineElsewhere], 'occurrence-target');

    expect(result.rsvp?.response_type).toBe('accepted');
  });

  it('does not mutate the input registrant objects', () => {
    const original = registrant('r1');
    attachRsvpsToRegistrants([original], [rsvp({ registrant_id: 'r1' })]);
    expect((original as any).rsvp).toBeUndefined();
  });
});
