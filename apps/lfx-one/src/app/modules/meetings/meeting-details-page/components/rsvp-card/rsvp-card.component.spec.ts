// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Meeting, MeetingOccurrence, MeetingRsvp, RsvpResponse, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingRsvpCardComponent } from './rsvp-card.component';

const OCCURRENCE: MeetingOccurrence = { occurrence_id: '1760000000', start_time: '2026-10-09T17:00:00Z', duration: 60 } as MeetingOccurrence;

describe('MeetingRsvpCardComponent', () => {
  let fixture: ComponentFixture<MeetingRsvpCardComponent>;
  let meeting: WritableSignal<Meeting | undefined>;
  let myRsvp: WritableSignal<RsvpResponse | null | undefined>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let setMyRsvp: ReturnType<typeof vi.fn>;
  let createMeetingRsvp: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  const saved = (response: RsvpResponse): MeetingRsvp => ({ id: 'rsvp-1', meeting_id: 'meeting-1', response_type: response }) as unknown as MeetingRsvp;

  beforeEach(async () => {
    meeting = signal<Meeting | undefined>({ id: 'meeting-1', title: 'Acme Weekly Sync' } as Meeting);
    myRsvp = signal<RsvpResponse | null | undefined>(null);
    selectedOccurrence = signal<MeetingOccurrence | null>(null);
    setMyRsvp = vi.fn();
    createMeetingRsvp = vi.fn((_id: string, request: { response: RsvpResponse }) => of(saved(request.response)));
    add = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MeetingRsvpCardComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting,
            myRsvp,
            myRsvpAttr: signal<string | null>(null),
            selectedOccurrence,
            setMyRsvp,
          },
        },
        { provide: MeetingService, useValue: { createMeetingRsvp } },
        { provide: UserService, useValue: { user: signal({ email: 'ada@acme-motors.example' } as User) } },
        { provide: MessageService, useValue: { add } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingRsvpCardComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => (query(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const click = (testId: string): void => {
    query(testId)?.click();
    fixture.detectChanges();
  };
  const radio = (scope: string): HTMLInputElement => fixture.nativeElement.querySelector(`#meeting-rsvp-card-scope-${scope}`) as HTMLInputElement;

  it('asks "Will you attend?" with the three answers, none chosen yet', () => {
    expect(fixture.nativeElement.querySelector('h3')?.textContent?.trim()).toBe('Will you attend?');
    expect(text('meeting-rsvp-card-accepted')).toBe("Yes, I'll attend");
    expect(text('meeting-rsvp-card-maybe')).toBe('Maybe');
    expect(text('meeting-rsvp-card-declined')).toBe("Can't attend");
    expect(query('meeting-rsvp-card-accepted')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the answer once given, and lets the viewer change it', () => {
    myRsvp.set('accepted');
    fixture.detectChanges();

    expect(text('meeting-rsvp-card-confirmation')).toContain("You're going");
    expect(query('meeting-rsvp-card-accepted')).toBeNull();

    click('meeting-rsvp-card-change');

    expect(query('meeting-rsvp-card-accepted')?.getAttribute('aria-pressed')).toBe('true');
    expect(query('meeting-rsvp-card-maybe')?.getAttribute('aria-pressed')).toBe('false');
    // Focus lands on the current answer, not on <body>.
    expect(document.activeElement).toBe(query('meeting-rsvp-card-accepted'));
  });

  it('lets the viewer keep their answer after all', () => {
    myRsvp.set('maybe');
    fixture.detectChanges();
    click('meeting-rsvp-card-change');

    click('meeting-rsvp-card-keep');

    expect(text('meeting-rsvp-card-confirmation')).toContain('You replied maybe');
    expect(document.activeElement).toBe(query('meeting-rsvp-card-change'));
    expect(createMeetingRsvp).not.toHaveBeenCalled();
  });

  it('shows unpressed answers while the answer is still loading', () => {
    myRsvp.set(undefined);
    fixture.detectChanges();

    expect(query('meeting-rsvp-card-accepted')?.getAttribute('aria-pressed')).toBe('false');
    expect(query('meeting-rsvp-card-keep')).toBeNull();
  });

  // FR-024: a single meeting saves `all` silently.
  it('saves the answer for a single meeting at once, for all occurrences', () => {
    click('meeting-rsvp-card-maybe');

    expect(createMeetingRsvp).toHaveBeenCalledWith('meeting-1', { response: 'maybe', scope: 'all', email: 'ada@acme-motors.example' });
    expect(setMyRsvp).toHaveBeenCalledWith('meeting-1', undefined, saved('maybe'));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'RSVP Updated', detail: 'You have responded "Maybe" for this meeting.' }));
    expect(query('meeting-rsvp-card-scope')).toBeNull();
  });

  // The live region stays mounted, so the save is announced; focus moves to the confirmation's Change.
  it('announces a saved answer and moves focus to Change', () => {
    myRsvp.set(undefined);
    fixture.detectChanges();
    expect(text('meeting-rsvp-card-announcement')).toBe('');

    click('meeting-rsvp-card-accepted');

    expect(query('meeting-rsvp-card-announcement')?.getAttribute('role')).toBe('status');
    expect(text('meeting-rsvp-card-announcement')).toBe("RSVP saved. You're going.");
    expect(document.activeElement).toBe(query('meeting-rsvp-card-change'));
  });

  // An organizer gets this card whether or not they are invited, but the page only loads an
  // invitee's own answer: the card keeps what it saved.
  it("shows the answer it saved when the page's own answer is not loaded", () => {
    myRsvp.set(undefined);
    fixture.detectChanges();

    click('meeting-rsvp-card-declined');

    expect(text('meeting-rsvp-card-confirmation')).toContain("You can't attend");
  });

  it('starts over when the page moves to another occurrence', () => {
    myRsvp.set('accepted');
    fixture.detectChanges();
    click('meeting-rsvp-card-change');
    expect(query('meeting-rsvp-card-confirmation')).toBeNull();

    meeting.set({ id: 'meeting-1', title: 'Acme Weekly Sync', recurrence: { type: 2 }, occurrences: [OCCURRENCE] } as unknown as Meeting);
    selectedOccurrence.set(OCCURRENCE);
    fixture.detectChanges();

    expect(text('meeting-rsvp-card-confirmation')).toContain("You're going");
  });

  describe('on a series', () => {
    beforeEach(() => {
      meeting.set({ id: 'meeting-1', title: 'Acme Weekly Sync', recurrence: { type: 2 }, occurrences: [OCCURRENCE] } as unknown as Meeting);
      selectedOccurrence.set(OCCURRENCE);
      fixture.detectChanges();
    });

    it('asks which occurrences the answer covers before saving', () => {
      click('meeting-rsvp-card-accepted');

      expect(createMeetingRsvp).not.toHaveBeenCalled();
      expect(query('meeting-rsvp-card-scope')?.getAttribute('role')).toBe('radiogroup');
      expect(text('meeting-rsvp-card-scope')).toContain('All occurrences');
      expect(text('meeting-rsvp-card-scope')).toContain('This occurrence only');
      expect(text('meeting-rsvp-card-scope')).toContain('This and following occurrences');
      expect(radio('all').checked).toBe(true);
      expect(document.activeElement).toBe(radio('all'));
    });

    it('sends the occurrence for this occurrence only, and keys the saved answer to it', () => {
      click('meeting-rsvp-card-declined');
      radio('single').click();
      fixture.detectChanges();
      click('meeting-rsvp-card-scope-save');

      expect(createMeetingRsvp).toHaveBeenCalledWith('meeting-1', {
        response: 'declined',
        scope: 'single',
        email: 'ada@acme-motors.example',
        occurrence_id: '1760000000',
      });
      expect(setMyRsvp).toHaveBeenCalledWith('meeting-1', '1760000000', saved('declined'));
      expect(query('meeting-rsvp-card-scope')).toBeNull();
    });

    it('sends the occurrence for this and following occurrences', () => {
      click('meeting-rsvp-card-maybe');
      radio('this_and_following').click();
      fixture.detectChanges();
      click('meeting-rsvp-card-scope-save');

      expect(createMeetingRsvp.mock.calls[0][1]).toMatchObject({ scope: 'this_and_following', occurrence_id: '1760000000' });
    });

    it('sends no occurrence for all occurrences', () => {
      click('meeting-rsvp-card-accepted');
      click('meeting-rsvp-card-scope-save');

      expect(createMeetingRsvp.mock.calls[0][1]).not.toHaveProperty('occurrence_id');
    });

    it('goes back to the answers on cancel, without saving', () => {
      click('meeting-rsvp-card-accepted');
      click('meeting-rsvp-card-scope-cancel');

      expect(query('meeting-rsvp-card-scope')).toBeNull();
      expect(document.activeElement).toBe(query('meeting-rsvp-card-accepted'));
      expect(createMeetingRsvp).not.toHaveBeenCalled();
    });
  });

  it('disables the answers while saving', () => {
    const pending = new Subject<MeetingRsvp>();
    createMeetingRsvp.mockReturnValue(pending as Observable<MeetingRsvp>);
    click('meeting-rsvp-card-accepted');

    expect((query('meeting-rsvp-card-maybe') as HTMLButtonElement).disabled).toBe(true);
    expect(query('meeting-rsvp-card-accepted')?.getAttribute('aria-busy')).toBe('true');
  });

  // A save in flight keeps its pending buttons, even if the page's own answer loads meanwhile.
  it('stays on the pending answer while saving, even when the answer loads', () => {
    myRsvp.set(undefined);
    fixture.detectChanges();
    createMeetingRsvp.mockReturnValue(new Subject<MeetingRsvp>() as Observable<MeetingRsvp>);
    click('meeting-rsvp-card-accepted');

    myRsvp.set('declined');
    fixture.detectChanges();

    expect(query('meeting-rsvp-card-confirmation')).toBeNull();
    expect(query('meeting-rsvp-card-accepted')?.getAttribute('aria-busy')).toBe('true');
  });

  it('announces a second save of the same answer too', () => {
    click('meeting-rsvp-card-accepted');
    expect(text('meeting-rsvp-card-announcement')).toBe("RSVP saved. You're going.");

    const pending = new Subject<MeetingRsvp>();
    createMeetingRsvp.mockReturnValue(pending as Observable<MeetingRsvp>);
    click('meeting-rsvp-card-change');
    click('meeting-rsvp-card-accepted');
    // Cleared at the start of the save, so the same words are a fresh mutation when it completes.
    expect(text('meeting-rsvp-card-announcement')).toBe('');
    pending.next(saved('accepted'));
    pending.complete();
    fixture.detectChanges();

    expect(text('meeting-rsvp-card-announcement')).toBe("RSVP saved. You're going.");
  });

  // A save that completes after the page moved to another occurrence must leave the new view alone.
  it('keeps a slow save out of the occurrence the page moved to', () => {
    myRsvp.set(undefined);
    fixture.detectChanges();
    const pending = new Subject<MeetingRsvp>();
    createMeetingRsvp.mockReturnValue(pending as Observable<MeetingRsvp>);
    click('meeting-rsvp-card-accepted');

    meeting.set({ id: 'meeting-1', title: 'Acme Weekly Sync', recurrence: { type: 2 }, occurrences: [OCCURRENCE] } as unknown as Meeting);
    selectedOccurrence.set(OCCURRENCE);
    fixture.detectChanges();
    pending.next(saved('accepted'));
    pending.complete();
    fixture.detectChanges();

    expect(query('meeting-rsvp-card-confirmation')).toBeNull();
    expect(text('meeting-rsvp-card-announcement')).toBe('');
    // The save itself still completed: its toast, and the state service's own guard.
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'RSVP Updated' }));
    expect(setMyRsvp).toHaveBeenCalledWith('meeting-1', undefined, saved('accepted'));
  });

  it('completes a save after the card is destroyed', () => {
    const pending = new Subject<MeetingRsvp>();
    createMeetingRsvp.mockReturnValue(pending as Observable<MeetingRsvp>);
    click('meeting-rsvp-card-maybe');
    fixture.destroy();

    pending.next(saved('maybe'));
    pending.complete();

    expect(setMyRsvp).toHaveBeenCalledWith('meeting-1', undefined, saved('maybe'));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'RSVP Updated' }));
  });

  it('clears a previous error when a retry succeeds', () => {
    createMeetingRsvp.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    click('meeting-rsvp-card-accepted');
    expect(query('meeting-rsvp-card-error')).not.toBeNull();

    click('meeting-rsvp-card-accepted');

    expect(query('meeting-rsvp-card-error')).toBeNull();
  });

  // V1's copy: a 404 means the viewer is not on the invite list.
  it("keeps V1's 404 copy", () => {
    createMeetingRsvp.mockReturnValue(throwError(() => ({ status: 404 })));
    click('meeting-rsvp-card-accepted');

    expect(query('meeting-rsvp-card-error')?.getAttribute('role')).toBe('alert');
    expect(text('meeting-rsvp-card-error')).toBe('Only invited users are allowed to RSVP to this meeting.');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'RSVP Failed' }));
    expect(setMyRsvp).not.toHaveBeenCalled();
  });

  it("shows the BFF's message for other failures, else a generic one", () => {
    createMeetingRsvp.mockReturnValue(throwError(() => ({ status: 400, error: { error: 'Meeting is not accepting RSVPs' } })));
    click('meeting-rsvp-card-accepted');
    expect(text('meeting-rsvp-card-error')).toBe('Meeting is not accepting RSVPs');

    createMeetingRsvp.mockReturnValue(throwError(() => ({ status: 500 })));
    click('meeting-rsvp-card-accepted');
    expect(text('meeting-rsvp-card-error')).toBe('Failed to update RSVP. Please try again.');
  });
});
