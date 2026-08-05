// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, linkedSignal, OnInit, output, signal, Signal } from '@angular/core';
import { FullNamePipe } from '@pipes/full-name.pipe';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  COMMITTEE_ENGAGEMENT_CLASSIFICATION_TAG_SEVERITY,
  COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW,
  COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS,
  COMMITTEE_LABEL,
} from '@lfx-one/shared/constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus, CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeEngagementResponse,
  CommitteeEngagementWindow,
  CommitteeInvite,
  CommitteeJoinApplication,
  CommitteeMember,
  CommitteeMemberEngagement,
  CommitteeMemberEngagementRowView,
  CommitteeMemberFilterChip,
  CommitteeMemberFilterChipConfig,
  CommitteeMemberPermissionInfo,
  CommitteeMemberTab,
  CommitteePermissionLevel,
  CommitteeTableRow,
  CommitteeUser,
  FilterPillOption,
  JoinMode,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import {
  canManageCommitteeMembers,
  countVotingReps,
  formatCommitteeEngagementFreshness,
  formatCommitteeEngagementMeetings,
  isCommitteeEngagementRowAtRisk,
  isVotingRep,
  resolveCommitteeMemberPermission,
  toCommitteeEngagementWindow,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { Skeleton } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, distinctUntilChanged, exhaustMap, filter, Observable, of, startWith, take, takeUntil, timer } from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';

import { AddMemberDialogComponent } from '../add-member-dialog/add-member-dialog.component';
import { MemberFormComponent } from '../member-form/member-form.component';
import { RejectApplicationDialogComponent } from '../reject-application-dialog/reject-application-dialog.component';

@Component({
  selector: 'lfx-committee-members',
  imports: [
    DatePipe,
    TitleCasePipe,
    ReactiveFormsModule,
    CardComponent,
    CardTabsBarComponent,
    FilterPillsComponent,
    FullNamePipe,
    MenuComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    TableComponent,
    TagComponent,
    ConfirmDialogModule,
    DynamicDialogModule,
    Skeleton,
    TooltipModule,
  ],
  providers: [ConfirmationService, DialogService],
  templateUrl: './committee-members.component.html',
  styleUrl: './committee-members.component.scss',
})
export class CommitteeMembersComponent implements OnInit {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  /** Bound committee UID stream — created in the constructor injection context for reuse in async callbacks. */
  private readonly committeeUid$: Observable<string | null>;

  // Input signals
  public committee = input.required<Committee | null>();
  public members = input.required<CommitteeMember[]>();
  public membersLoading = input<boolean>(true);
  public invites = input<CommitteeInvite[]>([]);
  public invitesLoading = input<boolean>(false);
  public applications = input<CommitteeJoinApplication[]>([]);
  public applicationsLoading = input<boolean>(false);
  /** Non-writer members in invite_only groups may send invites. */
  public canSendMemberInvites = input<boolean>(false);
  // Engagement rollup (LFXV2-1705, behind wg-engagement-metrics). Fetched once at the page level
  // (committee-view) and shared with the Overview summary; flag off = no engagement UI at all.
  public engagementEnabled = input<boolean>(false);
  // canAccessEngagement() passed down from committee-view — same input Overview already has.
  // Without this, the flag alone gated the Meetings/Engagement columns and window pills, so a
  // roster member (or public-roster visitor) with no committee#auditor grant still saw that UI
  // even though no fetch runs for them (Cursor Bugbot).
  public engagementAccessible = input<boolean>(false);
  public engagement = input<CommitteeEngagementResponse | null>(null);
  public engagementLoading = input<boolean>(false);
  public engagementWindow = input<CommitteeEngagementWindow>(COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW);

  public readonly refresh = output<void>();
  public readonly engagementWindowChange = output<CommitteeEngagementWindow>();

