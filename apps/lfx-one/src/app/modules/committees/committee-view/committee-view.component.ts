// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, linkedSignal, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Dialog } from 'primeng/dialog';
import { PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { Committee, CommitteeMember, CommitteeMemberVisibility, getCommitteeCategorySeverity, TagSeverity } from '@lfx-one/shared';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { getChatPlatformIcon, getChatPlatformLabel, getRepoPlatformIcon, getRepoPlatformLabel } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MailingListService } from '@services/mailing-list.service';
import { UserService } from '@services/user.service';
import { CategoryAvatarColorPipe } from '@pipes/category-avatar-color.pipe';
import { InitialsPipe } from '@pipes/initials.pipe';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { SafeUrlPipe } from '@pipes/safe-url.pipe';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MenuItem, MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, finalize, of, switchMap, take } from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
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

type CommitteeTab = 'overview' | 'members' | 'votes' | 'meetings' | 'surveys' | 'documents' | 'settings';
const VALID_TABS: CommitteeTab[] = ['overview', 'members', 'votes', 'meetings', 'surveys', 'documents', 'settings'];

@Component({
  selector: 'lfx-committee-view',
  imports: [
    BreadcrumbComponent,
    ButtonComponent,
    TagComponent,
    RouteLoadingComponent,
    DatePipe,
    NgClass,
    ReactiveFormsModule,
    Dialog,
    PopoverModule,
    SkeletonModule,
    CategoryAvatarColorPipe,
    InitialsPipe,
    JoinModeLabelPipe,
    LinkifyPipe,
    MailingListEmailPipe,
    SafeUrlPipe,
    TextareaComponent,
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

  public meetingsTimeFilter = signal<'upcoming' | 'past'>('upcoming');

  // Initial tab from queryParams (e.g., ?tab=surveys after create flow redirect)
  private readonly initialTab: CommitteeTab | null = (() => {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    return tab && VALID_TABS.includes(tab as CommitteeTab) ? (tab as CommitteeTab) : null;
  })();

  // -- Writable signals --
  public loading = signal<boolean>(true);
  public error = signal<boolean>(false);
  public errorType = signal<'not-found' | 'server-error' | null>(null);
  public refresh = signal(0);
  public membersRefresh = signal(0);
  public membersLoading = signal<boolean>(true);
  public myRoleLoading: Signal<boolean> = computed(() => this.membersLoading());
  public joiningOrLeaving = signal(false);

  // -- Description state --
  public showDescriptionDialog = signal(false);
  public editingDescription = signal(false);
  public savingDescription = signal(false);
  public descriptionForm = new FormGroup({
    description: new FormControl(''),
  });

  // -- Computed / toSignal --
  public committee: Signal<Committee | null> = this.initializeCommittee();
  public members: Signal<CommitteeMember[]> = this.initializeMembers();

  // Derive membership from already-fetched members list + current user email
  public myMember: Signal<CommitteeMember | null> = computed(() => {
    const members = this.members();
    const email = this.userService.user()?.email?.toLowerCase();
    if (!email || !members.length) return null;
    return members.find((m) => m.email?.toLowerCase() === email) ?? null;
  });
  public myRole: Signal<string | null> = computed(() => this.myMember()?.role?.name ?? null);
  public myMemberUid: Signal<string | null> = computed(() => this.myMember()?.uid ?? null);
  public isVisitor: Signal<boolean> = computed(() => this.myRole() === null && !this.membersLoading());

  public categorySeverity: Signal<TagSeverity> = computed(() => {
    const category = this.committee()?.category;
    return getCommitteeCategorySeverity(category || '');
  });

  public breadcrumbItems: Signal<MenuItem[]> = computed(() => [{ label: 'Groups', routerLink: ['/groups'] }, { label: this.committee()?.name || '' }]);

  public canEdit: Signal<boolean> = computed(() => !!this.committee()?.writer);

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
  public isMembersTabVisible: Signal<boolean> = computed(() => this.committee()?.member_visibility !== CommitteeMemberVisibility.HIDDEN || this.canEdit());
  public isVotesTabVisible: Signal<boolean> = computed(() => !!this.committee()?.enable_voting);

  // -- Visitor gating --
  public isMemberOrAdmin: Signal<boolean> = computed(() => !this.isVisitor() || this.canEdit());

  public readonly tabConfig: { key: CommitteeTab; label: string; icon: string; visible: () => boolean; badge?: () => number | null }[] = [
    { key: 'overview', label: 'Overview', icon: 'fa-gauge', visible: () => true },
    {
      key: 'members',
      label: 'Members',
      icon: 'fa-users',
      visible: () => this.isMemberOrAdmin() && this.isMembersTabVisible(),
      badge: () => this.committee()?.total_members ?? null,
    },
    { key: 'votes', label: 'Votes', icon: 'fa-check-to-slot', visible: () => this.isMemberOrAdmin() && this.isVotesTabVisible() },
    { key: 'meetings', label: 'Meetings', icon: 'fa-calendar', visible: () => this.isMemberOrAdmin() },
    { key: 'surveys', label: 'Surveys', icon: 'fa-chart-simple', visible: () => this.isMemberOrAdmin() },
    { key: 'documents', label: 'Documents', icon: 'fa-folder-open', visible: () => this.isMemberOrAdmin() },
    { key: 'settings', label: 'Settings', icon: 'fa-gear', visible: () => this.canEdit() },
  ];

  public visibleTabs: Signal<typeof this.tabConfig> = computed(() => this.tabConfig.filter((tab) => tab.visible()));

  // -- Tab state: linkedSignal keeps user selection unless it becomes invalid --
  public activeTab = linkedSignal<typeof this.tabConfig, CommitteeTab>({
    source: this.visibleTabs,
    computation: (visible, previous) => {
      // On first computation, use queryParam tab if provided and visible
      if (!previous && this.initialTab && visible.some((t) => t.key === this.initialTab)) {
        return this.initialTab!;
      }
      if (previous && visible.some((t) => t.key === previous.value)) {
        return previous.value;
      }
      return 'overview';
    },
  });

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
  }

  public handleTabNavigation(tabWithContext: string): void {
    const [tab, context] = tabWithContext.split(':');
    if (!VALID_TABS.includes(tab as CommitteeTab)) {
      return;
    }
    this.activeTab.set(tab as CommitteeTab);
    if (tab === 'meetings' && (context === 'past' || context === 'upcoming')) {
      this.meetingsTimeFilter.set(context);
    }
  }

  public openEditDescription(): void {
    this.descriptionForm.patchValue({ description: this.committee()?.description || '' });
    this.editingDescription.set(true);
  }

  public cancelEditDescription(): void {
    this.editingDescription.set(false);
  }

  public saveDescription(): void {
    this.savingDescription.set(true);
    const description = this.descriptionForm.get('description')?.value || '';
    this.committeeService
      .updateCommittee(this.committee()!.uid, { description })
      .pipe(finalize(() => this.savingDescription.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Description updated' });
          this.editingDescription.set(false);
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
            this.refreshCommittee();
            this.membersRefresh.update((v) => v + 1);
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

  public navigateToParentGroup(): void {
    const parent = this.parentGroup();
    if (parent?.uid) {
      this.router.navigate(['/', 'groups', parent.uid]);
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

          // Only show full loading spinner on initial load, not on silent refreshes
          if (!this.committee()) {
            this.loading.set(true);
          }

          return this.committeeService.getCommittee(committeeId).pipe(
            catchError((err) => {
              const status = err?.status;
              if (status === 404 || status === 403) {
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
            finalize(() => this.loading.set(false))
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
