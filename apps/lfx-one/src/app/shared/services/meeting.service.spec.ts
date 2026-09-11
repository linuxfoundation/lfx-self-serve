// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingService } from './meeting.service';

const MEETING_UID = 'b0b1f0d6-4c1c-4a2a-9f0e-2f3c1a6d7e10';

/**
 * A saved registrant, every optional string populated. Individual tests blank exactly one field so
 * each omission is asserted on its own rather than through a fixture that clears all three at once.
 */
function registrant(overrides: Partial<MeetingRegistrantWithState> = {}): MeetingRegistrantWithState {
  return {
    uid: 'reg-1',
    meeting_id: MEETING_UID,
    email: 'dana.reyes@acme-motors.example',
    first_name: 'Dana',
    last_name: 'Reyes',
    host: false,
    job_title: 'Staff Engineer',
    org_name: 'Acme Motors',
    occurrence_id: null,
    org_is_member: false,
    org_is_project_member: false,
    avatar_url: null,
    username: null,
    linkedin_profile: null,
    created_at: '2026-01-05T09:00:00.000Z',
    updated_at: '2026-01-05T09:00:00.000Z',
    type: 'committee',
    committee_uid: 'cmt-9d2f',
    invite_accepted: null,
    attended: null,
    state: 'new',
    ...overrides,
  };
}

describe('MeetingService registrant payload mapping', () => {
  let service: MeetingService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }],
    });
    service = TestBed.inject(MeetingService);
  });

  describe('stripMetadata', () => {
    it('carries the meeting uid and every populated optional field', () => {
      const body = service.stripMetadata(MEETING_UID, registrant());

      expect(body).toEqual({
        meeting_id: MEETING_UID,
        email: 'dana.reyes@acme-motors.example',
        first_name: 'Dana',
        last_name: 'Reyes',
        host: false,
        job_title: 'Staff Engineer',
        org_name: 'Acme Motors',
        committee_uid: 'cmt-9d2f',
      });
    });

    it('takes the meeting uid from the argument, not from the registrant', () => {
      const body = service.stripMetadata('c7c9a5f4-6d1e-4a68-9c33-1f5b0c9a4d21', registrant({ meeting_id: 'stale-meeting' }));

      expect(body.meeting_id).toBe('c7c9a5f4-6d1e-4a68-9c33-1f5b0c9a4d21');
    });

    // Upstream declares these as non-nullable optional strings, so a blank one has to be absent from
    // the body rather than present as `null` — see the mapper's own docblock. `not.toHaveProperty` is
    // the assertion that tells the two apart; `toBeUndefined` passes for an explicit `undefined` too.
    it.each([
      ['job_title', { job_title: null }],
      ['org_name', { org_name: null }],
      ['committee_uid', { committee_uid: null }],
    ] as const)('omits %s entirely when it is null', (key, blanked) => {
      const body = service.stripMetadata(MEETING_UID, registrant(blanked));

      expect(body).not.toHaveProperty(key);
    });

    it.each([
      ['job_title', { job_title: '' }],
      ['org_name', { org_name: '' }],
      ['committee_uid', { committee_uid: '' }],
    ] as const)('omits %s entirely when it is an empty string', (key, blanked) => {
      const body = service.stripMetadata(MEETING_UID, registrant(blanked));

      expect(body).not.toHaveProperty(key);
    });

    it('omits only the blank field and keeps its neighbours', () => {
      const body = service.stripMetadata(MEETING_UID, registrant({ org_name: null }));

      expect(body).not.toHaveProperty('org_name');
      expect(body.job_title).toBe('Staff Engineer');
      expect(body.committee_uid).toBe('cmt-9d2f');
    });

    it('omits an absent committee_uid, so a direct guest is not attributed to a group', () => {
      const direct = registrant({ type: 'direct' });
      Reflect.deleteProperty(direct, 'committee_uid');

      const body = service.stripMetadata(MEETING_UID, direct);

      expect(body).not.toHaveProperty('committee_uid');
    });

    it('drops the response-only committee enrichment rather than echoing it back', () => {
      const body = service.stripMetadata(
        MEETING_UID,
        registrant({ committee_name: 'Technical Steering', committee_role: 'Chair', committee_category: 'Technical' })
      );

      expect(body).not.toHaveProperty('committee_name');
      expect(body).not.toHaveProperty('committee_role');
      expect(body).not.toHaveProperty('committee_category');
    });

    it('normalises a missing host flag to false rather than leaving it undefined', () => {
      const body = service.stripMetadata(MEETING_UID, registrant({ host: undefined as unknown as boolean }));

      expect(body.host).toBe(false);
    });
  });

  describe('getChangedFields', () => {
    // The mirror image of `stripMetadata`: an update body says `null` to erase a stored value, so
    // these fields must be present-and-null instead of omitted. Pinning both halves keeps the
    // asymmetry deliberate rather than something a later cleanup can "tidy" into agreement.
    it('sends null for a cleared field instead of omitting it', () => {
      const body = service.getChangedFields(registrant({ state: 'modified', job_title: null, org_name: '' }));

      expect(body).toHaveProperty('job_title', null);
      expect(body).toHaveProperty('org_name', null);
    });

    it('keeps the meeting id the registrant already carries and never forwards committee_uid', () => {
      const body = service.getChangedFields(registrant({ state: 'modified' }));

      expect(body.meeting_id).toBe(MEETING_UID);
      expect(body).not.toHaveProperty('committee_uid');
    });
  });
});