  // Simple writable signals
  public selectedMember = signal<CommitteeMember | null>(null);
  public selectedInvite = signal<CommitteeInvite | null>(null);
  public isDeleting = signal<boolean>(false);
  public revokingInviteUid = signal<string | null>(null);
  public processingApplicationUid = signal<string | null>(null);
  public activeTab = signal<CommitteeMemberTab>('all');
  // linkedSignal, not signal: the At Risk chip is only offered while a real engagement response is
  // present, so if it's selected when the data degrades (window switch, fetch failure) the
  // selection resets to 'all' — otherwise no chip would render as pressed and the at-risk filter
  // would silently re-apply when data returned.
  public memberFilterChip = linkedSignal<boolean, CommitteeMemberFilterChip>({
    source: () => this.engagementEnabled() && this.engagement()?.data_available === true,
    computation: (atRiskOffered, previous) => {
      if (previous && (previous.value !== 'atRisk' || atRiskOffered)) {
        return previous.value;
      }
      return 'all';
    },
  });
  public memberActionMenuItems: MenuItem[] = [];
  public inviteActionMenuItems: MenuItem[] = [];
  public committeeLabel = COMMITTEE_LABEL;
  // Upstream "no role" sentinel for committee invites — kept in one place rather than inline in the template.
  public readonly noRoleSentinel = CommitteeMemberRole.NONE;
  public readonly engagementWindowOptions = COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS;

  // Computed signals — inline per component-organization.md
  // Driven by the API's effective `writer` flag, which already reflects access inherited
  // from the parent/foundation project (authz model: committee#writer derives from
  // `writer from project`). No separate inherited check is needed here — a foundation-level
  // manager's `writer` flag is already true (LFXV2-2059).
  public readonly canManageMembers = computed(() => canManageCommitteeMembers(this.committee()));
  public readonly joinMode = computed(() => this.committee()?.join_mode as JoinMode | undefined);
  /** Invites are forbidden in closed mode (LFXV2-2690). */
  public readonly showPendingInvites = computed(
    () => this.canManageMembers() && this.joinMode() !== 'closed' && (this.invitesLoading() || this.invites().length > 0)
  );
  /** Show the Pending tab only when there are (or are loading) pending invites a manager can see. */
  public readonly showPendingTab = computed(() => this.showPendingInvites());
  public readonly tabOptions = computed<FilterPillOption[]>(() => {
    const opts: FilterPillOption[] = [{ id: 'all', label: 'All' }];
    if (this.showPendingTab()) {
      const count = this.invitesLoading() ? '' : ` (${this.invites().length})`;
      opts.push({ id: 'pending', label: `Pending${count}` });
    }
    return opts;
  });
  public readonly showPendingApplications = computed(
    () => this.canManageMembers() && this.joinMode() === 'application' && (this.applicationsLoading() || this.pendingApplications().length > 0)
  );
  public readonly pendingApplications = computed(() => this.applications().filter((app) => (app.status ?? '').toLowerCase() === 'pending'));
  // Fail-closed: only show the roster when visibility is explicitly set to basic_profile.
  // Undefined/null/unknown values default to hidden so committees without a persisted
  // setting don't inadvertently expose the member list.
  public readonly showMemberRoster = computed(() => {
    const committee = this.committee();
    if (!committee) return false;
    return committee.member_visibility === CommitteeMemberVisibility.BASIC_PROFILE || this.canManageMembers();
  });
  /** Roster and/or invite-only member actions (LFXV2-2690: invite path when roster is hidden). */
  public readonly showMembersSection = computed(() => this.showMemberRoster() || this.canSendMemberInvites());
  public readonly votingRepCount: Signal<number> = computed(() => countVotingReps(this.members()));
  public readonly observerCount: Signal<number> = computed(
    () => this.members().filter((m) => m.voting?.status === CommitteeMemberVotingStatus.OBSERVER).length
  );
  public readonly chairCount: Signal<number> = computed(
    () => this.members().filter((m) => m.role?.name === CommitteeMemberRole.CHAIR || m.role?.name === CommitteeMemberRole.VICE_CHAIR).length
  );
  // True only when a real (non-degraded) engagement response is present — the "no data" states key
  // off this, never off all-zero counts (a degraded response is roster-complete with zeroed rows).
  public readonly engagementDataAvailable: Signal<boolean> = computed(() => this.engagement()?.data_available === true);
  // Deterministically fabricated numbers (ENGAGEMENT_BACKEND=mock, blocked in production) — the
  // interface contract requires surfacing this to the user whenever mock numbers could render.
  public readonly isMockEngagement: Signal<boolean> = computed(() => this.engagement()?.data_source === 'mock');
  public readonly engagementFreshnessLabel: Signal<string> = computed(() => formatCommitteeEngagementFreshness(this.engagement()?.computed_at ?? null));
  public readonly engagementByUid: Signal<Map<string, CommitteeMemberEngagement>> = computed(() => {
    const map = new Map<string, CommitteeMemberEngagement>();
    for (const row of this.engagement()?.members ?? []) {
      map.set(row.uid, row);
    }
    return map;
  });
  public readonly atRiskCount: Signal<number> = computed(() => {
    const byUid = this.engagementByUid();
    return this.members().filter((m) => {
      const row = byUid.get(m.uid);
      return row ? isCommitteeEngagementRowAtRisk(row) : false;
    }).length;
  });
  // UID-keyed engagement row view for the Members table cells — precomputed here (not called as
  // template methods) per docs/reviews/frontend-checklist.md rule 4, "no template functions".
  public readonly memberEngagementRows: Signal<Map<string, CommitteeMemberEngagementRowView>> = this.initMemberEngagementRows();

