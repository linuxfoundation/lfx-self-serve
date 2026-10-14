// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PastMeetingDetailsComponent } from './past-meeting-details.component';

const PAST_ID = '98765432101-1760000000000';

/** A participant row, defaulting every field so a test sets only what it asserts on. */
function participant(partial: Partial<PastMeetingParticipant>): PastMeetingParticipant {
  return {
    uid: 'uid',
    meeting_id: '98765432101',
    meeting_and_occurrence_id: PAST_ID,
    past_meeting_id: PAST_ID,
    email: '',
    first_name: '',
    last_name: '',
    host: false,
    is_attended: false,
    is_invited: false,
    org_is_member: false,
    org_is_project_member: false,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

const ROWS: PastMeetingParticipant[] = [
  participant({ uid: 'verified', first_name: 'Ada', last_name: 'Lovelace', is_attended: true, is_invited: true, is_verified: true }),
  participant({
    uid: 'auto',
    first_name: 'Grace',
    last_name: 'Hopper',
    is_attended: true,
    is_verified: true,
    is_auto_matched: true,
    zoom_user_name: 'grace-laptop',
  }),
  participant({
    uid: 'ai',
    first_name: 'Alan',
    last_name: 'Turing',
    is_attended: true,
    is_verified: true,
    is_ai_reconciled: true,
    mapped_invitee_name: 'Alan M. Turing',
  }),
  participant({ uid: 'unknown', first_name: 'Zoom', last_name: 'Caller', is_attended: true, is_unknown: true }),
  participant({ uid: 'absent', first_name: 'Barbara', last_name: 'Liskov', is_invited: true }),
  participant({ uid: 'bot', first_name: 'Fireflies.ai', last_name: 'Notetaker', is_attended: true }),
];

describe('PastMeetingDetailsComponent participant identity (N-02)', () => {
  let element: HTMLElement;

  const meeting = (): PastMeeting =>
    ({
      id: PAST_ID,
      meeting_and_occurrence_id: PAST_ID,
      title: 'Acme Weekly Sync',
      organizer: true,
      committees: [],
      participant_count: 5,
      attended_count: 4,
      individual_registrants_count: 2,
      unverified_attended_count: 1,
    }) as unknown as PastMeeting;

  const row = (uid: string): HTMLElement | null => element.querySelector(`[data-testid="participant-row-${uid}"]`);

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: PAST_ID })), snapshot: { paramMap: convertToParamMap({ id: PAST_ID }) } } },
        {
          provide: MeetingService,
          useValue: {
            getPastMeetingById: vi.fn(() => of(meeting())),
            getPastMeetingParticipants: vi.fn(() => of(ROWS)),
            getPastMeetingRecording: vi.fn(() => of(null)),
            getPastMeetingTranscript: vi.fn(() => of(null)),
            getPastMeetingSummary: vi.fn(() => of(null)),
            getPastMeetingAttachments: vi.fn(() => of([])),
          },
        },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn(() => of([])) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(PastMeetingDetailsComponent);
    element = fixture.nativeElement as HTMLElement;
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
  });

  it('carries each attendee identity tier in data-*, and none for someone who did not attend', () => {
    expect(row('verified')?.getAttribute('data-identity-tier')).toBe('verified');
    expect(row('auto')?.getAttribute('data-identity-tier')).toBe('auto-matched');
    expect(row('ai')?.getAttribute('data-identity-tier')).toBe('ai-reconciled');
    expect(row('unknown')?.getAttribute('data-identity-tier')).toBe('unverified');
    expect(row('absent')?.hasAttribute('data-identity-tier')).toBe(false);
    expect(row('absent')?.getAttribute('data-attended')).toBe('false');
  });

  it('labels each tier, and an attendee left unknown as Unknown', () => {
    const label = (uid: string) => row(uid)?.querySelector('[data-testid="participant-identity-tier"]')?.textContent?.trim();

    expect(label('verified')).toBe('Verified');
    expect(label('auto')).toBe('Auto-matched');
    expect(label('ai')).toBe('AI-matched');
    expect(label('unknown')).toBe('Unknown');
    expect(row('absent')?.querySelector('[data-testid="participant-identity-tier"]')).toBeNull();
  });

  // #2253: reconciliation never queues a bot, so the row never asks for a review.
  it('labels an unmatched notetaker bot as a bot, with no tier', () => {
    expect(row('bot')?.hasAttribute('data-identity-tier')).toBe(false);
    expect(row('bot')?.getAttribute('data-notetaker-bot')).toBe('true');
    expect(row('bot')?.querySelector('[data-testid="participant-notetaker-bot"]')?.textContent?.trim()).toBe('Notetaker bot');
    expect(row('bot')?.querySelector('[data-testid="participant-identity-tier"]')).toBeNull();
    expect(row('unknown')?.hasAttribute('data-notetaker-bot')).toBe(false);
  });

  it('shows the Zoom name and the matched invitee only where they differ from the row', () => {
    expect(row('auto')?.querySelector('[data-testid="participant-joined-as"]')?.textContent).toContain('Joined Zoom as grace-laptop');
    expect(row('ai')?.querySelector('[data-testid="participant-matched-to"]')?.textContent).toContain('Matched to Alan M. Turing');
    expect(row('verified')?.querySelector('[data-testid="participant-joined-as"], [data-testid="participant-matched-to"]')).toBeNull();
  });

  it('says how many attendees are unverified next to the attended count', () => {
    expect(element.querySelector('[data-testid="attendance-unverified"]')?.textContent).toContain('1 unverified');
  });
});
