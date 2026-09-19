// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Committee } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { SurveyService } from '@services/survey.service';
import { VoteService } from '@services/vote.service';
import { DialogService } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeMeetingsComponent } from './committee-meetings.component';

const COMMITTEE = { uid: 'committee-1', project_slug: 'acme', project_uid: 'project-1', writer: true } as Committee;

/**
 * Covers "Schedule meeting" on the group's meetings tab across both sides of
 * `MEETING_V2_ENABLED_FLAG`.
 *
 * Two things have to stay true no matter which surface the flag picks. The freshness re-check has to
 * run on both branches — it is a permission probe, not a v2 feature, and a member demoted since the
 * tab rendered must be turned away whichever create screen they were heading for. And the group and
 * project context has to survive the handoff: the pre-v2 page reads it out of the URL, the composer
 * takes it as arguments, so the same click has to produce equivalent context in two different shapes.
 */
describe('CommitteeMeetingsComponent — create surface per flag', () => {
  /** `MEETING_V2_ENABLED_FLAG`. Stated per test: the real service answers `false` in a TestBed. */
  let meetingsV2Enabled: ReturnType<typeof signal<boolean>>;
  let activeLens: ReturnType<typeof signal<string>>;
  let fetchCommittee: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let composerOpen: ReturnType<typeof vi.fn>;

  /** Mounts the tab over `committee` with an empty template — this suite exercises the handler, not the markup. */
  async function mount(committee: Committee = COMMITTEE): Promise<CommitteeMeetingsComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: CommitteeService, useValue: { fetchCommittee } },
        { provide: LensService, useValue: { activeLens } },
        {
          provide: MeetingService,
          useValue: { getPastMeetingsByCommittee: vi.fn().mockReturnValue(of([])) },
        },
        { provide: VoteService, useValue: { getVotesByCommittee: vi.fn().mockReturnValue(of([])) } },
        { provide: SurveyService, useValue: { getSurveysByCommittee: vi.fn().mockReturnValue(of([])) } },
        { provide: Router, useValue: { navigate } },
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => meetingsV2Enabled } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // Empty template, and `providers: []` to drop the component's own `DialogService` so the stub
    // above is the one injected. The real markup mounts FullCalendar and a card per meeting, none of
    // which this handler touches.
    TestBed.overrideComponent(CommitteeMeetingsComponent, { set: { template: '', imports: [], providers: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(CommitteeMeetingsComponent);
    fixture.componentRef.setInput('committee', committee);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  /** `onScheduleMeeting` is protected — the template is its only other caller. */
  const schedule = (component: CommitteeMeetingsComponent): void => (component as unknown as { onScheduleMeeting: () => void }).onScheduleMeeting();

  beforeEach(() => {
    meetingsV2Enabled = signal(false);
    activeLens = signal('project');
    fetchCommittee = vi.fn().mockReturnValue(of(COMMITTEE));
    navigate = vi.fn();
    composerOpen = vi.fn();
  });

  it('sends the organizer to the pre-v2 create page with the group in the URL while the flag is off', async () => {
    const component = await mount();

    schedule(component);

    // The pre-v2 page has no ambient group context, so `committee_uid` and `project` are the only
    // things carrying it over — `project` is also what `writerGuard` resolves write access from.
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'create'], { queryParams: { committee_uid: 'committee-1', project: 'acme' } });
    expect(composerOpen).not.toHaveBeenCalled();
  });

  it('opens the composer over the tab once the flag is on', async () => {
    meetingsV2Enabled.set(true);
    const component = await mount();

    schedule(component);

    // `project_uid` comes off the freshly fetched committee rather than the input: the probe's
    // response is the newer of the two, and the composer scopes its people and group pickers by it.
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'create', committeeUid: 'committee-1', projectUid: 'project-1' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('re-checks write access before either surface opens', async () => {
    const component = await mount();
    schedule(component);
    expect(fetchCommittee).toHaveBeenCalledWith('committee-1');

    fetchCommittee.mockClear();
    meetingsV2Enabled.set(true);
    schedule(component);

    // Same probe on the v2 side. Skipping it there would make turning the flag on quietly weaken a
    // permission check, which is the one thing a display flag must never do.
    expect(fetchCommittee).toHaveBeenCalledWith('committee-1');
  });

  it('turns away a member whose write access was revoked since the tab rendered, flag off', async () => {
    fetchCommittee.mockReturnValue(of({ ...COMMITTEE, writer: false }));
    const component = await mount();

    schedule(component);

    expect(navigate).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'meetings', project: 'acme' } });
    expect(composerOpen).not.toHaveBeenCalled();
  });

  it('turns away the same revoked member with the flag on', async () => {
    meetingsV2Enabled.set(true);
    fetchCommittee.mockReturnValue(of({ ...COMMITTEE, writer: false }));
    const component = await mount();

    schedule(component);

    expect(composerOpen).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'meetings', project: 'acme' } });
  });

  it('returns a denied member to the foundation overview when that is the lens they came from', async () => {
    activeLens.set('foundation');
    fetchCommittee.mockReturnValue(of({ ...COMMITTEE, writer: false }));
    const component = await mount();

    schedule(component);

    expect(navigate).toHaveBeenCalledWith(['/foundation/overview'], { queryParams: { _notice: 'meetings', project: 'acme' } });
  });

  it('denies rather than opens when the freshness probe itself fails', async () => {
    meetingsV2Enabled.set(true);
    fetchCommittee.mockReturnValue(throwError(() => new Error('network')));
    const component = await mount();

    schedule(component);

    // Failing closed: an unanswerable permission question is not a yes.
    expect(composerOpen).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'meetings', project: 'acme' } });
  });

  it('omits the project param for a group whose project slug is unknown', async () => {
    const component = await mount({ uid: 'committee-1', project_uid: 'project-1', writer: true } as Committee);

    schedule(component);

    // An empty `project=` would resolve to no project at all in the guard, which is worse than
    // leaving it out and letting the page fall back to the committee.
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'create'], { queryParams: { committee_uid: 'committee-1' } });
  });
});
