// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeSummaryDialogComponent } from './meetings-home-summary-dialog.component';

function buildRow(organizer?: boolean): MeetingHomeRow {
  const meeting = { id: 'synthetic-meeting', title: 'Synthetic sync', organizer } as Meeting;
  return { key: 'synthetic-meeting-occ', meeting, occurrence: null, title: 'Synthetic sync', occurrenceId: null, startTime: '', durationMinutes: 60 };
}

function buildSummary(overrides: Partial<PastMeetingSummary> = {}): PastMeetingSummary {
  return {
    uid: 's-1',
    meeting_id: 'synthetic-meeting',
    past_meeting_id: 'synthetic-meeting-occ',
    platform: 'Zoom',
    approved: true,
    requires_approval: true,
    email_sent: false,
    password: '',
    summary_data: { title: '', content: '## Notes\n**Approved** the budget.', edited_content: '', doc_url: '', start_time: '', end_time: '' },
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('MeetingsHomeSummaryDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let onChange: ReturnType<typeof vi.fn>;
  let showToast: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>;
  let approve: ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>;

  const render = async (row: MeetingHomeRow, summary: PastMeetingSummary): Promise<ComponentFixture<MeetingsHomeSummaryDialogComponent>> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: { row, summary, onChange } },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
        { provide: MeetingService, useValue: { updatePastMeetingSummary: update, approvePastMeetingSummary: approve } },
        { provide: UiToastService, useValue: { show: showToast } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingsHomeSummaryDialogComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsHomeSummaryDialogComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const click = async (fixture: ComponentFixture<MeetingsHomeSummaryDialogComponent>, testId: string): Promise<void> => {
    (query(fixture, testId)?.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    close = vi.fn();
    onChange = vi.fn();
    showToast = vi.fn();
    update = vi.fn().mockReturnValue(of({}));
    approve = vi.fn().mockReturnValue(of({}));
  });

  it('renders the summary as markdown, read-only for an invitee, and closes', async () => {
    const fixture = await render(buildRow(), buildSummary());

    expect(query(fixture, 'ui-modal-title')?.textContent?.trim()).toBe('Meeting Summary');
    expect(query(fixture, 'ui-modal-subtitle')?.textContent?.trim()).toBe('Synthetic sync');
    expect(query(fixture, 'meetings-home-dialog-summary-content')?.querySelector('h2')?.textContent).toBe('Notes');
    expect(query(fixture, 'meetings-home-dialog-summary-edit')).toBeNull();
    expect(query(fixture, 'meetings-home-dialog-summary-approve')).toBeNull();
    expect(query(fixture, 'meetings-home-dialog-summary-pending')).toBeNull();

    await click(fixture, 'meetings-home-dialog-summary-close');
    expect(close).toHaveBeenCalled();
  });

  it('shows the edited text over the generated one', async () => {
    const fixture = await render(buildRow(), buildSummary({ summary_data: { ...buildSummary().summary_data, edited_content: 'Edited notes' } }));

    expect(query(fixture, 'meetings-home-dialog-summary-content')?.textContent?.trim()).toBe('Edited notes');
  });

  it('shows the empty state to an invitee while the summary awaits approval', async () => {
    const fixture = await render(buildRow(false), buildSummary({ approved: false }));

    expect(query(fixture, 'meetings-home-dialog-summary-content')).toBeNull();
    expect(query(fixture, 'meetings-home-dialog-summary-empty')?.textContent?.trim()).toBe('No summary content available.');
  });

  describe('organizer', () => {
    it('approves a pending summary and reports it', async () => {
      const fixture = await render(buildRow(true), buildSummary({ approved: false }));
      expect(query(fixture, 'meetings-home-dialog-summary-pending')?.textContent?.trim()).toBe('Awaiting your review');

      await click(fixture, 'meetings-home-dialog-summary-approve');

      expect(approve).toHaveBeenCalledWith('synthetic-meeting-occ', 's-1');
      expect(onChange).toHaveBeenCalledWith(buildSummary({ approved: true }));
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Summary approved successfully' }));
      expect(query(fixture, 'meetings-home-dialog-summary-approve')).toBeNull();
      expect(query(fixture, 'meetings-home-dialog-summary-approved')?.textContent?.trim()).toBe('Approved');
      expect(query(fixture, 'meetings-home-dialog-summary-pending')).toBeNull();
    });

    it('keeps Approve after a failed approval', async () => {
      approve.mockReturnValue(throwError(() => new Error('synthetic')));
      const fixture = await render(buildRow(true), buildSummary({ approved: false }));

      await click(fixture, 'meetings-home-dialog-summary-approve');

      expect(onChange).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Failed to approve summary' }));
      expect(query(fixture, 'meetings-home-dialog-summary-approve')).toBeTruthy();
    });

    it('edits the text, cancels, then saves', async () => {
      const summary = buildSummary();
      const fixture = await render(buildRow(true), summary);
      expect(query(fixture, 'meetings-home-dialog-summary-approved')).toBeTruthy();

      await click(fixture, 'meetings-home-dialog-summary-edit');
      const textarea = query(fixture, 'meetings-home-dialog-summary-editor')?.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe(summary.summary_data.content);
      await click(fixture, 'meetings-home-dialog-summary-cancel');
      expect(query(fixture, 'meetings-home-dialog-summary-editor')).toBeNull();

      await click(fixture, 'meetings-home-dialog-summary-edit');
      const editor = query(fixture, 'meetings-home-dialog-summary-editor')?.querySelector('textarea') as HTMLTextAreaElement;
      editor.value = 'New notes';
      editor.dispatchEvent(new Event('input'));
      await click(fixture, 'meetings-home-dialog-summary-save');

      expect(update).toHaveBeenCalledWith('synthetic-meeting-occ', 's-1', { edited_content: 'New notes' });
      expect(onChange).toHaveBeenCalledWith({ ...summary, summary_data: { ...summary.summary_data, edited_content: 'New notes' } });
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Summary updated successfully' }));
      expect(query(fixture, 'meetings-home-dialog-summary-editor')).toBeNull();
      expect(query(fixture, 'meetings-home-dialog-summary-content')?.textContent?.trim()).toBe('New notes');
    });

    it('stays in edit mode after a failed save', async () => {
      update.mockReturnValue(throwError(() => new Error('synthetic')));
      const fixture = await render(buildRow(true), buildSummary());

      await click(fixture, 'meetings-home-dialog-summary-edit');
      await click(fixture, 'meetings-home-dialog-summary-save');

      expect(onChange).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Failed to update summary' }));
      expect(query(fixture, 'meetings-home-dialog-summary-editor')).toBeTruthy();
    });

    it('is read-only without a summary uid to write to', async () => {
      const fixture = await render(buildRow(true), buildSummary({ uid: '' }));

      expect(query(fixture, 'meetings-home-dialog-summary-edit')).toBeNull();
    });
  });
});
