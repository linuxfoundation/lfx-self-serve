// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingRegistrant, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

// Load only the pure resolver, avoiding the Angular-dependent shared barrel in this Node suite.
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('@lfx-one/shared/utils/rsvp-calculator.util'));

import { attachRsvpsToRegistrants, filterRsvpsToActiveRegistrants } from './meeting-rsvp.helper';

const registrant = (uid: string): MeetingRegistrant => ({ uid }) as MeetingRegistrant;
const rsvp = (overrides: Partial<MeetingRsvp>): MeetingRsvp => ({ registrant_id: 'r1', response_type: 'accepted', ...overrides }) as unknown as MeetingRsvp;

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

  it.each(['single', 'this_and_following'] as const)(
    'selects all before newest %s for an unresolved date without changing resolved or aggregate selection',
    (scope) => {
      const all = rsvp({ scope: 'all', modified_at: '2026-01-01T00:00:00Z' });
      const scoped = rsvp({ scope, occurrence_id: '4071031200000', response_type: 'declined', modified_at: '2026-02-01T00:00:00Z' });
      const scopedOnly = { ...scoped, registrant_id: 'r2' };
      const roster = [registrant('r1'), registrant('r2')];
      const history = [all, scoped, scopedOnly];

      expect(attachRsvpsToRegistrants(roster, history, undefined, true).map((row) => row.rsvp)).toEqual([all, null]);
      expect(attachRsvpsToRegistrants(roster, history).map((row) => row.rsvp)).toEqual([scoped, scopedOnly]);
      expect(attachRsvpsToRegistrants(roster, history, '4071031200', true).map((row) => row.rsvp)).toEqual([scoped, scopedOnly]);
      expect(attachRsvpsToRegistrants(roster, history, '4070944800').map((row) => row.rsvp)).toEqual([all, null]);
    }
  );

  it('does not mutate the input registrant objects', () => {
    const original = registrant('r1');
    attachRsvpsToRegistrants([original], [rsvp({ registrant_id: 'r1' })]);
    expect((original as any).rsvp).toBeUndefined();
  });
});
