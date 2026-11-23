// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, MeetingSummaryDialogData, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let copy: ReturnType<typeof vi.fn>;

  const render = async (
    row: MeetingHomeRow,
    summary: PastMeetingSummary,
    options: Pick<MeetingSummaryDialogData, 'origin' | 'showPending'> = {}
  ): Promise<ComponentFixture<MeetingsHomeSummaryDialogComponent>> => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: { row, summary, onChange, ...options } },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
        { provide: MeetingService, useValue: { updatePastMeetingSummary: update, approvePastMeetingSummary: approve } },
        { provide: UiToastService, useValue: { show: showToast } },
        { provide: Clipboard, useValue: { copy } },
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
    // The modal's scroll fades observe the body's size.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public disconnect = vi.fn();
      }
    );
    TestBed.resetTestingModule();
    close = vi.fn();
    onChange = vi.fn();
    showToast = vi.fn();
    update = vi.fn().mockReturnValue(of({}));
    approve = vi.fn().mockReturnValue(of({}));
    copy = vi.fn().mockReturnValue(true);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders the summary as markdown, read-only and without status for an invitee, and closes', async () => {
    const fixture = await render(buildRow(), buildSummary());

    expect(query(fixture, 'ui-modal-title')?.textContent?.trim()).toBe('AI Summary');
    expect(query(fixture, 'meetings-home-dialog-summary-content')?.querySelector('h2')?.textContent).toBe('Notes');
    expect(query(fixture, 'ui-modal-title-suffix')?.children.length).toBe(0);
    expect(query(fixture, 'ui-modal-actions')?.children.length).toBe(0);

    await click(fixture, 'ui-modal-close');
    expect(close).toHaveBeenCalled();
  });

  it('shows the meeting context from a page and only a divider from the drawer', async () => {
    const fixture = await render(buildRow(), buildSummary());
    expect(query(fixture, 'meeting-dialog-context-title')?.textContent?.trim()).toBe('Synthetic sync');

    TestBed.resetTestingModule();
    const drawer = await render(buildRow(), buildSummary(), { origin: 'drawer' });
    expect(query(drawer, 'meeting-dialog-context-block')).toBeNull();
    expect(query(drawer, 'meeting-dialog-context-divider')).toBeTruthy();
  });

  it('copies the summary and reports it', async () => {
    const fixture = await render(buildRow(), buildSummary());

    await click(fixture, 'meetings-home-dialog-summary-copy');

    expect(copy).toHaveBeenCalledWith(buildSummary().summary_data.content);
    expect(showToast).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting summary copied to clipboard' });
  });

  it('reports a failed copy', async () => {
    copy.mockReturnValue(false);
    const fixture = await render(buildRow(), buildSummary());

    await click(fixture, 'meetings-home-dialog-summary-copy');

    expect(showToast).toHaveBeenCalledWith({ variant: 'error', position: 'bottom-center', message: 'Failed to copy summary' });
  });

  it('shows the edited text over the generated one', async () => {
    const fixture = await render(buildRow(), buildSummary({ summary_data: { ...buildSummary().summary_data, edited_content: 'Edited notes' } }));

    expect(query(fixture, 'meetings-home-dialog-summary-content')?.textContent?.trim()).toBe('Edited notes');
  });

  it('shows the empty state to an invitee while the summary awaits approval', async () => {
    const fixture = await render(buildRow(false), buildSummary({ approved: false }));

    expect(query(fixture, 'meetings-home-dialog-summary-content')).toBeNull();
    expect(query(fixture, 'meetings-home-dialog-summary-empty')?.textContent?.trim()).toBe('No summary content available.');
    expect(query(fixture, 'meetings-home-dialog-summary-pending-review')).toBeNull();
  });

  it('shows a summary awaiting approval to an invitee, read-only, as Pending Review when asked to', async () => {
    const fixture = await render(buildRow(false), buildSummary({ approved: false }), { showPending: true });

    expect(query(fixture, 'meetings-home-dialog-summary-content')?.querySelector('h2')?.textContent).toBe('Notes');
    expect(query(fixture, 'meetings-home-dialog-summary-pending-review')?.textContent?.trim()).toBe('Pending Review');
    expect(query(fixture, 'meetings-home-dialog-summary-pending')).toBeNull();
    expect(query(fixture, 'meetings-home-dialog-summary-edit')).toBeNull();
  });

  it('does not mark an approved summary as Pending Review', async () => {
    const fixture = await render(buildRow(false), buildSummary(), { showPending: true });

    expect(query(fixture, 'meetings-home-dialog-summary-pending-review')).toBeNull();
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

    it('does not ask for review when approval is not required', async () => {
      const fixture = await render(buildRow(true), buildSummary({ approved: false, requires_approval: false }));

      expect(query(fixture, 'meetings-home-dialog-summary-pending')).toBeNull();
      expect(query(fixture, 'meetings-home-dialog-summary-approve')).toBeTruthy();
    });

    it('keeps Approve after a failed approval', async () => {
      approve.mockReturnValue(throwError(() => new Error('synthetic')));
      const fixture = await render(buildRow(true), buildSummary({ approved: false }));

      await click(fixture, 'meetings-home-dialog-summary-approve');

      expect(onChange).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith({ variant: 'error', position: 'bottom-center', message: 'Failed to approve summary' });
      expect(query(fixture, 'meetings-home-dialog-summary-approve')).toBeTruthy();
    });

    it('edits the text, cancels, then saves', async () => {
      const summary = buildSummary();
      const fixture = await render(buildRow(true), summary);
      expect(query(fixture, 'meetings-home-dialog-summary-approved')?.textContent?.trim()).toBe('Approved');
      expect(query(fixture, 'meetings-home-dialog-summary-approve')).toBeNull();

      await click(fixture, 'meetings-home-dialog-summary-edit');
      expect(query(fixture, 'meetings-home-dialog-summary-markdown-note')?.textContent?.trim()).toBe('Markdown formatting is supported');
      expect((query(fixture, 'meetings-home-dialog-summary-copy')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
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

    it('does not save a blank summary', async () => {
      const fixture = await render(buildRow(true), buildSummary());

      await click(fixture, 'meetings-home-dialog-summary-edit');
      const editor = query(fixture, 'meetings-home-dialog-summary-editor')?.querySelector('textarea') as HTMLTextAreaElement;
      editor.value = '  \n ';
      editor.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      const save = query(fixture, 'meetings-home-dialog-summary-save')?.querySelector('button') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      save.click();

      expect(update).not.toHaveBeenCalled();
    });

    it('stays in edit mode after a failed save', async () => {
      update.mockReturnValue(throwError(() => new Error('synthetic')));
      const fixture = await render(buildRow(true), buildSummary());

      await click(fixture, 'meetings-home-dialog-summary-edit');
      await click(fixture, 'meetings-home-dialog-summary-save');

      expect(onChange).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith({ variant: 'error', position: 'bottom-center', message: 'Failed to update summary' });
      expect(query(fixture, 'meetings-home-dialog-summary-editor')).toBeTruthy();
    });

    it('is read-only without a summary uid to write to', async () => {
      const fixture = await render(buildRow(true), buildSummary({ uid: '' }));

      expect(query(fixture, 'meetings-home-dialog-summary-edit')).toBeNull();
    });
  });
});
