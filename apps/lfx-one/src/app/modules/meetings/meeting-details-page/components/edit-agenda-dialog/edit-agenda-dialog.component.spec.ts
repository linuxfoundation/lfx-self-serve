// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_AGENDA_MAX_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingEditAgendaDialogData } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
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

  /** The full record the authenticated read returns, with fields the public payload lacks. */
  const fresh = (extra: Partial<Meeting> = {}): Meeting =>
    ({ id: 'meeting-1', title: 'Weekly Sync', password: 'secret', description: ORIGINAL, occurrences: [], ...extra }) as unknown as Meeting;

  async function render(data: Partial<MeetingEditAgendaDialogData> = {}, record: Meeting = fresh()): Promise<void> {
    close = vi.fn();
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
          useValue: { data: { meetingId: 'meeting-1', scope: 'series', occurrence: null, recurring: false, original: ORIGINAL, ...data } },
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
    expect(updateMeeting).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ password: 'secret', title: 'Weekly Sync', description: 'New agenda' }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Agenda saved' }));
    expect(close).toHaveBeenCalledWith({ description: 'New agenda' });
  });

  it("saves an occurrence's own agenda through the occurrence API", async () => {
    await render(
      { scope: 'occurrence', occurrence: OCCURRENCE },
      fresh({ occurrences: [{ occurrence_id: OCCURRENCE.occurrenceId, start_time: OCCURRENCE.startTime, duration: 45, description: ORIGINAL }] })
    );
    type('Occurrence agenda');

    saveButton().click();
    await settle();

    expect(updateOccurrence).toHaveBeenCalledWith('meeting-1', OCCURRENCE.occurrenceId, {
      start_time: OCCURRENCE.startTime,
      duration: 45,
      description: 'Occurrence agenda',
    });
    expect(updateMeeting).not.toHaveBeenCalled();
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
    it('shows theirs and saves nothing', async () => {
      await render({}, fresh({ description: 'Their agenda' }));
      type('My agenda');

      saveButton().click();
      await settle();

      expect(updateMeeting).not.toHaveBeenCalled();
      expect(query('edit-agenda-conflict-theirs')?.textContent).toContain('Their agenda');
      expect(close).not.toHaveBeenCalled();
    });

    it('keeps theirs on request', async () => {
      await render({}, fresh({ description: 'Their agenda' }));
      type('My agenda');
      saveButton().click();
      await settle();

      (query('edit-agenda-use-theirs')?.querySelector('button') as HTMLButtonElement).click();

      expect(close).toHaveBeenCalledWith({ description: 'Their agenda' });
      expect(updateMeeting).not.toHaveBeenCalled();
    });

    it('saves over theirs only when asked', async () => {
      await render({}, fresh({ description: 'Their agenda' }));
      type('My agenda');
      saveButton().click();
      await settle();

      (query('edit-agenda-overwrite')?.querySelector('button') as HTMLButtonElement).click();
      await settle();

      expect(updateMeeting).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ description: 'My agenda' }));
      expect(close).toHaveBeenCalledWith({ description: 'My agenda' });
    });
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
