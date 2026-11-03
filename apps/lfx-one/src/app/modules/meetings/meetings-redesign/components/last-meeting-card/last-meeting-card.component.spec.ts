// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { MeetingHomeRow, PastMeeting, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { toPastMeetingHomeRow } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDialogsService } from '../../services/meetings-home-dialogs.service';
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
  let dialogs: { openSummary: ReturnType<typeof vi.fn>; openRecording: ReturnType<typeof vi.fn> };

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
    dialogs = { openSummary: vi.fn(), openRecording: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl } },
        { provide: MeetingsHomeDialogsService, useValue: dialogs },
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

    expect(text(fixture, 'meetings-home-last-card-empty')).toContain('No past meetings yet');
    expect(text(fixture, 'meetings-home-last-card-empty')).toContain('Your past meetings will appear here.');
  });

  it('renders the tile, project, title, when line and the type and recurring tags', async () => {
    const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' } });
    const fixture = await render({ row: rowOf(meeting), summary: null });

    expect(text(fixture, 'meetings-home-last-card-date')).toContain(String(START.getDate()));
    expect(query(fixture, 'meetings-home-last-card-visibility-public')).toBeTruthy();
    expect(query(fixture, 'meetings-home-last-card-project')?.getAttribute('aria-label')).toBe('Jump to project: Kubernetes');
    expect(text(fixture, 'meetings-home-last-card-title')).toBe('Steering sync');
    const day = START.toLocaleString('en-US', { weekday: 'short' });
    const time = START.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    expect(text(fixture, 'meetings-home-last-card-when')).toBe(`${day}, ${time} · 60m`);
    expect(text(fixture, 'meetings-home-last-card-type')).toBe('Technical');
    expect(text(fixture, 'meetings-home-last-card-recurring')).toBe('Recurring');
    expect(fixture.nativeElement.textContent).not.toContain('Steering Committee');
  });

  it('shows no recurring tag for a one-off meeting', async () => {
    const fixture = await render({ row: rowOf(buildMeeting()), summary: null });

    expect(query(fixture, 'meetings-home-last-card-recurring')).toBeNull();
  });

  it('opens the meeting page when the card is clicked', async () => {
    const fixture = await render({ row: rowOf(buildMeeting()), summary: null });

    query(fixture, 'meetings-home-last-card')?.click();

    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/m-1-occ');
  });

  describe('recording and AI summary', () => {
    it.each<[string, Partial<PastMeetingSummary>, boolean | undefined, boolean]>([
      ['approved, invitee', { approved: true, requires_approval: true }, undefined, true],
      ['approval not required, invitee', { approved: false, requires_approval: false }, undefined, true],
      ['pending approval, invitee', { approved: false, requires_approval: true }, false, false],
      ['pending approval, organizer', { approved: false, requires_approval: true }, true, true],
    ])('AI Summary for %s', async (_label, flags, organizer, shown) => {
      const fixture = await render({ row: rowOf(buildMeeting({ organizer })), summary: buildSummary(flags) });

      expect(!!query(fixture, 'meetings-home-last-card-summary')).toBe(shown);
    });

    it('tells an organizer the summary is awaiting their review', async () => {
      const pending = { approved: false, requires_approval: true };
      const fixture = await render({ row: rowOf(buildMeeting({ organizer: true })), summary: buildSummary(pending) });

      expect(text(fixture, 'meetings-home-last-card-summary-pending')).toBe('Awaiting your review');

      fixture.componentRef.setInput('summary', buildSummary());
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-last-card-summary-pending')).toBeNull();
    });

    it.each<[PastMeetingSummary | null | undefined, string | null | undefined]>([
      [undefined, undefined],
      [null, null],
      [buildSummary({ summary_data: { ...buildSummary().summary_data, content: '  ' } }), null],
    ])('shows neither button for summary %o and recording %s', async (summary, recordingUrl) => {
      const fixture = await render({ row: rowOf(buildMeeting()), summary, recordingUrl });

      expect(query(fixture, 'meetings-home-last-card-summary')).toBeNull();
      expect(query(fixture, 'meetings-home-last-card-recording')).toBeNull();
    });

    it('puts Recording before AI Summary', async () => {
      const fixture = await render({ row: rowOf(buildMeeting()), summary: buildSummary(), recordingUrl: 'https://zoom.example/rec' });

      const buttons = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('lfx-ui-button'));
      expect(buttons.map((button) => button.dataset['testid'])).toEqual(['meetings-home-last-card-recording', 'meetings-home-last-card-summary']);
    });

    it('opens the recording and summary dialogs without opening the meeting', async () => {
      const summary = buildSummary();
      const fixture = await render({ row: rowOf(buildMeeting()), summary, recordingUrl: 'https://zoom.example/rec' });

      clickButton(fixture, 'meetings-home-last-card-recording');
      clickButton(fixture, 'meetings-home-last-card-summary');

      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(dialogs.openRecording).toHaveBeenCalledWith(expect.objectContaining({ key: 'm-1-occ' }), 'https://zoom.example/rec');
      expect(dialogs.openSummary).toHaveBeenCalledWith(expect.objectContaining({ key: 'm-1-occ', title: 'Steering sync' }), summary, expect.any(Function));
    });

    it('passes a summary saved in the dialog back out', async () => {
      const fixture = await render({ row: rowOf(buildMeeting({ organizer: true })), summary: buildSummary({ approved: false }) });
      const changes: PastMeetingSummary[] = [];
      fixture.componentInstance.summaryChange.subscribe((change) => changes.push(change));

      clickButton(fixture, 'meetings-home-last-card-summary');
      const approved = buildSummary({ approved: true });
      dialogs.openSummary.mock.calls[0][2](approved);

      expect(changes).toEqual([approved]);
    });
  });
});
