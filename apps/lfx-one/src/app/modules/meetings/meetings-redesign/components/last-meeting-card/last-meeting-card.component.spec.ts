// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranscriptModalComponent } from '@app/modules/meetings/components/transcript-modal/transcript-modal.component';
import { RecordingModalComponent } from '@components/recording-modal/recording-modal.component';
import { SummaryModalComponent } from '@components/summary-modal/summary-modal.component';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { MeetingHomeRow, PastMeeting, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { toPastMeetingHomeRow } from '@lfx-one/shared/utils';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LastMeetingCardComponent } from './last-meeting-card.component';

const START = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

function buildMeeting(overrides: Partial<PastMeeting> = {}): PastMeeting {
  return {
    id: 'm-1-occ',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Kubernetes',
    project_slug: 'kubernetes',
    is_foundation: false,
    start_time: START.toISOString(),
    duration: 60,
    timezone: 'UTC',
    title: 'Steering sync',
    description: '',
    recurrence: null,
    committees: [{ uid: 'c-1', name: 'Steering Committee' }],
    meeting_type: 'Technical',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: null,
    invited: true,
    occurrences: [],
    scheduled_start_time: START.toISOString(),
    scheduled_end_time: new Date(START.getTime() + 60 * 60 * 1000).toISOString(),
    meeting_id: 'm-1',
    occurrence_id: 'occ',
    meeting_and_occurrence_id: 'm-1-occ',
    platform_meeting_id: '',
    sessions: [],
    ...overrides,
  };
}

