// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_AGENDA_MAX_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingEditAgendaDialogData } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingEditAgendaDialogComponent } from './edit-agenda-dialog.component';

const ORIGINAL = 'Review the roadmap.';
const OCCURRENCE = { occurrenceId: '1700000000', startTime: '2023-11-14T22:13:20Z', duration: 45 };

describe('MeetingEditAgendaDialogComponent', () => {
  let fixture: ComponentFixture<MeetingEditAgendaDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let updateMeeting: ReturnType<typeof vi.fn>;
  let updateOccurrence: ReturnType<typeof vi.fn>;
  let onApplied: ReturnType<typeof vi.fn>;

  /** The full record the authenticated read returns, with fields the public payload lacks. */
  const fresh = (extra: Partial<Meeting> = {}): Meeting =>
    ({ id: 'meeting-1', title: 'Weekly Sync', password: 'secret', description: ORIGINAL, occurrences: [], ...extra }) as unknown as Meeting;

  async function render(data: Partial<MeetingEditAgendaDialogData> = {}, record: Meeting = fresh()): Promise<void> {
    close = vi.fn();
    onApplied = vi.fn();
    add = vi.fn();
    getMeetingDetail = vi.fn().mockReturnValue(of(record));
    updateMeeting = vi.fn().mockReturnValue(of(undefined));
    updateOccurrence = vi.fn().mockReturnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [MeetingEditAgendaDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: { data: { meetingId: 'meeting-1', scope: 'series', occurrence: null, recurring: false, original: ORIGINAL, onApplied, ...data } },
        },
        { provide: MeetingService, useValue: { getMeetingDetail, updateMeeting, updateOccurrence } },
        { provide: MessageService, useValue: { add } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingEditAgendaDialogComponent);
    fixture.detectChanges();
  }

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const input = (): HTMLTextAreaElement => fixture.nativeElement.querySelector('textarea');
  const saveButton = (): HTMLButtonElement => query('edit-agenda-save')?.querySelector('button') as HTMLButtonElement;
  const type = (value: string): void => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('starts from the shown agenda, with Save disabled until it changes', async () => {
    await render();

    expect(input().value).toBe(ORIGINAL);
    expect(saveButton().disabled).toBe(true);
    type(`${ORIGINAL} `);
    // Only whitespace changed: nothing to save.
    expect(saveButton().disabled).toBe(true);
    type('New agenda');
    expect(saveButton().disabled).toBe(false);
  });

  it('saves the series agenda over the full authenticated record, never the public payload', async () => {
    await render();
    type('New agenda');

    saveButton().click();
    await settle();

    expect(getMeetingDetail).toHaveBeenCalledWith('meeting-1', { skipCache: true });
    const body = updateMeeting.mock.calls[0][1];
    expect(body).toEqual(expect.objectContaining({ title: 'Weekly Sync', description: 'New agenda' }));
    // Built from the update request's own keys: nothing read-only or sensitive travels back.
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('occurrences');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Agenda saved' }));
    expect(onApplied).toHaveBeenCalledWith('New agenda');
    expect(close).toHaveBeenCalled();
  });

  it("saves an occurrence's own agenda through the occurrence API", async () => {
    // Another organizer lengthened it to 60 minutes since the dialog opened: that is kept.
    await render(
      { scope: 'occurrence', occurrence: OCCURRENCE },
      fresh({ occurrences: [{ occurrence_id: OCCURRENCE.occurrenceId, start_time: OCCURRENCE.startTime, duration: 60, description: ORIGINAL }] })
    );
    type('Occurrence agenda');

    saveButton().click();
    await settle();

    expect(updateOccurrence).toHaveBeenCalledWith('meeting-1', OCCURRENCE.occurrenceId, {
      start_time: OCCURRENCE.startTime,
      duration: 60,
      description: 'Occurrence agenda',
    });
    expect(updateMeeting).not.toHaveBeenCalled();
  });

  it('finds the occurrence by its start when the authenticated read spells its id in milliseconds', async () => {
    await render(
      { scope: 'occurrence', occurrence: OCCURRENCE },
      fresh({ occurrences: [{ occurrence_id: '1700000000000', start_time: '2023-11-14T22:13:20.000Z', duration: 45, description: ORIGINAL }] })
    );
    type('Occurrence agenda');

    saveButton().click();
    await settle();

    expect(query('edit-agenda-moved')).toBeNull();
    expect(updateOccurrence).toHaveBeenCalledWith('meeting-1', '1700000000000', expect.objectContaining({ description: 'Occurrence agenda' }));
  });

  it('ignores Escape while a save is in flight', async () => {
    await render();
    const config = TestBed.inject(DynamicDialogConfig);
    const read = new Subject<Meeting>();
    getMeetingDetail.mockReturnValue(read);
    type('New agenda');

    saveButton().click();
    TestBed.tick();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(config.closable).toBe(false);

    read.next(fresh());
    read.complete();
    await settle();
    TestBed.tick();
    expect(config.closable).toBe(true);
  });

  it('says an occurrence moved or cancelled meanwhile, and saves nothing to it', async () => {
    await render({ scope: 'occurrence', occurrence: OCCURRENCE }, fresh({ occurrences: [] }));
    type('Occurrence agenda');

    saveButton().click();
    await settle();

    expect(query('edit-agenda-moved')).not.toBeNull();
    expect(query('edit-agenda-conflict')).toBeNull();
    expect(updateOccurrence).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);
  });

  it("won't empty an occurrence's own agenda, which the API cannot clear", async () => {
    await render({ scope: 'occurrence', occurrence: OCCURRENCE });
    type('   ');

    expect(saveButton().disabled).toBe(true);
    expect(query('edit-agenda-empty-occurrence')).not.toBeNull();
  });

  it('says what a series edit applies to', async () => {
    await render({ recurring: true });

    expect(query('edit-agenda-scope')?.textContent).toContain('every occurrence in this series');
  });

  it('counts characters and refuses an agenda over the limit', async () => {
    await render();
    type('x'.repeat(MEETING_AGENDA_MAX_LENGTH + 1));

    expect(query('edit-agenda-count')?.textContent?.trim()).toBe(`${MEETING_AGENDA_MAX_LENGTH + 1} / ${MEETING_AGENDA_MAX_LENGTH}`);
    expect(saveButton().disabled).toBe(true);
  });

  describe('when someone else changed the agenda since it opened', () => {
    const conflicted = async (): Promise<void> => {
      await render({}, fresh({ description: 'Their agenda' }));
      type('My agenda');
      saveButton().click();
      await settle();
    };

    it('shows theirs and saves nothing', async () => {
      await conflicted();

      expect(updateMeeting).not.toHaveBeenCalled();
      expect(query('edit-agenda-conflict-theirs')?.textContent).toContain('Their agenda');
      expect(close).not.toHaveBeenCalled();
    });

    it('keeps theirs on request', async () => {
      await conflicted();

      (query('edit-agenda-use-theirs')?.querySelector('button') as HTMLButtonElement).click();

      expect(onApplied).toHaveBeenCalledWith('Their agenda');
      expect(updateMeeting).not.toHaveBeenCalled();
    });

    it('replaces theirs on a second Save, knowingly', async () => {
      await conflicted();

      saveButton().click();
      await settle();

      expect(updateMeeting).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ description: 'My agenda' }));
      expect(onApplied).toHaveBeenCalledWith('My agenda');
    });

    it('still checks for a third change before that second Save', async () => {
      await conflicted();
      getMeetingDetail.mockReturnValue(of(fresh({ description: 'A third agenda' })));

      saveButton().click();
      await settle();

      expect(updateMeeting).not.toHaveBeenCalled();
      expect(query('edit-agenda-conflict-theirs')?.textContent).toContain('A third agenda');
    });

    it('never saves an invalid agenda over theirs', async () => {
      await render(
        { scope: 'occurrence', occurrence: OCCURRENCE },
        fresh({ occurrences: [{ occurrence_id: OCCURRENCE.occurrenceId, start_time: OCCURRENCE.startTime, duration: 45, description: 'Their notes' }] })
      );
      type('Mine');
      saveButton().click();
      await settle();
      type('   ');

      expect(saveButton().disabled).toBe(true);
    });
  });

  it('shows the saved agenda even when the dialog was dismissed mid-save', async () => {
    await render();
    type('New agenda');

    saveButton().click();
    fixture.detectChanges();
    // Cancel is disabled while saving.
    expect((query('edit-agenda-cancel')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    await settle();

    expect(onApplied).toHaveBeenCalledWith('New agenda');
  });

  it('says when the read before saving fails', async () => {
    await render();
    getMeetingDetail.mockReturnValue(throwError(() => new Error('boom')));
    type('New agenda');

    saveButton().click();
    await settle();

    expect(query('edit-agenda-error')).not.toBeNull();
    expect(updateMeeting).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with an error when the save fails', async () => {
    await render();
    updateMeeting.mockReturnValue(throwError(() => new Error('boom')));
    type('New agenda');

    saveButton().click();
    await settle();

    expect(query('edit-agenda-error')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  it('closes with nothing on Cancel', async () => {
    await render();

    (query('edit-agenda-cancel')?.querySelector('button') as HTMLButtonElement).click();

    expect(close).toHaveBeenCalledWith();
  });
});