  // Complex computed signals — use private init functions
  public readonly chipConfig: Signal<CommitteeMemberFilterChipConfig[]> = this.initChipConfig();
  private readonly chipFilteredMembers: Signal<CommitteeMember[]> = this.initChipFilteredMembers();
  public readonly tableRows: Signal<CommitteeTableRow[]> = this.initTableRows();
  // Both empty-state rows must span every rendered column: 5 base, +2 when the voting columns
  // render, +2 when the flag-gated engagement columns render.
  public readonly emptyStateColspan: Signal<number> = computed(() => {
    let count = 5;
    if (this.committee()?.enable_voting) {
      count += 2;
    }
    if (this.engagementEnabled() && this.engagementAccessible()) {
      count += 2;
    }
    return count;
  });

  // Filter-related variables
  public filterForm: FormGroup;
  public searchTerm: Signal<string>;
  public roleFilter: Signal<string | null>;
  public votingStatusFilter: Signal<string | null>;
  public organizationFilter: Signal<string | null>;
  public filteredMembers: Signal<CommitteeMember[]>;
  public roleOptions: Signal<{ label: string; value: string | null }[]>;
  public votingStatusOptions: Signal<{ label: string; value: string | null }[]>;
  public organizationOptions: Signal<{ label: string; value: string | null }[]>;

  public constructor() {
    // Initialize filter form
    this.filterForm = this.initializeFilterForm();
    this.searchTerm = this.initializeSearchTerm();
    this.roleFilter = this.initializeRoleFilter();
    this.votingStatusFilter = this.initializeVotingStatusFilter();
    this.organizationFilter = this.initializeOrganizationFilter();
    this.roleOptions = this.initializeRoleOptions();
    this.votingStatusOptions = this.initializeVotingStatusOptions();
    this.organizationOptions = this.initializeOrganizationOptions();
    this.filteredMembers = this.initializeFilteredMembers();

    this.committeeUid$ = toObservable(computed(() => this.committee()?.uid ?? null));

    // Route-reused `/groups/:id` can bind a new committee while an approve/reject poll is in flight.
    let previousCommitteeUid: string | null | undefined;
    this.committeeUid$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((uid) => {
      if (previousCommitteeUid !== undefined && uid !== previousCommitteeUid) {
        this.processingApplicationUid.set(null);
      }
      previousCommitteeUid = uid;
    });
  }

  public ngOnInit(): void {
    this.memberActionMenuItems = this.initializeMemberActionMenuItems();
    this.inviteActionMenuItems = this.initializeInviteActionMenuItems();
  }

  public onTabChange(tab: string): void {
    if (tab === 'all' || tab === 'pending') {
      this.activeTab.set(tab);
    }
  }

