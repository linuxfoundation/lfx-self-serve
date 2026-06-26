// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, linkedSignal, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  Committee,
  CommitteeInvite,
  CommitteeMember,
  CommitteeMemberVisibility,
  CommitteePermissionLevel,
  CommitteeTab,
  getCommitteeCategorySeverity,
  TagSeverity,
} from '@lfx-one/shared';
import { GroupsIOMailingList, PendingInvitation, ProjectContext, TabConfigEntry } from '@lfx-one/shared/interfaces';
import { COMMITTEE_VALID_TABS } from '@lfx-one/shared/constants';
import {
  canManageCommitteeMembers,
  findPendingInvitationForCommittee,
  invitationRequiresOrganization,
  getChatPlatformIcon,
  getChatPlatformLabel,
  getRepoPlatformIcon,
  getRepoPlatformLabel,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InvitationService } from '@services/invitation.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { CategoryAvatarColorPipe } from '@pipes/category-avatar-color.pipe';
import { InitialsPipe } from '@pipes/initials.pipe';
import { InvitationSubtextPipe } from '@pipes/invitation-subtext.pipe';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { SafeUrlPipe } from '@pipes/safe-url.pipe';
import { DescriptionDialogComponent } from '../components/description-dialog/description-dialog.component';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, EMPTY, exhaustMap, filter, finalize, map, of, switchMap, take, timer } from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { syncEntityProjectContext } from '@shared/utils/entity-project-context.util';
import { JoinApplicationDialogResult } from '@lfx-one/shared/interfaces';
import { JoinApplicationDialogComponent } from '../components/join-application-dialog/join-application-dialog.component';

import { CommitteeDocumentsComponent } from '../components/committee-documents/committee-documents.component';
import { CommitteeMeetingsComponent } from '../components/committee-meetings/committee-meetings.component';
import { CommitteeMembersComponent } from '../components/committee-members/committee-members.component';
import { CommitteeOverviewComponent } from '../components/committee-overview/committee-overview.component';
import { MailingListEmailPipe } from '../components/committee-settings-tab/pipes/mailing-list-email.pipe';
import { CommitteeSettingsTabComponent } from '../components/committee-settings-tab/committee-settings-tab.component';
import { CommitteeSurveysComponent } from '../components/committee-surveys/committee-surveys.component';
import { CommitteeVotesComponent } from '../components/committee-votes/committee-votes.component';

/** Window before a declined invite is actually sent upstream, during which the user can undo. */
const INVITE_DECLINE_UNDO_MS = 5000;

/** Dedicated toast key so the inline undo template renders only for this component's decline toast. */
const INVITE_TOAST_KEY = 'committee-view-invite';

