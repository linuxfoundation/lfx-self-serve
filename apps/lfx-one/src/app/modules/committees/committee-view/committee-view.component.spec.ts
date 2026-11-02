// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { VOTE_INVITATION_COUNT_REFRESH_MS } from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import type { Committee, CommitteeMember, CommitteeTab, Meeting, Vote } from '@lfx-one/shared/interfaces';
import { getGroupCommands } from '@lfx-one/shared/utils';
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
import { SurveyService } from '@services/survey.service';
import { UserService } from '@services/user.service';
import { DocumentService } from '@services/document.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, EMPTY, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeViewComponent } from './committee-view.component';

/**
 * Instantiates the page in an injection context to exercise its reactive tab selection and
 * meeting-composer wiring without rendering the two dozen child components in its template.
 */
describe('CommitteeViewComponent', () => {
  let composer: MeetingComposerService;
  let getMeetingsByCommittee: ReturnType<typeof vi.fn>;
  let getCommitteeMembers: ReturnType<typeof vi.fn>;
  let currentCommittee: Committee;
  let getCommittee: ReturnType<typeof vi.fn>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const committee = { uid: 'committee-1', name: 'Technical Steering', my_role: 'member' } as unknown as Committee;
  const meeting = { uid: 'meeting-1', title: 'Weekly sync' } as unknown as Meeting;

  /** `toObservable` bridges emit on effect flush, so every signal write needs one. */
  const flush = (): void => TestBed.tick();

  const createComponent = (): CommitteeViewComponent => TestBed.runInInjectionContext(() => new CommitteeViewComponent());

  beforeEach(() => {
    getMeetingsByCommittee = vi.fn(() => of([meeting]));
    getCommitteeMembers = vi.fn(() => of([]));
    currentCommittee = committee;
    getCommittee = vi.fn(() => of(currentCommittee));
    routeParams = new BehaviorSubject(convertToParamMap({ id: committee.uid }));
    queryParams = new BehaviorSubject(convertToParamMap({}));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerService,
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParams,
            queryParamMap: queryParams,
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
            getCommittee,
            fetchCommittee: vi.fn(() => of(currentCommittee)),
            getCommitteeMembers,
            getCommitteeInvites: vi.fn(() => of([])),
            getCommitteeApplications: vi.fn(() => of([])),
            getMyApplication: vi.fn(() => of(null)),
            getCommitteeEngagement: vi.fn(() => of(null)),
            getChildCommittees: vi.fn(() => of([])),
            updateCommittee: vi.fn(() => of(committee)),
          },
        },
        { provide: MeetingService, useValue: { getMeetingsByCommittee } },
        { provide: MailingListService, useValue: { getMailingListsByCommittee: vi.fn(() => of([])) } },
        {
          provide: VoteService,
          useValue: {
            getVotesByCommittee: vi.fn(() => of([])),
            mergeRecentlyOpenedVotes: vi.fn((v: unknown[]) => v),
            mergeRecentlyCreatedVotes: vi.fn((v: unknown[]) => v),
            hasVotesAwaitingInvitationCount: vi.fn(() => false),
          },
        },
        { provide: SurveyService, useValue: { getSurveysByCommittee: vi.fn(() => of([])) } },
        { provide: DocumentService, useValue: { getCommitteeDocumentCount: vi.fn(() => of(null)) } },
        { provide: MessageService, useValue: { add: vi.fn(), clear: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: UserService, useValue: { user: signal(null), viewerUsername: signal<string | null>('viewer') } },
        { provide: LensService, useValue: { activeLens: signal('project'), setLens: vi.fn() } },
        { provide: ProjectContextService, useValue: { setProject: vi.fn(), setFoundation: vi.fn(), activeContext: signal(null) } },
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

  it('re-fetches votes while a just-opened vote is still counting invitations, then stops (GH-4078)', () => {
    vi.useFakeTimers();
    try {
      currentCommittee = { ...committee, enable_voting: true } as unknown as Committee;
      const voteService = TestBed.inject(VoteService);
      const getVotesByCommittee = vi.mocked(voteService.getVotesByCommittee);
      getVotesByCommittee.mockReturnValue(of([{ uid: 'vote-1' } as unknown as Vote]));
      // The first fetched list is still counting; the catch-up refetch has converged.
      vi.mocked(voteService.hasVotesAwaitingInvitationCount).mockImplementation(
        (votes: Vote[]) => votes.length > 0 && getVotesByCommittee.mock.calls.length === 1
      );

      createComponent();
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(VOTE_INVITATION_COUNT_REFRESH_MS);
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(VOTE_INVITATION_COUNT_REFRESH_MS * 3);
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a row-menu close in parent state, so the vote stays ended after the Votes tab is rebuilt (#4744)', () => {
    currentCommittee = { ...committee, enable_voting: true } as unknown as Committee;
    const voteService = TestBed.inject(VoteService);
    vi.mocked(voteService.getVotesByCommittee).mockReturnValue(of([{ uid: 'vote-1', status: PollStatus.ACTIVE } as unknown as Vote]));

    const component = createComponent();
    flush();
    expect(component.votes()[0].status).toBe(PollStatus.ACTIVE);

    component.onVoteClosed({ uid: 'vote-1', status: PollStatus.ENDED, early_end_time: '2026-10-29T10:00:00Z' } as unknown as Vote);
    flush();
    // committee-votes is destroyed and recreated on a tab switch; it reads votes() again, which must still say ended.
    expect(component.votes()[0]).toMatchObject({ status: PollStatus.ENDED, early_end_time: '2026-10-29T10:00:00Z' });
  });

  it('keeps the votes, badge and silence when a background poll fails, then retries (GH-4078)', () => {
    vi.useFakeTimers();
    try {
      currentCommittee = { ...committee, enable_voting: true } as unknown as Committee;
      const voteService = TestBed.inject(VoteService);
      const messageService = TestBed.inject(MessageService);
      const getVotesByCommittee = vi.mocked(voteService.getVotesByCommittee);
      getVotesByCommittee.mockReturnValue(of([{ uid: 'vote-1' } as unknown as Vote]));
      vi.mocked(voteService.hasVotesAwaitingInvitationCount).mockImplementation((votes: Vote[]) => votes.length > 0);

      const component = createComponent();
      flush();
      expect(component.votes().map((vote) => vote.uid)).toEqual(['vote-1']);

      const setVotesLoading = vi.spyOn(component.votesLoading, 'set');
      getVotesByCommittee.mockReturnValue(throwError(() => new Error('index unavailable')));
      vi.advanceTimersByTime(VOTE_INVITATION_COUNT_REFRESH_MS);
      flush();

      expect(getVotesByCommittee).toHaveBeenCalledTimes(2);
      expect(component.votes().map((vote) => vote.uid)).toEqual(['vote-1']);
      expect(setVotesLoading).not.toHaveBeenCalledWith(true);
      expect(messageService.add).not.toHaveBeenCalled();

      vi.advanceTimersByTime(VOTE_INVITATION_COUNT_REFRESH_MS);
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a poll tick while a foreground votes fetch is loading, so it cannot cancel it (GH-4078)', () => {
    vi.useFakeTimers();
    try {
      currentCommittee = { ...committee, enable_voting: true } as unknown as Committee;
      const voteService = TestBed.inject(VoteService);
      const getVotesByCommittee = vi.mocked(voteService.getVotesByCommittee);
      getVotesByCommittee.mockReturnValue(of([{ uid: 'vote-1' } as unknown as Vote]));
      vi.mocked(voteService.hasVotesAwaitingInvitationCount).mockImplementation((votes: Vote[]) => votes.length > 0);

      const component = createComponent();
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(1);

      // A foreground reload is still in flight when the armed timer fires.
      const pending = new Subject<Vote[]>();
      getVotesByCommittee.mockReturnValue(pending);
      component.onVotesRefreshed();
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(2);
      expect(component.votesLoading()).toBe(true);

      vi.advanceTimersByTime(VOTE_INVITATION_COUNT_REFRESH_MS);
      flush();
      expect(getVotesByCommittee).toHaveBeenCalledTimes(2);
      expect(pending.observed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('Members tab badge', () => {
    it('shows roster length (not total_members) for a writer who is not a regular member', () => {
      // The admin has total_members=0 on the committee object, but the roster fetch returns 3 rows.
      currentCommittee = {
        ...committee,
        total_members: 0,
        my_role: undefined,
        writer: true,
        member_visibility: 'basic_profile',
      } as unknown as Committee;
      getCommitteeMembers.mockReturnValue(of([{ uid: 'm1' }, { uid: 'm2' }, { uid: 'm3' }]));

      const component = createComponent();
      flush();

      const membersTab = component.tabConfig.find((t) => t.key === 'members');
      expect(membersTab?.badge?.()).toBe(3);
    });

    it('falls back to total_members when the roster is not fetched (invite-only member)', () => {
      currentCommittee = {
        ...committee,
        total_members: 5,
        my_role: 'member',
        writer: false,
        auditor: false,
        member_visibility: 'hidden',
      } as unknown as Committee;

      const component = createComponent();
      flush();

      const membersTab = component.tabConfig.find((t) => t.key === 'members');
      expect(membersTab?.badge?.()).toBe(5);
    });
  });

  describe('member_visibility gating', () => {
    const tabKeys = (component: CommitteeViewComponent): string[] => component.visibleTabs().map((tab) => tab.key);

    it('shows the Members tab and fetches the roster for an auditor who is not on the roster', () => {
      currentCommittee = { ...committee, my_role: undefined, member_visibility: 'hidden', writer: false, auditor: true } as unknown as Committee;

      const component = createComponent();
      flush();

      expect(tabKeys(component)).toContain('members');
      expect(getCommitteeMembers).toHaveBeenCalledWith('committee-1');
    });

    it('hides the Members tab and skips the roster fetch for a member when the roster is hidden', () => {
      currentCommittee = { ...committee, member_visibility: 'hidden', writer: false, auditor: false } as unknown as Committee;

      const component = createComponent();
      flush();

      expect(tabKeys(component)).not.toContain('members');
      expect(getCommitteeMembers).not.toHaveBeenCalled();
    });

    it('shows the Members tab to a member when visibility is basic_profile', () => {
      currentCommittee = { ...committee, member_visibility: 'basic_profile', writer: false, auditor: false } as unknown as Committee;

      const component = createComponent();
      flush();

      expect(tabKeys(component)).toContain('members');
      expect(getCommitteeMembers).toHaveBeenCalledWith('committee-1');
    });
  });

  describe('initial tab deep links', () => {
    const member: CommitteeMember = {
      uid: 'synthetic-member-1',
      committee_uid: committee.uid,
      committee_name: committee.name,
      email: 'tab-tester@example.org',
      first_name: 'Synthetic',
      last_name: 'Tab Tester',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    beforeEach(() => {
      currentCommittee = { ...committee, member_visibility: 'basic_profile', enable_voting: true } as Committee;
    });

    it.each<CommitteeTab>(['members', 'votes', 'meetings', 'documents'])('selects %s with synchronous detail and roster', (tab) => {
      queryParams.next(convertToParamMap({ tab }));
      getCommitteeMembers.mockReturnValue(of([member]));

      const component = createComponent();
      flush();

      expect(component.activeTab()).toBe(tab);
      expect(component.members()).toEqual([member]);
    });

    it.each<CommitteeTab>(['members', 'votes'])('waits for delayed detail and roster before selecting %s', (tab) => {
      const detail = new Subject<Committee>();
      const roster = new Subject<CommitteeMember[]>();
      getCommittee.mockReturnValue(detail);
      getCommitteeMembers.mockReturnValue(roster);
      queryParams.next(convertToParamMap({ tab }));

      const component = createComponent();
      flush();
      expect(component.committee()).toBeNull();
      expect(component.membersLoading()).toBe(false);
      expect(component.activeTab()).toBe('overview');

      detail.next(currentCommittee);
      flush();
      // A value alone is not a settled detail read: role loading clears on completion.
      expect(component.myRoleLoading()).toBe(true);
      expect(component.activeTab()).toBe('overview');

      detail.complete();
      flush();
      expect(component.myRoleLoading()).toBe(false);
      expect(component.membersLoading()).toBe(true);
      expect(component.activeTab()).toBe('overview');

      roster.next([member]);
      flush();
      expect(component.activeTab()).toBe('overview');
      roster.complete();
      flush();

      expect(component.activeTab()).toBe(tab);
      expect(component.members()).toEqual([member]);
    });

    it('selects an available Members tab after a failed roster read settles', () => {
      const roster = new Subject<CommitteeMember[]>();
      getCommitteeMembers.mockReturnValue(roster);
      queryParams.next(convertToParamMap({ tab: 'members' }));

      const component = createComponent();
      flush();
      expect(component.activeTab()).toBe('overview');

      roster.error(new Error('Synthetic roster failure'));
      flush();

      expect(component.membersLoading()).toBe(false);
      expect(component.members()).toEqual([]);
      expect(component.activeTab()).toBe('members');
    });

    it.each([undefined, 'not-a-real-tab'])('defaults to Overview for tab=%s', (tab) => {
      queryParams.next(convertToParamMap(tab ? { tab } : {}));

      const component = createComponent();
      flush();

      expect(component.activeTab()).toBe('overview');
    });

    it.each<CommitteeTab>(['members', 'votes'])('consumes a settled but unavailable %s request without waiting for later access', (tab) => {
      currentCommittee = { ...currentCommittee, member_visibility: 'hidden', enable_voting: false, writer: false, auditor: false } as Committee;
      queryParams.next(convertToParamMap({ tab }));
      const component = createComponent();
      flush();

      expect(component.visibleTabs().some((entry) => entry.key === tab)).toBe(false);
      expect(component.activeTab()).toBe('overview');

      currentCommittee = { ...currentCommittee, member_visibility: 'basic_profile', enable_voting: true } as Committee;
      component.refreshCommittee();
      flush();

      expect(component.visibleTabs().some((entry) => entry.key === tab)).toBe(true);
      expect(component.activeTab()).toBe('overview');
    });

    it('preserves a non-Overview manual choice through pending roster completion', () => {
      const roster = new Subject<CommitteeMember[]>();
      getCommitteeMembers.mockReturnValue(roster);
      queryParams.next(convertToParamMap({ tab: 'members' }));
      const component = createComponent();
      flush();

      component.activeTab.set('meetings');
      flush();
      roster.next([member]);
      roster.complete();
      flush();

      expect(component.activeTab()).toBe('meetings');
    });

    it('preserves same-group manual selection on refresh and falls back when that tab becomes hidden', () => {
      queryParams.next(convertToParamMap({ tab: 'members' }));
      const component = createComponent();
      flush();
      expect(component.activeTab()).toBe('members');

      component.activeTab.set('votes');
      currentCommittee = { ...currentCommittee, name: 'Refreshed synthetic group' };
      component.refreshCommittee();
      flush();
      expect(component.activeTab()).toBe('votes');

      currentCommittee = { ...currentCommittee, enable_voting: false };
      component.refreshCommittee();
      flush();
      expect(component.activeTab()).toBe('overview');
    });

    it('resets selection for another group and waits for its own visibility rather than the previous detail', () => {
      queryParams.next(convertToParamMap({ tab: 'members' }));
      const component = createComponent();
      flush();
      expect(component.activeTab()).toBe('members');

      const nextDetail = new Subject<Committee>();
      getCommittee.mockReturnValue(nextDetail);
      routeParams.next(convertToParamMap({ id: 'committee-2' }));
      queryParams.next(convertToParamMap({ tab: 'votes' }));
      flush();
      expect(component.committee()?.uid).toBe(committee.uid);
      expect(component.activeTab()).toBe('overview');

      nextDetail.next({ ...currentCommittee, uid: 'committee-2', enable_voting: false });
      nextDetail.complete();
      flush();
      expect(component.activeTab()).toBe('overview');
      expect(component.visibleTabs().some((entry) => entry.key === 'votes')).toBe(false);
    });

    it('cancels an old group pending selection when navigation reuses the component', () => {
      const oldRoster = new Subject<CommitteeMember[]>();
      getCommitteeMembers.mockReturnValueOnce(oldRoster).mockReturnValue(of([]));
      queryParams.next(convertToParamMap({ tab: 'members' }));
      const component = createComponent();
      flush();
      expect(component.activeTab()).toBe('overview');

      const nextDetail = new Subject<Committee>();
      getCommittee.mockReturnValue(nextDetail);
      routeParams.next(convertToParamMap({ id: 'committee-2' }));
      queryParams.next(convertToParamMap({ tab: 'votes' }));
      flush();
      oldRoster.next([member]);
      oldRoster.complete();
      flush();
      expect(component.activeTab()).toBe('overview');

      nextDetail.next({ ...currentCommittee, uid: 'committee-2' });
      nextDetail.complete();
      flush();
      expect(component.activeTab()).toBe('votes');
    });

    it('matches a case-insensitive vanity slug to a loaded committee UID', () => {
      const detail = new Subject<Committee>();
      getCommittee.mockReturnValue(detail);
      routeParams.next(convertToParamMap({ id: 'SYNTHETIC-STEERING' }));
      queryParams.next(convertToParamMap({ tab: 'members' }));
      const component = createComponent();
      flush();

      detail.next({ ...currentCommittee, sso_group_name: 'synthetic-steering' });
      detail.complete();
      flush();

      expect(component.activeTab()).toBe('members');
    });
  });

  describe('Edit Group link and settings-saved navigation', () => {
    const getProject = (): ReturnType<typeof vi.fn> => TestBed.inject(ProjectService).getProject as unknown as ReturnType<typeof vi.fn>;
    const asWriter = (overrides: Partial<Committee> = {}): void => {
      currentCommittee = { ...committee, writer: true, project_slug: 'proj', is_foundation: false, ...overrides } as unknown as Committee;
    };

    it('offers the wizard link to a writer whose project also reports writer access', () => {
      asWriter();
      getProject().mockReturnValue(of({ writer: true }));

      const component = createComponent();
      flush();

      expect(component.editLink()).toEqual({ commands: getGroupCommands(currentCommittee, 'edit'), queryParams: { project: 'proj' } });
      expect(getProject()).toHaveBeenCalledWith('proj', false, { strictWriter: true });
    });

    it('hides the link from a committee-only writer, since writerGuard would redirect them with an access-denied notice', () => {
      asWriter();
      getProject().mockReturnValue(of({ writer: false }));

      const component = createComponent();
      flush();

      expect(component.editLink()).toBeNull();
    });

    it('hides the link and skips the project lookup for a non-writer', () => {
      currentCommittee = { ...committee, writer: false } as unknown as Committee;

      const component = createComponent();
      flush();

      expect(component.editLink()).toBeNull();
      expect(getProject()).not.toHaveBeenCalled();
    });

    it.each([undefined, ''])('settles sharing access without a retryable failure when project keys are %s', (key) => {
      asWriter({ project_slug: key, project_uid: key });
      const component = createComponent();
      flush();

      expect(component.editLink()).toBeNull();
      expect(component.canShareWeeklyBriefByEmail()).toBe(false);
      expect(component.shareAccessLoading()).toBe(false);
      expect(component.shareAccessError()).toBe(false);
      expect(getProject()).not.toHaveBeenCalled();
    });

    it.each(['null', 'error'])('distinguishes a %s project lookup failure from a permission denial', (failure) => {
      asWriter();
      getProject().mockReturnValue(failure === 'null' ? of(null) : throwError(() => new Error('temporarily unavailable')));
      const component = createComponent();
      flush();

      expect(component.canShareWeeklyBriefByEmail()).toBe(false);
      expect(component.shareAccessLoading()).toBe(false);
      expect(component.shareAccessError()).toBe(true);
    });

    it('retries failed sharing access for the same committee and restores an authorized writer', () => {
      asWriter();
      const pending = new Subject<{ writer: boolean }>();
      getProject().mockReturnValueOnce(of(null)).mockReturnValueOnce(pending);
      const component = createComponent();
      flush();
      expect(component.shareAccessError()).toBe(true);

      component.retryShareAccessCheck();
      expect(component.shareAccessLoading()).toBe(true);
      expect(component.shareAccessError()).toBe(false);
      expect(component.canShareWeeklyBriefByEmail()).toBe(false);
      flush();
      expect(getProject()).toHaveBeenCalledTimes(2);
      expect(getProject()).toHaveBeenNthCalledWith(1, 'proj', false, { strictWriter: true });
      expect(getProject()).toHaveBeenNthCalledWith(2, 'proj', false, { strictWriter: true });

      pending.next({ writer: true });
      pending.complete();
      flush();
      expect(component.shareAccessLoading()).toBe(false);
      expect(component.shareAccessError()).toBe(false);
      expect(component.canShareWeeklyBriefByEmail()).toBe(true);
    });

    it('keeps a confirmed project-writer denial distinct from a failed lookup', () => {
      asWriter();
      getProject().mockReturnValue(of({ writer: false }));
      const component = createComponent();
      flush();

      expect(component.canShareWeeklyBriefByEmail()).toBe(false);
      expect(component.shareAccessError()).toBe(false);
      expect(component.shareAccessLoading()).toBe(false);
    });

    it('refreshes in place after a settings save when the page was opened by UID', () => {
      asWriter();
      const component = createComponent();
      flush();
      const refresh = vi.spyOn(component, 'refreshCommittee');

      component.onSettingsSaved();

      expect(refresh).toHaveBeenCalledOnce();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    });

    it('moves to the stable UID route after a settings save when the page was opened by a vanity slug', () => {
      asWriter();
      routeParams.next(convertToParamMap({ id: 'old-vanity-slug' }));
      const component = createComponent();
      flush();
      const refresh = vi.spyOn(component, 'refreshCommittee');

      component.onSettingsSaved();

      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(getGroupCommands(currentCommittee) ?? ['/groups', 'committee-1'], {
        queryParams: { tab: 'overview' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      expect(refresh).not.toHaveBeenCalled();
    });
    it('keeps the tab the user was on when the redirect moves a slug-opened group to its UID route', () => {
      asWriter();
      routeParams.next(convertToParamMap({ id: 'old-vanity-slug' }));
      const component = createComponent();
      flush();
      component.activeTab.set('settings');

      component.onSettingsSaved();

      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ queryParams: { tab: 'settings' } }));
    });

    it("hides the link from a newly loaded group until that group's own project lookup settles", () => {
      asWriter();
      getProject().mockReturnValue(of({ writer: true }));
      const component = createComponent();
      flush();
      expect(component.editLink()).not.toBeNull();

      const pending = new Subject<{ writer: boolean }>();
      getProject().mockReturnValue(pending);
      asWriter({ uid: 'committee-2', project_slug: 'other-project' });
      routeParams.next(convertToParamMap({ id: 'committee-2' }));
      flush();

      expect(component.committee()?.uid).toBe('committee-2');
      expect(component.editLink()).toBeNull();

      pending.next({ writer: true });
      flush();

      expect(component.editLink()).not.toBeNull();
    });
  });
});