  public toggleMemberActionMenu(event: Event, member: CommitteeMember, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedMember.set(member);
    // Rebuild menu items so MenuItem.url reflects the selected member's email
    this.memberActionMenuItems = this.initializeMemberActionMenuItems(member);
    menuComponent.toggle(event);
  }

  public toggleInviteActionMenu(event: Event, invite: CommitteeInvite, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedInvite.set(invite);
    this.inviteActionMenuItems = this.initializeInviteActionMenuItems(invite);
    menuComponent.toggle(event);
  }

  /**
   * Resolve a member's roster permission (committee-scoped role, else inherited project/foundation
   * grant) plus whether it was inherited. Delegates to the shared pure resolver so the logic is
   * unit-testable in isolation (LFXV2-2059).
   */
  public getMemberPermissionInfo(member: CommitteeMember): CommitteeMemberPermissionInfo {
    return resolveCommitteeMemberPermission(this.committee(), member);
  }

  public getMemberPermissionSeverity(permission: CommitteePermissionLevel): TagSeverity {
    if (permission === 'manage') return 'success';
    if (permission === 'review') return 'info';
    return 'secondary';
  }

  public getMemberPermissionLabel(permission: CommitteePermissionLevel, inherited = false): string {
    // Inherited grants only apply to manage/review; 'member' never carries the suffix.
    const suffix = inherited ? ' (inherited)' : '';
    if (permission === 'manage') return `Manage${suffix}`;
    if (permission === 'review') return `Reviewer${suffix}`;
    return 'Member';
  }

  public selectChip(chip: CommitteeMemberFilterChip): void {
    this.memberFilterChip.set(chip);
    this.filterForm.patchValue({ role: null, votingStatus: null, organization: null });
  }

  public onEngagementWindowChange(windowId: string): void {
    // filter-pills emits a plain string id — only forward values the endpoint actually accepts.
    const window = toCommitteeEngagementWindow(windowId);
    if (window) {
      this.engagementWindowChange.emit(window);
    }
  }

  public openAddMemberDialog(): void {
    const dialogRef = this.dialogService.open(AddMemberDialogComponent, {
      header: 'Add Member',
      width: '540px',
      modal: true,
      closable: true,
      data: {
        committee: this.committee(),
        existingMembers: this.members(),
        existingInvites: this.invites(),
        mode: 'direct-add',
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result === true) {
        this.refreshMembers();
      }
    });
  }

  public openInviteMemberDialog(): void {
    const dialogRef = this.dialogService.open(AddMemberDialogComponent, {
      header: 'Invite Someone',
      width: '540px',
      modal: true,
      closable: true,
      data: {
        committee: this.committee(),
        existingMembers: this.members(),
        existingInvites: this.invites(),
        mode: 'invite',
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result === true) {
        this.refreshMembers();
      }
    });
  }

