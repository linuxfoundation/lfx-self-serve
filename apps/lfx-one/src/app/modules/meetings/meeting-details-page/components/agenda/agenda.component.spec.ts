// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { Subject } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Meeting,
  MeetingAgendaOverride,
  MeetingEditAgendaDialogData,
  MeetingOccurrence,
  MeetingTimeState,
  PublicMeetingProject,
} from '@lfx-one/shared/interfaces';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingEditAgendaDialogComponent } from '../edit-agenda-dialog/edit-agenda-dialog.component';
import { MeetingAgendaComponent } from './agenda.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

describe('MeetingAgendaComponent', () => {
  let fixture: ComponentFixture<MeetingAgendaComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let timeState: WritableSignal<MeetingTimeState>;
  let agendaOverride: WritableSignal<MeetingAgendaOverride | null>;
  let reload: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<unknown>;

  const build = (overrides: Partial<Meeting> = {}): LoadedMeeting =>
    ({
      id: 'meeting-1',
      description: 'Review the roadmap. Notes: https://docs.acme-motors.example/roadmap',
      organizer: false,
      ...overrides,
      project: { uid: 'p1', name: 'Acme Project', slug: 'acme-project' },
    }) as unknown as LoadedMeeting;

  beforeEach(async () => {
    meeting = signal<LoadedMeeting | undefined>(build());
    selectedOccurrence = signal<MeetingOccurrence | null>(null);
    timeState = signal<MeetingTimeState>('before');
    agendaOverride = signal<MeetingAgendaOverride | null>(null);
    reload = vi.fn();
    closed = new Subject<unknown>();
    open = vi.fn().mockReturnValue({ onClose: closed.asObservable(), onDestroy: new Subject<void>() } as unknown as DynamicDialogRef);

    await TestBed.configureTestingModule({
      imports: [MeetingAgendaComponent],
      providers: [provideRouter([]), { provide: MeetingDetailsStateService, useValue: { meeting, selectedOccurrence, timeState, agendaOverride, reload } }],
    })
      .overrideComponent(MeetingAgendaComponent, { set: { providers: [{ provide: DialogService, useValue: { open, dialogComponentRefMap: new Map() } }] } })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingAgendaComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('shows the description under an Agenda heading, with its links made clickable', () => {
    expect(query('agenda-section')?.querySelector('h2')?.textContent?.trim()).toBe('Agenda');
    expect(query('agenda-section-description')?.textContent).toContain('Review the roadmap.');

    const link = query('agenda-section-description')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://docs.acme-motors.example/roadmap');
  });

  it('renders markup in the description as text, not HTML', () => {
    meeting.set(build({ description: '<img src=x onerror="alert(1)"> Agenda' }));
    fixture.detectChanges();

    expect(query('agenda-section-description')?.querySelector('img')).toBeNull();
    expect(query('agenda-section-description')?.textContent).toContain('<img');
  });

  it("prefers the selected occurrence's own description over the series'", () => {
    selectedOccurrence.set({ occurrence_id: 'occ-1', description: 'Occurrence-only agenda' } as MeetingOccurrence);
    fixture.detectChanges();

    expect(query('agenda-section-description')?.textContent).toContain('Occurrence-only agenda');
    expect(query('agenda-section-description')?.textContent).not.toContain('Review the roadmap.');
  });

  it("falls back to the series' description when the occurrence's is blank", () => {
    selectedOccurrence.set({ occurrence_id: 'occ-1', description: '   ' } as MeetingOccurrence);
    fixture.detectChanges();

    expect(query('agenda-section-description')?.textContent).toContain('Review the roadmap.');
  });

  it('remounts the expandable text when the description changes, so it is measured afresh', () => {
    const before = fixture.nativeElement.querySelector('lfx-expandable-text');

    selectedOccurrence.set({ occurrence_id: 'occ-2', description: 'A short agenda' } as MeetingOccurrence);
    fixture.detectChanges();

    const after = fixture.nativeElement.querySelector('lfx-expandable-text');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after.textContent).toContain('A short agenda');
  });

  it('says so when there is no description', () => {
    meeting.set(build({ description: '   ' }));
    fixture.detectChanges();

    expect(query('agenda-section-description')).toBeNull();
    expect(query('agenda-section-empty')?.textContent?.trim()).toBe('No agenda has been added for this meeting yet.');
  });

  it('offers Edit agenda to organizers only', () => {
    expect(query('agenda-section-edit')).toBeNull();

    meeting.set(build({ organizer: true }));
    fixture.detectChanges();

    expect(query('agenda-section-edit')?.textContent?.trim()).toBe('Edit agenda');
  });

  it('hides Edit agenda once the meeting has ended', () => {
    meeting.set(build({ organizer: true }));
    timeState.set('ended');
    fixture.detectChanges();

    expect(query('agenda-section-edit')).toBeNull();
  });

  describe('Edit agenda (O-01)', () => {
    const openEditor = (): MeetingEditAgendaDialogData => {
      query('agenda-section-edit')?.click();
      expect(open).toHaveBeenCalledWith(MeetingEditAgendaDialogComponent, expect.objectContaining({ showHeader: false }));
      return open.mock.calls[0][1].data as MeetingEditAgendaDialogData;
    };

    beforeEach(() => {
      meeting.set(build({ organizer: true, recurrence: { type: 2 } } as Partial<Meeting>));
      fixture.detectChanges();
    });

    it("opens a dialog on the page for the series' agenda", () => {
      expect(query('agenda-section-edit')?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(openEditor()).toEqual({
        onApplied: expect.any(Function),
        meetingId: 'meeting-1',
        scope: 'series',
        occurrence: null,
        recurring: true,
        original: 'Review the roadmap. Notes: https://docs.acme-motors.example/roadmap',
      });
    });

    it("edits the selected occurrence's own agenda when it has one", () => {
      selectedOccurrence.set({ occurrence_id: '1700000000', start_time: '2023-11-14T22:13:20Z', duration: 45, description: 'Occurrence notes' });
      fixture.detectChanges();

      expect(openEditor()).toEqual(
        expect.objectContaining({
          scope: 'occurrence',
          occurrence: { occurrenceId: '1700000000', startTime: '2023-11-14T22:13:20Z', duration: 45 },
          original: 'Occurrence notes',
        })
      );
    });

    it('shows a saved agenda at once and re-reads the meeting', () => {
      openEditor().onApplied('New agenda');
      fixture.detectChanges();

      expect(agendaOverride()).toEqual({ meetingId: 'meeting-1', occurrenceId: null, description: 'New agenda' });
      expect(query('agenda-section-description')?.textContent).toContain('New agenda');
      expect(reload).toHaveBeenCalled();
    });

    it('changes nothing when the dialog is cancelled', () => {
      openEditor();
      closed.next(undefined);
      fixture.detectChanges();

      expect(agendaOverride()).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

    it('shows a saved occurrence agenda for that occurrence only', () => {
      selectedOccurrence.set({ occurrence_id: '1700000000', start_time: '2023-11-14T22:13:20Z', duration: 45, description: 'Occurrence notes' });
      fixture.detectChanges();
      openEditor().onApplied('New occurrence notes');
      fixture.detectChanges();

      expect(agendaOverride()).toEqual({ meetingId: 'meeting-1', occurrenceId: '1700000000', description: 'New occurrence notes' });
      expect(query('agenda-section-description')?.textContent).toContain('New occurrence notes');

      selectedOccurrence.set({ occurrence_id: '1700604800', start_time: '2023-11-21T22:13:20Z', duration: 45 });
      fixture.detectChanges();
      expect(query('agenda-section-description')?.textContent).toContain('Review the roadmap');
    });

    it("never shows a series override over an occurrence's own agenda", () => {
      agendaOverride.set({ meetingId: 'meeting-1', occurrenceId: null, description: 'Series agenda' });
      selectedOccurrence.set({ occurrence_id: '1700000000', start_time: '2023-11-14T22:13:20Z', duration: 45, description: 'Occurrence notes' });
      fixture.detectChanges();

      expect(query('agenda-section-description')?.textContent).toContain('Occurrence notes');
    });
  });
});