function buildSummary(overrides: Partial<PastMeetingSummary> = {}): PastMeetingSummary {
  return {
    uid: 's-1',
    meeting_id: 'm-1',
    past_meeting_id: 'm-1-occ',
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

const rowOf = (meeting: PastMeeting): MeetingHomeRow => toPastMeetingHomeRow(meeting) as MeetingHomeRow;

describe('LastMeetingCardComponent', () => {
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;

  const render = async (inputs: Record<string, unknown>): Promise<ComponentFixture<LastMeetingCardComponent>> => {
    const fixture = TestBed.createComponent(LastMeetingCardComponent);
    for (const [name, value] of Object.entries({ row: null, ...inputs })) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<LastMeetingCardComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (fixture: ComponentFixture<LastMeetingCardComponent>, testId: string): string => query(fixture, testId)?.textContent?.trim() ?? '';
  const clickButton = (fixture: ComponentFixture<LastMeetingCardComponent>, testId: string): void =>
    (query(fixture, testId)?.querySelector('button') ?? query(fixture, testId))?.click();

  beforeEach(() => {
    navigateByUrl = vi.fn().mockResolvedValue(true);
    openDialog = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl } },
        { provide: DialogService, useValue: { open: openDialog } },
      ],
    });
  });

  it('shows a skeleton while loading', async () => {
    const fixture = await render({ loading: true });

    expect(query(fixture, 'meetings-home-last-card-loading')).toBeTruthy();
    expect(query(fixture, 'meetings-home-last-card')).toBeNull();
    expect(query(fixture, 'meetings-home-last-card-empty')).toBeNull();
  });

  it('shows the empty card when the viewer has no past meeting', async () => {
    const fixture = await render({ row: null });

    expect(text(fixture, 'meetings-home-last-card-empty')).toContain('You haven’t joined a meeting yet');
    expect(text(fixture, 'meetings-home-last-card-empty')).toContain('Your past meetings will appear here.');
  });

  it('renders the tile, project, title, when line and tags', async () => {
    const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' } });
    const fixture = await render({ row: rowOf(meeting), summary: null });

    expect(text(fixture, 'meetings-home-last-card-date')).toContain(String(START.getDate()));
    expect(query(fixture, 'meetings-home-last-card-visibility-public')).toBeTruthy();
    expect(query(fixture, 'meetings-home-last-card-project')?.getAttribute('aria-label')).toBe('Jump to project: Kubernetes');
    expect(text(fixture, 'meetings-home-last-card-title')).toBe('Steering sync');
    const day = START.toLocaleString('en-US', { weekday: 'short' });
    const time = START.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    expect(text(fixture, 'meetings-home-last-card-when')).toBe(`${day}, ${time} · 60m`);
    expect(text(fixture, 'meetings-home-last-card-recurring')).toBe('Recurring');
    expect(text(fixture, 'meetings-home-last-card-type')).toBe('Technical');
    expect(text(fixture, 'meetings-home-last-card-group')).toBe('Steering Committee');
  });

  it('opens the meeting page when the card is clicked', async () => {
    const fixture = await render({ row: rowOf(buildMeeting()), summary: null });

    query(fixture, 'meetings-home-last-card')?.click();

    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/m-1-occ');
  });

  describe('AI summary', () => {
    it('shows a placeholder while the summary loads', async () => {
      const fixture = await render({ row: rowOf(buildMeeting()), summary: undefined });

      expect(query(fixture, 'meetings-home-last-card-summary-loading')).toBeTruthy();
      expect(query(fixture, 'meetings-home-last-card-summary')).toBeNull();
    });

    it('shows the edited text without markdown', async () => {
      const summary = buildSummary({ summary_data: { ...buildSummary().summary_data, edited_content: '**Edited** notes' } });
      const fixture = await render({ row: rowOf(buildMeeting()), summary });

      expect(text(fixture, 'meetings-home-last-card-summary-text')).toBe('Edited notes');
    });

    it.each<[string, Partial<PastMeetingSummary>, boolean | undefined, boolean]>([
      ['approved, invitee', { approved: true, requires_approval: true }, undefined, true],
      ['approval not required, invitee', { approved: false, requires_approval: false }, undefined, true],
      ['pending approval, invitee', { approved: false, requires_approval: true }, false, false],
      ['pending approval, organizer', { approved: false, requires_approval: true }, true, true],
    ])('%s', async (_label, flags, organizer, shown) => {
      const fixture = await render({ row: rowOf(buildMeeting({ organizer })), summary: buildSummary(flags) });

      expect(!!query(fixture, 'meetings-home-last-card-summary')).toBe(shown);
    });

    it('hides the section when there is no summary or it is empty', async () => {
      const fixture = await render({ row: rowOf(buildMeeting()), summary: null });
      expect(query(fixture, 'meetings-home-last-card-summary')).toBeNull();

      fixture.componentRef.setInput('summary', buildSummary({ summary_data: { ...buildSummary().summary_data, content: '  ' } }));
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-last-card-summary')).toBeNull();
    });

    it('opens the summary dialog read-only for an invitee without opening the meeting', async () => {
      const summary = buildSummary();
      const fixture = await render({ row: rowOf(buildMeeting()), summary });

      clickButton(fixture, 'meetings-home-last-card-read-more');

      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(openDialog).toHaveBeenCalledWith(
        SummaryModalComponent,
        expect.objectContaining({
          data: expect.objectContaining({ summaryContent: summary.summary_data.content, summaryUid: 's-1', pastMeetingUid: 'm-1-occ', readOnly: true }),
        })
      );
    });

    it('lets an organizer edit and passes the update back', async () => {
      const summary = buildSummary({ approved: false });
      const fixture = await render({ row: rowOf(buildMeeting({ organizer: true })), summary });
      const changes: PastMeetingSummary[] = [];
      fixture.componentInstance.summaryChange.subscribe((change) => changes.push(change));

      clickButton(fixture, 'meetings-home-last-card-read-more');
      const data = openDialog.mock.calls[0][1].data;
      data.onSummaryUpdated({ content: 'New text', approved: true });

      expect(data.readOnly).toBe(false);
      expect(changes).toEqual([{ ...summary, approved: true, summary_data: { ...summary.summary_data, edited_content: 'New text' } }]);
    });
  });

  describe('transcript and recording', () => {
    it.each<[boolean | null | undefined, string | null | undefined]>([
      [undefined, undefined],
      [null, null],
      [false, null],
    ])('shows neither button for transcript %s and recording %s', async (hasTranscript, recordingUrl) => {
      const fixture = await render({ row: rowOf(buildMeeting()), summary: null, hasTranscript, recordingUrl });

      expect(query(fixture, 'meetings-home-last-card-transcript')).toBeNull();
      expect(query(fixture, 'meetings-home-last-card-recording')).toBeNull();
    });

    it('opens the transcript and recording dialogs', async () => {
      const fixture = await render({ row: rowOf(buildMeeting()), summary: null, hasTranscript: true, recordingUrl: 'https://zoom.example/rec' });

      clickButton(fixture, 'meetings-home-last-card-transcript');
      clickButton(fixture, 'meetings-home-last-card-recording');

      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(openDialog).toHaveBeenCalledWith(
        TranscriptModalComponent,
        expect.objectContaining({ data: { pastMeetingUid: 'm-1-occ', meetingTitle: 'Steering sync' } })
      );
      expect(openDialog).toHaveBeenCalledWith(
        RecordingModalComponent,
        expect.objectContaining({ data: { shareUrl: 'https://zoom.example/rec', meetingTitle: 'Steering sync' } })
      );
    });
  });
});
