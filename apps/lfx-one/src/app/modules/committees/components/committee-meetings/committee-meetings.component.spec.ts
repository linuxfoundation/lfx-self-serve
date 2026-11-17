// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Committee } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { CommitteeService } from '@services/committee.service';
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
 * Covers "Schedule meeting" on the group's meetings tab.
 *
 * The freshness re-check has to run before the composer opens — a member demoted since the tab
 * rendered must be turned away rather than handed a create surface. And the group and project
 * context has to survive the handoff into the composer, which takes it as arguments.
 */
describe('CommitteeMeetingsComponent — schedule meeting', () => {
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
    activeLens = signal('project');
    fetchCommittee = vi.fn().mockReturnValue(of(COMMITTEE));
    navigate = vi.fn();
    composerOpen = vi.fn();
  });

  it('opens the composer over the tab', async () => {
    const component = await mount();

    schedule(component);

    // `project_uid` comes off the freshly fetched committee rather than the input: the probe's
    // response is the newer of the two, and the composer scopes its people and group pickers by it.
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'create', committeeUid: 'committee-1', projectUid: 'project-1' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('re-checks write access before the composer opens', async () => {
    const component = await mount();

    schedule(component);

    expect(fetchCommittee).toHaveBeenCalledWith('committee-1');
  });

  it('turns away a member whose write access was revoked since the tab rendered', async () => {
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
    fetchCommittee.mockReturnValue(throwError(() => new Error('network')));
    const component = await mount();

    schedule(component);

    // Failing closed: an unanswerable permission question is not a yes.
    expect(composerOpen).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'meetings', project: 'acme' } });
  });
});