@Component({
  selector: 'lfx-committee-view',
  imports: [
    ButtonComponent,
    CardComponent,
    TagComponent,
    RouteLoadingComponent,
    DatePipe,
    NgClass,
    PopoverModule,
    SkeletonModule,
    ToastModule,
    CategoryAvatarColorPipe,
    InitialsPipe,
    InvitationSubtextPipe,
    JoinModeLabelPipe,
    MailingListEmailPipe,
    SafeUrlPipe,
    CommitteeDocumentsComponent,
    CommitteeMeetingsComponent,
    CommitteeMembersComponent,
    CommitteeOverviewComponent,
    CommitteeSettingsTabComponent,
    CommitteeSurveysComponent,
    CommitteeVotesComponent,
  ],
  providers: [DialogService],
  templateUrl: './committee-view.component.html',
  styleUrl: './committee-view.component.scss',
  host: { '(document:click)': 'onDocumentClick()' },
})
export class CommitteeViewComponent {
  // -- Injections --
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly committeeService = inject(CommitteeService);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly invitationService = inject(InvitationService);
  private readonly invitationAcceptFlow = inject(InvitationAcceptFlowService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly navBackLabel: string | null = this.router.getCurrentNavigation()?.extras?.state?.['backLabel'] ?? null;

  public meetingsTimeFilter = signal<'upcoming' | 'past'>('upcoming');

  private readonly committeeId: Signal<string | null> = this.initCommitteeId();
  // Reactive so it updates when navigating to another committee with a different ?tab=.
  private readonly initialTab: Signal<CommitteeTab | null> = this.initInitialTab();

  // -- Writable signals --
  public loading = signal<boolean>(true);
  // Tracks any in-flight committee fetch (initial OR silent refresh). Distinct from
  // `loading`, which only gates the full-page spinner on the initial fetch.
  public committeeRefreshing = signal<boolean>(false);
  public error = signal<boolean>(false);
  public errorType = signal<'not-found' | 'access-denied' | 'server-error' | null>(null);
  public refresh = signal(0);
  public membersRefresh = signal(0);
  public membersLoading = signal<boolean>(true);
  public invitesLoading = signal<boolean>(true);
  public joiningOrLeaving = signal(false);

  // -- Computed / toSignal --
  public committee: Signal<Committee | null> = this.initializeCommittee();
  public members: Signal<CommitteeMember[]> = this.initializeMembers();
  // Pending invites share the members refresh trigger so adding/revoking refreshes both.
  public invites: Signal<CommitteeInvite[]> = this.initializeInvites();

  // Membership identity comes from server-enriched fields on the committee record,
  // resolved via the username-tagged membership query so visibility doesn't depend
  // on the caller's authenticated email matching their member row.
  public myRole: Signal<string | null> = computed(() => this.committee()?.my_role ?? null);
  public myMemberUid: Signal<string | null> = computed(() => this.committee()?.my_member_uid ?? null);
  // Track the committee request itself (initial + silent refresh) so the join/leave CTA
  // doesn't flash the wrong state in the window between a join action and the refreshed
  // committee response carrying the new my_role.
  public myRoleLoading: Signal<boolean> = computed(() => this.loading() || this.committeeRefreshing());
  public isVisitor: Signal<boolean> = computed(() => this.myRole() === null && !this.myRoleLoading());

  // Pending invitation for THIS committee, surfaced from the shared cross-surface cache so a user
  // landing on a group they were invited to can accept/decline right here. Excludes invites already
  // resolved this session, and is suppressed once the user is a member (my_role populated).
  public readonly inviteToastKey = INVITE_TOAST_KEY;
  public pendingInvitation: Signal<PendingInvitation | null> = computed(() => {
    const committee = this.committee();
    if (!committee?.uid || !this.isVisitor()) {
      return null;
    }
    return findPendingInvitationForCommittee(this.invitationService.pendingInvitations(), this.invitationService.resolvedInviteUids(), committee.uid);
  });

  // When the committee 403s and committee() is null, pendingInvitation() returns null because it
  // requires committee.uid. This signal resolves the same invite using the route :id directly so
  // the error state can surface the accept flow without a loaded committee record.
  public pendingInvitationFromRoute: Signal<PendingInvitation | null> = this.initPendingInvitationFromRoute();

  // Deferred-decline timers keyed by invite UID (committee UID stored alongside since the invite is
  // out of the cache by the time the timer/destroy flush fires). Mirrors the dashboard/My Groups UX.
  private readonly pendingDeclines = new Map<string, { committeeUid: string; timerId: ReturnType<typeof setTimeout> }>();

  public categorySeverity: Signal<TagSeverity> = computed(() => {
    const category = this.committee()?.category;
    return getCommitteeCategorySeverity(category || '');
  });

  public backLabel: Signal<string> = computed(() => this.navBackLabel ?? (this.lensService.activeLens() === 'me' ? 'My Groups' : 'Groups'));

  public canEdit: Signal<boolean> = computed(() => !!this.committee()?.writer);

  public canReview: Signal<boolean> = computed(() => {
    if (this.canEdit()) return false;
    const email = this.userService.user()?.email?.toLowerCase();
    if (!email) return false;
    return this.committee()?.auditors?.some((u) => u.email?.toLowerCase() === email) ?? false;
  });

  public myPermission: Signal<CommitteePermissionLevel> = computed(() => {
    if (this.canEdit()) return 'manage';
    if (this.canReview()) return 'review';
    return 'member';
  });

  public hasChannels: Signal<boolean> = computed(() => {
    const c = this.committee();
    return this.associatedMailingLists().length > 0 || !!(c?.chat_channel || c?.website) || this.canEdit();
  });

  public mlExpanded = signal(false);

  public chatPlatformLabel: Signal<string> = this.initChatPlatformLabel();
  public chatPlatformIcon: Signal<string> = this.initChatPlatformIcon();
  public repoPlatformLabel: Signal<string> = this.initRepoPlatformLabel();
  public repoPlatformIcon: Signal<string> = this.initRepoPlatformIcon();

  // -- Associated mailing lists (rich objects filtered by ml.committees[]) --
  public associatedMailingLists: Signal<GroupsIOMailingList[]> = this.initAssociatedMailingLists();
  public extraMailingLists: Signal<GroupsIOMailingList[]> = computed(() => this.associatedMailingLists().slice(1));
  public extraMailingListCount: Signal<number> = computed(() => this.associatedMailingLists().length - 1);

  // -- Sub-groups --
  public subGroupsLoading = signal(true);
  public subGroups: Signal<Committee[]> = this.initSubGroups();

  // -- Parent group --
  public parentGroup: Signal<Committee | null> = this.initParentGroup();

  // -- Tab visibility signals --
  public isMembersTabVisible: Signal<boolean> = computed(
    () => this.committee()?.member_visibility === CommitteeMemberVisibility.BASIC_PROFILE || this.canEdit()
  );
  public isVotesTabVisible: Signal<boolean> = computed(() => !!this.committee()?.enable_voting);

  // -- Visitor gating --
  public isMemberOrAdmin: Signal<boolean> = computed(() => !this.isVisitor() || this.canEdit());

  public readonly tabConfig: TabConfigEntry[] = [
    { key: 'overview', label: 'Overview', icon: 'fa-gauge', visible: () => true },
    {
      key: 'members',
      label: () => {
        const count = this.committee()?.total_members;
        return count != null ? `Members (${count})` : 'Members';
      },
      icon: 'fa-users',
      visible: () => this.isMemberOrAdmin() && this.isMembersTabVisible(),
    },
    { key: 'votes', label: 'Votes', icon: 'fa-check-to-slot', visible: () => this.isMemberOrAdmin() && this.isVotesTabVisible() },
    { key: 'meetings', label: 'Meetings', icon: 'fa-calendar', visible: () => this.isMemberOrAdmin() },
    { key: 'surveys', label: 'Surveys', icon: 'fa-chart-simple', visible: () => this.isMemberOrAdmin() },
    { key: 'documents', label: 'Documents', icon: 'fa-folder-open', visible: () => this.isMemberOrAdmin() },
    { key: 'settings', label: 'Settings', icon: 'fa-gear', visible: () => this.canEdit() || this.canReview() },
  ];

  public visibleTabs = computed(() =>
    this.tabConfig.filter((tab) => tab.visible()).map((tab) => ({ ...tab, label: typeof tab.label === 'function' ? tab.label() : tab.label }))
  );

  // -- Tab state --
  public activeTab = linkedSignal<{ id: string | null; visible: TabConfigEntry[] }, CommitteeTab>({
    source: () => ({ id: this.committeeId(), visible: this.visibleTabs() }),
    computation: ({ id, visible }, previous) => {
      if (previous && previous.source.id === id && visible.some((t) => t.key === previous.value)) {
        return previous.value;
      }
      return 'overview';
    },
  });

  public constructor() {
    this.initAutoSelectInitialTab();

    // Populate the shared invitation cache once in the browser so a direct landing on an invited
    // group (e.g. via the email link) can surface the Accept/Decline banner. Browser-only: the
    // banner is an interactive surface and the list is per-user.
    if (isPlatformBrowser(this.platformId)) {
      this.invitationService.loadPendingInvitations().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe();
    }

    syncEntityProjectContext(this.committee, this.projectContextService, this.router, this.destroyRef);

    // Flush any deferred decline on destroy so navigating away still commits it.
    this.destroyRef.onDestroy(() => {
      for (const inviteUid of [...this.pendingDeclines.keys()]) {
        this.flushDecline(inviteUid);
      }
    });
  }

  // -- Public methods --
  public goBack(): void {
    this.router.navigate(['/', 'groups']);
  }

  public refreshCommittee(): void {
    this.refresh.update((v) => v + 1);
  }

  public refreshMembers(): void {
    this.membersLoading.set(true);
    this.membersRefresh.update((v) => v + 1);
    // The caller's role lives on the committee payload (not the members list), so any
    // member-mutation that triggers a members refresh must also refetch the committee
    // — otherwise role-gated UI (CTAs, banners, tabs) keeps a stale `my_role` until the
    // user navigates away and back. Cheap: the committee GET is a single round-trip.
    this.refreshCommittee();
  }

  public onMembersRefreshed(): void {
    this.refreshMembers();
  }

  public handleTabNavigation(tabWithContext: string): void {
    const [tab, context] = tabWithContext.split(':');
    if (!COMMITTEE_VALID_TABS.includes(tab as CommitteeTab)) {
      return;
    }
    this.activeTab.set(tab as CommitteeTab);
    if (tab === 'meetings' && (context === 'past' || context === 'upcoming')) {
      this.meetingsTimeFilter.set(context);
    }
  }

  public openDescriptionView(): void {
    this.dialogService.open(DescriptionDialogComponent, {
      header: 'Description',
      width: '560px',
      modal: true,
      closable: true,
      draggable: false,
      data: { mode: 'view', description: this.committee()?.description || '' },
    });
  }

  public openEditDescription(): void {
    const ref = this.dialogService.open(DescriptionDialogComponent, {
      header: 'Edit Description',
      width: '560px',
      modal: true,
      closable: true,
      draggable: false,
      data: { mode: 'edit', description: this.committee()?.description || '' },
    });
    ref?.onClose.pipe(take(1)).subscribe((newDescription: string | undefined) => {
      if (newDescription !== undefined) {
        this.saveDescription(newDescription);
      }
    });
  }

  public saveDescription(description: string): void {
    const committee = this.committee();
    if (!committee) {
      return;
    }
    this.committeeService.updateCommittee(committee.uid, { description }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Description updated' });
        this.refreshCommittee();
      },
      error: (err: HttpErrorResponse) => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: getHttpErrorDetail(err, 'Failed to update description. Please try again.') });
      },
    });
  }

  public handleJoinRequest(): void {
    const committee = this.committee();
    if (!committee || this.joiningOrLeaving()) {
      return;
    }

    const joinMode = committee.join_mode;

    if (joinMode === 'open') {
      this.joiningOrLeaving.set(true);
      this.committeeService
        .joinCommittee(committee.uid)
        .pipe(finalize(() => this.joiningOrLeaving.set(false)))
        .subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Joined', detail: `You have joined "${committee.name}"` });
            this.refreshCommitteeAfterMembershipChange();
          },
          error: (err: HttpErrorResponse) => {
            const detail = this.getJoinErrorMessage(err, committee.name);
            this.messageService.add({ severity: 'error', summary: 'Unable to Join', detail, life: 6000 });
          },
        });
    } else if (joinMode === 'application' || joinMode === 'invite_only') {
      this.openApplicationDialog(committee.uid, committee.name, joinMode);
    } else {
      // closed — no self-service action available
      this.messageService.add({ severity: 'info', summary: 'Contact Admin', detail: 'Contact a group admin to request membership.' });
    }
  }

  public handleLeaveRequest(): void {
    const committee = this.committee();
    if (!committee || this.joiningOrLeaving()) {
      return;
    }
    this.joiningOrLeaving.set(true);
    this.committeeService
      .leaveCommittee(committee.uid)
      .pipe(finalize(() => this.joiningOrLeaving.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Left', detail: `You have left "${committee.name}"` });
          this.refreshCommittee();
          this.membersRefresh.update((v) => v + 1);
        },
        error: (err: HttpErrorResponse) => {
          const detail =
            err.status === 404 ? 'You are not a member of this group.' : (err.error?.message ?? `Failed to leave "${committee.name}". Please try again.`);
          this.messageService.add({ severity: 'error', summary: 'Unable to Leave', detail, life: 6000 });
        },
      });
  }

  public onAcceptInvite(invite: PendingInvitation): void {
    const committeeName = this.committee()?.name ?? invite.committee_name ?? 'this group';
    const requiresOrganization = invitationRequiresOrganization(invite);

    if (!requiresOrganization) {
      this.invitationService.markResolved(invite.uid);
    }

    this.invitationAcceptFlow
      .accept({
        committeeUid: invite.committee_uid,
        inviteUid: invite.uid,
        committeeName,
        organization: invite.organization,
        enable_voting: invite.enable_voting,
        business_email_required: invite.business_email_required,
        inviteRequiresOrganization: requiresOrganization,
      })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (requiresOrganization) {
            this.invitationService.markResolved(invite.uid);
          }
          this.invitationService.forgetResolved(invite.uid);
          this.messageService.add({ severity: 'success', summary: 'Joined', detail: `You've joined "${committeeName}"` });
          this.refreshCommitteeAfterMembershipChange();
        },
        error: () => {
          if (!requiresOrganization) {
            this.invitationService.unmarkResolved(invite.uid);
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Accept',
            detail: `Couldn't accept the invitation to "${committeeName}". Please try again.`,
            life: 6000,
          });
        },
      });
  }

  public onDeclineInvite(invite: PendingInvitation): void {
    // Optimistic + deferred-undo: hide the banner now, only send the decline after the undo window.
    this.invitationService.markResolved(invite.uid);

    const timerId = setTimeout(() => {
      this.pendingDeclines.delete(invite.uid);
      this.sendDecline(invite.committee_uid, invite.uid);
    }, INVITE_DECLINE_UNDO_MS);
    this.pendingDeclines.set(invite.uid, { committeeUid: invite.committee_uid, timerId });

    this.messageService.add({
      key: INVITE_TOAST_KEY,
      severity: 'info',
      summary: 'Invitation declined',
      data: { uid: invite.uid },
      life: INVITE_DECLINE_UNDO_MS,
      closable: true,
    });
  }

  public onUndoDecline(inviteUid: string): void {
    const pending = this.pendingDeclines.get(inviteUid);
    // Timer already fired -> the decline is committed upstream; restoring would lie to the user.
    if (!pending) {
      this.messageService.clear(INVITE_TOAST_KEY);
      return;
    }
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(inviteUid);
    this.invitationService.unmarkResolved(inviteUid);
    this.messageService.clear(INVITE_TOAST_KEY);
  }

  public navigateToParentGroup(): void {
    const parent = this.parentGroup();
    if (parent?.uid) {
      this.router.navigate(['/', 'groups', parent.uid]);
    }
  }

  public navigateToParentProject(): void {
    const c = this.committee();
    if (!c?.project_uid || !c.project_slug) return;
    const context: ProjectContext = {
      uid: c.project_uid,
      name: c.project_name || c.foundation_name || c.project_slug,
      slug: c.project_slug,
    };
    if (c.is_foundation) {
      this.projectContextService.setFoundation(context);
      this.lensService.setLens('foundation');
      this.router.navigate(['/foundation/overview']);
    } else {
      this.projectContextService.setProject(context);
      this.lensService.setLens('project');
      this.router.navigate(['/project/overview']);
    }
  }

  public navigateToSubGroup(subGroup: Committee): void {
    this.router.navigate(['/', 'groups', subGroup.uid]);
  }

  public onDocumentClick(): void {
    if (this.mlExpanded()) {
      this.mlExpanded.set(false);
    }
  }

  // -- Private methods --

  /**
   * Refreshes committee + members after join/accept. The membership query index can lag
   * the upstream write, so poll until `my_role` surfaces before giving up.
   */
  private refreshCommitteeAfterMembershipChange(): void {
    const committeeId = this.committee()?.uid ?? this.committeeId();
    this.refreshMembers();

    if (!committeeId) {
      return;
    }

    let pollSucceeded = false;

    timer(400, 400)
      .pipe(
        take(6),
        exhaustMap(() => this.committeeService.getCommittee(committeeId).pipe(catchError(() => of(null)))),
        filter((committee) => !!committee?.my_role),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          pollSucceeded = true;
          this.refreshMembers();
        },
        error: () => {
          if (!pollSucceeded && !this.committee()?.my_role) {
            this.refreshMembers();
          }
        },
        complete: () => {
          if (!pollSucceeded && !this.committee()?.my_role) {
            this.refreshMembers();
          }
        },
      });
  }

  /** Cancels the deferred timer and fires the upstream decline immediately (destroy flush). */
  private flushDecline(inviteUid: string): void {
    const pending = this.pendingDeclines.get(inviteUid);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(inviteUid);
    this.sendDecline(pending.committeeUid, inviteUid);
  }

  private sendDecline(committeeUid: string, inviteUid: string): void {
    this.invitationService
      .declineInvitation(committeeUid, inviteUid)
      .pipe(take(1))
      .subscribe({
        next: () => this.invitationService.forgetResolved(inviteUid),
        error: () => {
          this.invitationService.unmarkResolved(inviteUid);
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Decline',
            detail: `Couldn't decline the invitation. Please try again.`,
            life: 6000,
          });
        },
      });
  }

  private openApplicationDialog(committeeUid: string, committeeName: string, mode: 'application' | 'invite_only'): void {
    const isApplication = mode === 'application';

    const ref = this.dialogService.open(JoinApplicationDialogComponent, {
      header: mode === 'invite_only' ? 'Request Access' : 'Request to Join',
      width: '520px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { committeeName, mode },
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1)).subscribe((result: JoinApplicationDialogResult | null) => {
      if (!result) return;

      this.joiningOrLeaving.set(true);
      this.committeeService
        .submitApplication(committeeUid, result.message)
        .pipe(finalize(() => this.joiningOrLeaving.set(false)))
        .subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: isApplication ? 'Application Submitted' : 'Request Submitted',
              detail: isApplication
                ? `Your request to join "${committeeName}" has been submitted. An admin will review it shortly.`
                : `Your access request for "${committeeName}" has been submitted. An admin will review and send you an invitation if approved.`,
              life: 8000,
            });
          },
          error: (err: HttpErrorResponse) => {
            const upstream = err.error?.message as string | undefined;
            let detail: string;
            if (err.status === 409) {
              detail = isApplication ? 'You already have a pending application for this group.' : 'You already have a pending request for this group.';
            } else {
              const fallback = isApplication
                ? `Failed to submit your request for "${committeeName}". Please try again.`
                : `Failed to submit your access request for "${committeeName}". Please try again.`;
              detail = upstream ?? fallback;
            }
            this.messageService.add({ severity: 'error', summary: 'Unable to Submit', detail, life: 6000 });
          },
        });
    });
  }

  // -- Private initializer functions --
  private initPendingInvitationFromRoute(): Signal<PendingInvitation | null> {
    return computed(() => {
      if (this.errorType() !== 'access-denied') {
        return null;
      }
      return findPendingInvitationForCommittee(this.invitationService.pendingInvitations(), this.invitationService.resolvedInviteUids(), this.committeeId());
    });
  }

  private initCommitteeId(): Signal<string | null> {
    return toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), { requireSync: true });
  }

  private initInitialTab(): Signal<CommitteeTab | null> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((params) => {
          const tab = params.get('tab');
          return tab && COMMITTEE_VALID_TABS.includes(tab as CommitteeTab) ? (tab as CommitteeTab) : null;
        })
      ),
      { requireSync: true }
    );
  }

  private initAutoSelectInitialTab(): void {
    const navigationKey = computed(() => ({ id: this.committeeId(), tab: this.initialTab() }));
    // toObservable must run in an injection context; build the streams here, not inside switchMap.
    const visibleTabs$ = toObservable(this.visibleTabs);
    const membersLoading$ = toObservable(this.membersLoading);
    toObservable(navigationKey)
      .pipe(
        switchMap(({ tab }) => {
          if (!tab) return EMPTY;
          return combineLatest([visibleTabs$, membersLoading$]).pipe(
            filter(([, loading]) => !loading),
            take(1),
            filter(([tabs]) => tabs.some((t) => t.key === tab)),
            map(() => tab)
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((tab) => {
        if (this.activeTab() === 'overview') {
          this.activeTab.set(tab);
        }
      });
  }

  private initializeCommittee(): Signal<Committee | null> {
    return toSignal(
      combineLatest([this.route.paramMap, toObservable(this.refresh)]).pipe(
        switchMap(([params]) => {
          const committeeId = params?.get('id');
          if (!committeeId) {
            this.errorType.set('not-found');
            this.error.set(true);
            this.loading.set(false);
            return of(null);
          }

          this.error.set(false);
          this.errorType.set(null);

          // Only show full loading spinner on initial load, not on silent refreshes.
          // `committeeRefreshing` flips for both, so role-based UI (CTAs, banners) stays
          // accurate during silent refreshes after join/leave actions.
          if (!this.committee()) {
            this.loading.set(true);
          }
          this.committeeRefreshing.set(true);

          return this.committeeService.getCommittee(committeeId).pipe(
            catchError((err) => {
              const status = err?.status;
              if (status === 403) {
                this.errorType.set('access-denied');
              } else if (status === 404) {
                this.errorType.set('not-found');
              } else {
                this.errorType.set('server-error');
              }
              this.error.set(true);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: status === 404 ? 'Group not found' : 'Failed to load group details',
              });
              return of(null);
            }),
            finalize(() => {
              this.loading.set(false);
              this.committeeRefreshing.set(false);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initializeMembers(): Signal<CommitteeMember[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.membersRefresh)]).pipe(
        switchMap(([committee]) => {
          if (!committee?.uid) {
            this.membersLoading.set(false);
            return of([]);
          }

          this.membersLoading.set(true);

          return this.committeeService.getCommitteeMembers(committee.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.membersLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeInvites(): Signal<CommitteeInvite[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.membersRefresh)]).pipe(
        switchMap(([committee]) => {
          // Only managers can see pending invites — gate the fetch (not just the display) so
          // non-managers never request invitee emails and we don't rely on upstream authz to reject.
          if (!committee?.uid || !canManageCommitteeMembers(committee)) {
            this.invitesLoading.set(false);
            return of([] as CommitteeInvite[]);
          }

          this.invitesLoading.set(true);

          return this.committeeService.getCommitteeInvites(committee.uid).pipe(
            // Only pending invites belong on the roster — accepted ones are already members,
            // and declined/revoked ones shouldn't block re-inviting. Status casing varies
            // upstream, so compare case-insensitively.
            map((invites) => invites.filter((invite) => (invite.status ?? '').toLowerCase() === 'pending')),
            catchError(() => of([] as CommitteeInvite[])),
            finalize(() => this.invitesLoading.set(false))
          );
        })
      ),
      { initialValue: [] as CommitteeInvite[] }
    );
  }

  private initSubGroups(): Signal<Committee[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => {
          this.subGroupsLoading.set(true);
          return this.committeeService.getChildCommittees(c.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.subGroupsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initParentGroup(): Signal<Committee | null> {
    return toSignal(
      toObservable(this.committee).pipe(
        switchMap((c) => {
          if (!c?.parent_uid) {
            return of(null);
          }
          return this.committeeService.fetchCommittee(c.parent_uid).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initChatPlatformLabel(): Signal<string> {
    return computed(() => getChatPlatformLabel(this.committee()?.chat_channel));
  }

  private initChatPlatformIcon(): Signal<string> {
    return computed(() => getChatPlatformIcon(this.committee()?.chat_channel));
  }

  private initRepoPlatformLabel(): Signal<string> {
    return computed(() => getRepoPlatformLabel(this.committee()?.website));
  }

  private initRepoPlatformIcon(): Signal<string> {
    return computed(() => getRepoPlatformIcon(this.committee()?.website));
  }

  private initAssociatedMailingLists(): Signal<GroupsIOMailingList[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => {
          return this.mailingListService.getMailingListsByCommittee(c.uid).pipe(catchError(() => of([])));
        })
      ),
      { initialValue: [] }
    );
  }

  private getJoinErrorMessage(err: HttpErrorResponse, committeeName: string): string {
    const upstream = err.error?.message as string | undefined;
    if (err.status === 409) {
      return 'You are already a member of this group.';
    }
    if (upstream?.includes('organization')) {
      return 'This group requires a verified organization to join. Please contact an admin for access.';
    }
    if (upstream?.includes('business email')) {
      return 'This group requires a business email address to join. Please contact an admin for access.';
    }
    if (err.status === 403) {
      return 'You do not have permission to join this group.';
    }
    return upstream ?? `Failed to join "${committeeName}". Please try again.`;
  }
}
