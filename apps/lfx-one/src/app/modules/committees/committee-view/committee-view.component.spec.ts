// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import type { Committee, Meeting } from '@lfx-one/shared/interfaces';
import { CommitteeJoinApplicationSessionService } from '@services/committee-join-application-session.service';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InvitationService } from '@services/invitation.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeViewComponent } from './committee-view.component';

/**
 * Covers the wire between the meeting composer and this page's meeting list. The composer opens as
 * a drawer over the group page and closes back onto it instead of navigating, so a meeting created
 * or edited from the Meetings tab only reaches the list if `saveCount` refetches it.
 *
 * The component is instantiated directly rather than rendered: the assertions are all about the
 * constructor's stream wiring, and the template pulls in two dozen child components.
 */
describe('CommitteeViewComponent', () => {
  let composer: MeetingComposerService;
  let getMeetingsByCommittee: ReturnType<typeof vi.fn>;

  const committee = { uid: 'committee-1', name: 'Technical Steering', my_role: 'member' } as unknown as Committee;
  const meeting = { uid: 'meeting-1', title: 'Weekly sync' } as unknown as Meeting;

  /** `toObservable` bridges emit on effect flush, so every signal write needs one. */
  const flush = (): void => TestBed.tick();

  const createComponent = (): CommitteeViewComponent => TestBed.runInInjectionContext(() => new CommitteeViewComponent());

  beforeEach(() => {
    getMeetingsByCommittee = vi.fn(() => of([meeting]));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerService,
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'committee-1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: Router,
          useValue: {
            url: '/groups/committee-1',
            events: EMPTY,
            navigate: vi.fn(),
            getCurrentNavigation: vi.fn(() => null),
            parseUrl: vi.fn(() => ({ queryParams: {} })),
          },
        },
        {
          provide: CommitteeService,
          useValue: {
            getCommittee: vi.fn(() => of(committee)),
            fetchCommittee: vi.fn(() => of(committee)),
            getCommitteeMembers: vi.fn(() => of([])),
            getCommitteeInvites: vi.fn(() => of([])),
            getCommitteeApplications: vi.fn(() => of([])),
            getCommitteeEngagement: vi.fn(() => of(null)),
            getChildCommittees: vi.fn(() => of([])),
            updateCommittee: vi.fn(() => of(committee)),
          },
        },
        { provide: MeetingService, useValue: { getMeetingsByCommittee } },
        { provide: MailingListService, useValue: { getMailingListsByCommittee: vi.fn(() => of([])) } },
        { provide: MessageService, useValue: { add: vi.fn(), clear: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: UserService, useValue: { user: signal(null), viewerUsername: signal<string | null>('viewer') } },
        { provide: LensService, useValue: { activeLens: signal('project'), setLens: vi.fn() } },
        { provide: ProjectContextService, useValue: { setProject: vi.fn(), setFoundation: vi.fn() } },
        { provide: ProjectService, useValue: { getProject: vi.fn(() => of(null)) } },
        {
          provide: InvitationService,
          useValue: {
            pendingInvitations: signal([]),
            resolvedInviteUids: signal(new Set<string>()),
            loadPendingInvitations: vi.fn(() => of([])),
            markResolved: vi.fn(),
            unmarkResolved: vi.fn(),
            forgetResolved: vi.fn(),
          },
        },
        {
          provide: CommitteeJoinApplicationSessionService,
          useValue: { pendingCommitteeUids: signal(new Set<string>()), markPending: vi.fn(), clearPending: vi.fn() },
        },
        { provide: InvitationAcceptFlowService, useValue: { resolveCurrentEmployer: vi.fn(() => of(null)) } },
        { provide: FeatureFlagService, useValue: { providerReady: signal(true), getBooleanFlag: () => signal(false) } },
      ],
    });

    composer = TestBed.inject(MeetingComposerService);
  });

  it('refetches the meeting list when the composer reports a save', () => {
    createComponent();
    flush();

    expect(getMeetingsByCommittee).toHaveBeenCalledTimes(1);
    expect(getMeetingsByCommittee).toHaveBeenCalledWith('committee-1');

    composer.notifySaved();
    flush();

    // The new meeting is only on the Meetings tab if the page went back to the API for it.
    expect(getMeetingsByCommittee).toHaveBeenCalledTimes(2);
  });

  it('folds a save that happened before it mounted into the first fetch', () => {
    // `saveCount` is monotonic and lives in a root service, so a page mounted after an earlier save
    // sees a non-zero count replayed on subscribe. `combineLatest` waits for both sources, so that
    // replay joins the initial fetch instead of doubling it.
    composer.notifySaved();

    createComponent();
    flush();

    expect(getMeetingsByCommittee).toHaveBeenCalledTimes(1);
  });
});