  public approveApplication(application: CommitteeJoinApplication): void {
    const committee = this.committee();
    if (!committee?.uid || this.processingApplicationUid()) return;

    const committeeUid = committee.uid;

    this.confirmationService.confirm({
      message: `Approve ${application.applicant_email}'s request to join this group?`,
      header: 'Approve Application',
      acceptLabel: 'Approve',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-success p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        if (this.committee()?.uid !== committeeUid) {
          return;
        }
        if (this.processingApplicationUid()) return;

        this.processingApplicationUid.set(application.uid);
        this.committeeService.approveApplication(committeeUid, application.uid).subscribe({
          next: () => {
            if (this.committee()?.uid !== committeeUid) {
              return;
            }
            this.messageService.add({
              severity: 'success',
              summary: 'Application Approved',
              detail: `${application.applicant_email} has been added to the group.`,
            });
            this.refreshAfterApplicationReview(committeeUid, application.uid);
          },
          error: (err: HttpErrorResponse) => {
            if (this.committee()?.uid !== committeeUid) {
              return;
            }
            if (this.processingApplicationUid() === application.uid) {
              this.processingApplicationUid.set(null);
            }
            this.messageService.add({
              severity: 'error',
              summary: 'Unable to Approve',
              detail: getHttpErrorDetail(err, 'Failed to approve the application. Please try again.'),
            });
          },
        });
      },
    });
  }

  public rejectApplication(application: CommitteeJoinApplication): void {
    const committee = this.committee();
    if (!committee?.uid || this.processingApplicationUid()) return;

    const committeeUid = committee.uid;

    const dialogRef = this.dialogService.open(RejectApplicationDialogComponent, {
      header: 'Reject Application',
      width: '480px',
      modal: true,
      closable: true,
      data: { applicantEmail: application.applicant_email },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((reviewerNotes: string | null | undefined) => {
      if (reviewerNotes === undefined) return;
      if (this.committee()?.uid !== committeeUid) {
        return;
      }
      if (this.processingApplicationUid()) return;

      this.processingApplicationUid.set(application.uid);
      this.committeeService.rejectApplication(committeeUid, application.uid, reviewerNotes || undefined).subscribe({
        next: () => {
          if (this.committee()?.uid !== committeeUid) {
            return;
          }
          this.messageService.add({
            severity: 'success',
            summary: 'Application Rejected',
            detail: `The request from ${application.applicant_email} has been rejected.`,
          });
          this.refreshAfterApplicationReview(committeeUid, application.uid);
        },
        error: (err: HttpErrorResponse) => {
          if (this.committee()?.uid !== committeeUid) {
            return;
          }
          if (this.processingApplicationUid() === application.uid) {
            this.processingApplicationUid.set(null);
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Reject',
            detail: getHttpErrorDetail(err, 'Failed to reject the application. Please try again.'),
          });
        },
      });
    });
  }

  public revokeInvite(invite: CommitteeInvite): void {
    const committee = this.committee();
    if (!committee?.uid || this.revokingInviteUid()) return;

    this.confirmationService.confirm({
      message: `Revoke the pending invitation for ${invite.invitee_email}?`,
      header: 'Revoke Invitation',
      acceptLabel: 'Revoke',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        this.revokingInviteUid.set(invite.uid);
        this.committeeService.revokeCommitteeInvite(committee.uid, invite.uid).subscribe({
          next: () => {
            this.revokingInviteUid.set(null);
            this.messageService.add({
              severity: 'success',
              summary: 'Invitation Revoked',
              detail: `The invitation for ${invite.invitee_email} has been revoked.`,
            });
            this.refreshMembers();
          },
          error: (err: HttpErrorResponse) => {
            this.revokingInviteUid.set(null);
            this.messageService.add({
              severity: 'error',
              summary: 'Unable to Revoke',
              detail: getHttpErrorDetail(err, 'Failed to revoke the invitation. Please try again.'),
            });
          },
        });
      },
    });
  }

  private editMember(): void {
    const member = this.selectedMember();
    if (member) {
      const dialogRef = this.dialogService.open(MemberFormComponent, {
        header: 'Edit Member',
        width: '700px',
        modal: true,
        closable: true,
        data: {
          isEditing: true,
          memberId: member.uid,
          member: member,
          committee: this.committee(),
          onCancel: () => {
            // Dialog will close itself
          },
        },
      });

      dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
        if (result) {
          this.refreshMembers();
        }
      });
    }
  }

  private deleteMember(): void {
    const member = this.selectedMember();
    if (!member) return;

    this.confirmationService.confirm({
      message: `Are you sure you want to remove ${this.getMemberDisplayName(member)} from this committee? This action cannot be undone.`,
      header: 'Remove Member',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.performDelete(member),
    });
  }

  private performDelete(member: CommitteeMember): void {
    const committee = this.committee();
    if (!committee || !committee.uid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Committee information is not available',
      });
      return;
    }

    this.isDeleting.set(true);

    this.committeeService.deleteCommitteeMember(committee.uid, member.uid).subscribe({
      next: () => {
        this.isDeleting.set(false);

        const memberName = this.getMemberDisplayName(member);

        this.messageService.add({
          severity: 'success',
          summary: 'Member Removed',
          detail: `${memberName} has been removed from the committee`,
        });

        // Clean up stale ACL entries — remove deleted member from writers/auditors.
        // Best-effort: if this fails, warn but don't block the UI (member was already deleted).
        const memberEmail = member.email?.toLowerCase();
        const memberUsername = member.username;
        const existingWriters: CommitteeUser[] = committee.writers ?? [];
        const existingAuditors: CommitteeUser[] = committee.auditors ?? [];
        const hadElevatedPermission =
          existingWriters.some((w) => (memberUsername && w.username === memberUsername) || w.email?.toLowerCase() === memberEmail) ||
          existingAuditors.some((a) => (memberUsername && a.username === memberUsername) || a.email?.toLowerCase() === memberEmail);

        if (hadElevatedPermission) {
          const writers = existingWriters.filter((w) => !(memberUsername && w.username === memberUsername) && w.email?.toLowerCase() !== memberEmail);
          const auditors = existingAuditors.filter((a) => !(memberUsername && a.username === memberUsername) && a.email?.toLowerCase() !== memberEmail);

          // Refresh only after the permission cleanup settles — avoids a race where the
          // committee re-fetch returns stale writers/auditors before the settings PUT completes.
          this.committeeService
            .updateCommitteePermissions(committee.uid, writers, auditors)
            .pipe(
              catchError(() => {
                this.messageService.add({
                  severity: 'warn',
                  summary: 'Permission Cleanup Failed',
                  detail: `${memberName} was removed, but their elevated permission could not be revoked. Please update manually in settings.`,
                  life: 6000,
                });
                return of(null);
              })
            )
            .subscribe({ next: () => this.refreshMembers() });
        } else {
          this.refreshMembers();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.isDeleting.set(false);

        this.messageService.add({
          severity: 'error',
          summary: 'Unable to Remove',
          detail: getHttpErrorDetail(err, 'Failed to remove member. Please try again.'),
        });
      },
    });
  }

  private refreshMembers(): void {
    this.refresh.emit();
  }

  /**
   * Refreshes members/applications after approve/reject. The query index can lag the upstream
   * write, so poll until the application is no longer pending before giving up.
   */
  private refreshAfterApplicationReview(committeeUid: string, applicationUid: string): void {
    const isActiveReview = (): boolean => this.committee()?.uid === committeeUid;

    const refreshIfActive = (): void => {
      if (isActiveReview()) {
        this.refreshMembers();
      }
    };

    const releaseReviewLock = (): void => {
      if (isActiveReview() && this.processingApplicationUid() === applicationUid) {
        this.processingApplicationUid.set(null);
      }
    };

    refreshIfActive();

    const committeeChanged$ = this.committeeUid$.pipe(
      filter((uid) => uid !== committeeUid),
      take(1)
    );

    let pollSucceeded = false;

    timer(400, 400)
      .pipe(
        take(6),
        takeUntil(committeeChanged$),
        exhaustMap(() => this.committeeService.getCommitteeApplications(committeeUid).pipe(catchError(() => of(null as CommitteeJoinApplication[] | null)))),
        filter((applications): applications is CommitteeJoinApplication[] => {
          if (applications === null) {
            return false;
          }
          const application = applications.find((app) => app.uid === applicationUid);
          return !application || (application.status ?? '').toLowerCase() !== 'pending';
        }),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          if (!isActiveReview()) {
            return;
          }
          pollSucceeded = true;
          refreshIfActive();
          releaseReviewLock();
        },
        complete: () => {
          if (!isActiveReview() || this.destroyRef.destroyed) {
            return;
          }
          if (!pollSucceeded) {
            refreshIfActive();
          }
          releaseReviewLock();
        },
      });
  }

  private getMemberDisplayName(member: CommitteeMember): string {
    const parts = [member.first_name, member.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : member.email || 'Member';
  }

  // Private initialization methods
  private initializeFilterForm(): FormGroup {
    return new FormGroup({
      search: new FormControl(''),
      role: new FormControl(null),
      votingStatus: new FormControl(null),
      organization: new FormControl(null),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.filterForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeRoleFilter(): Signal<string | null> {
    return toSignal(this.filterForm.get('role')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeVotingStatusFilter(): Signal<string | null> {
    return toSignal(this.filterForm.get('votingStatus')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeOrganizationFilter(): Signal<string | null> {
    return toSignal(this.filterForm.get('organization')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeMemberActionMenuItems(member?: CommitteeMember): MenuItem[] {
    return [
      {
        label: 'Send Message',
        icon: 'fa-light fa-envelope',
        url: member?.email ? `mailto:${member.email}` : undefined,
      },
      {
        separator: true,
      },
      {
        label: 'Edit',
        icon: 'fa-light fa-edit',
        command: () => this.editMember(),
      },
      {
        separator: true,
      },
      {
        label: 'Remove',
        icon: 'fa-light fa-trash',
        styleClass: 'text-red-500',
        disabled: this.isDeleting(),
        command: () => this.deleteMember(),
      },
    ];
  }

  private initializeRoleOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const members = this.members();
      const roleSet = new Set<string>();

      members.forEach((member) => {
        if (member.role?.name) {
          roleSet.add(member.role.name);
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Roles', value: null }];
      Array.from(roleSet)
        .sort()
        .forEach((role) => {
          options.push({ label: role, value: role });
        });

      return options;
    });
  }

  private initializeVotingStatusOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const members = this.members();
      const statusSet = new Set<string>();

      members.forEach((member) => {
        if (member.voting?.status) {
          statusSet.add(member.voting.status);
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Voting Status', value: null }];
      Array.from(statusSet)
        .sort()
        .forEach((status) => {
          options.push({ label: status, value: status });
        });

      return options;
    });
  }

  private initializeOrganizationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const members = this.members();
      const orgSet = new Set<string>();

      members.forEach((member) => {
        if (member.organization?.name) {
          orgSet.add(member.organization.name);
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Organizations', value: null }];
      Array.from(orgSet)
        .sort()
        .forEach((org) => {
          options.push({ label: org, value: org });
        });

      return options;
    });
  }

  private initializeFilteredMembers(): Signal<CommitteeMember[]> {
    return computed(() => {
      let filtered = this.chipFilteredMembers();

      // Apply search filter
      const searchTerm = this.searchTerm().toLowerCase();
      if (searchTerm) {
        filtered = filtered.filter(
          (member) =>
            member.first_name?.toLowerCase().includes(searchTerm) ||
            member.last_name?.toLowerCase().includes(searchTerm) ||
            member.email?.toLowerCase().includes(searchTerm) ||
            member.organization?.name?.toLowerCase().includes(searchTerm) ||
            member.job_title?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply role filter
      const roleFilter = this.roleFilter();
      if (roleFilter) {
        filtered = filtered.filter((member) => member.role?.name === roleFilter);
      }

      // Apply voting status filter
      const votingStatusFilter = this.votingStatusFilter();
      if (votingStatusFilter) {
        filtered = filtered.filter((member) => member.voting?.status === votingStatusFilter);
      }

      // Apply organization filter
      const organizationFilter = this.organizationFilter();
      if (organizationFilter) {
        filtered = filtered.filter((member) => member.organization?.name === organizationFilter);
      }

      return filtered;
    });
  }

  private initChipConfig(): Signal<CommitteeMemberFilterChipConfig[]> {
    return computed(() => {
      const chips: CommitteeMemberFilterChipConfig[] = [
        { key: 'all', label: 'All', count: this.members().length },
        { key: 'voting', label: 'Voting Reps', count: this.votingRepCount() },
        { key: 'observers', label: 'Observers', count: this.observerCount() },
        { key: 'chairs', label: 'Chairs', count: this.chairCount() },
      ];
      // At Risk only makes sense against a real (non-degraded) engagement response — a degraded
      // response zeroes every row, so the chip would be a permanent "(0)".
      if (this.engagementEnabled() && this.engagementDataAvailable()) {
        chips.push({ key: 'atRisk', label: 'At Risk', count: this.atRiskCount() });
      }
      return chips;
    });
  }

  private initChipFilteredMembers(): Signal<CommitteeMember[]> {
    return computed(() => {
      const chip = this.memberFilterChip();
      const members = this.members();
      switch (chip) {
        case 'voting':
          return members.filter(isVotingRep);
        case 'observers':
          return members.filter((m) => m.voting?.status === CommitteeMemberVotingStatus.OBSERVER);
        case 'chairs':
          return members.filter((m) => m.role?.name === CommitteeMemberRole.CHAIR || m.role?.name === CommitteeMemberRole.VICE_CHAIR);
        case 'atRisk': {
          // If the chip was selected and the data then degraded (window switch, fetch failure),
          // the chip itself disappears from chipConfig — fall back to the full roster rather than
          // silently filtering everything out against zeroed rows.
          if (!this.engagementDataAvailable()) {
            return members;
          }
          const byUid = this.engagementByUid();
          return members.filter((m) => {
            const row = byUid.get(m.uid);
            return row ? isCommitteeEngagementRowAtRisk(row) : false;
          });
        }
        default:
          return members;
      }
    });
  }

  private initMemberEngagementRows(): Signal<Map<string, CommitteeMemberEngagementRowView>> {
    return computed(() => {
      const byUid = this.engagementByUid();
      const dataAvailable = this.engagementDataAvailable();
      const rows = new Map<string, CommitteeMemberEngagementRowView>();
      for (const member of this.members()) {
        const row = byUid.get(member.uid) ?? null;
        rows.set(member.uid, {
          row,
          meetingsLabel: formatCommitteeEngagementMeetings(row, dataAvailable),
          context: row ? this.resolveEngagementContext(row) : '',
          severity: row ? this.resolveEngagementSeverity(row) : 'secondary',
        });
      }
      return rows;
    });
  }

  private resolveEngagementSeverity(row: CommitteeMemberEngagement): TagSeverity {
    // `classification` is a server passthrough — a tier added server-side before this UI updates
    // isn't representable in the type, so degrade to neutral rather than an undefined severity.
    const severity = COMMITTEE_ENGAGEMENT_CLASSIFICATION_TAG_SEVERITY[row.classification] as TagSeverity | undefined;
    return severity ?? 'secondary';
  }

  /**
   * Tooltip context for the engagement chip. Emeritus gets the honorific explainer (it renders as
   * a neutral state, never at-risk styling); Chair / Vice Chair / LF Staff seats are called out so
   * their attendance reads with role context. Empty string disables the PrimeNG tooltip.
   */
  private resolveEngagementContext(row: CommitteeMemberEngagement): string {
    if (row.voting_status === CommitteeMemberVotingStatus.EMERITUS) {
      return 'Emeritus seat — honorific status; attendance expectations do not apply';
    }
    if (row.role === CommitteeMemberRole.CHAIR || row.role === CommitteeMemberRole.VICE_CHAIR || row.role === CommitteeMemberRole.LF_STAFF) {
      return `${row.role} — attended ${row.attended} of ${row.invited} invited meetings`;
    }
    return '';
  }

  private initTableRows(): Signal<CommitteeTableRow[]> {
    return computed(() => {
      if (this.activeTab() === 'pending') {
        return this.invites().map((invite) => ({ rowType: 'invite' as const, data: invite }));
      }
      const memberRows: CommitteeTableRow[] = this.filteredMembers().map((m) => ({ rowType: 'member' as const, data: m }));
      if (!this.canManageMembers() || this.joinMode() === 'closed') {
        return memberRows;
      }
      const inviteRows: CommitteeTableRow[] = this.invites().map((invite) => ({ rowType: 'invite' as const, data: invite }));
      return [...memberRows, ...inviteRows];
    });
  }

  private initializeInviteActionMenuItems(invite?: CommitteeInvite): MenuItem[] {
    return [
      {
        label: 'Revoke invitation',
        icon: 'fa-light fa-ban',
        styleClass: 'text-red-500',
        disabled: !!this.revokingInviteUid(),
        command: () => {
          const target = invite ?? this.selectedInvite();
          if (target) {
            this.revokeInvite(target);
          }
        },
      },
    ];
  }
}
