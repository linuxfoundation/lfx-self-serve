// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, linkedSignal, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, NgClass } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { Committee, CommitteeMember, CommitteeMemberVisibility, getCommitteeCategorySeverity, TagSeverity } from '@lfx-one/shared';
import { getChatPlatformIcon, getChatPlatformLabel, getRepoPlatformIcon, getRepoPlatformLabel } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { UserService } from '@services/user.service';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MenuItem, MessageService } from 'primeng/api';
import { catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import { CommitteeDocumentsComponent } from '../components/committee-documents/committee-documents.component';
import { CommitteeMeetingsComponent } from '../components/committee-meetings/committee-meetings.component';
import { CommitteeMembersComponent } from '../components/committee-members/committee-members.component';
import { CommitteeOverviewComponent } from '../components/committee-overview/committee-overview.component';
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
    InputTextComponent,
    Dialog,
    JoinModeLabelPipe,
    LinkifyPipe,
    TextareaComponent,
    CommitteeDocumentsComponent,
    CommitteeMeetingsComponent,
    CommitteeMembersComponent,
    CommitteeOverviewComponent,
    CommitteeSettingsTabComponent,
    CommitteeSurveysComponent,
    CommitteeVotesComponent,
  ],
  templateUrl: './committee-view.component.html',
  styleUrl: './committee-view.component.scss',
})
export class CommitteeViewComponent {
  // -- Injections --
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
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

  // -- Channels edit state --
  public showChannelsModal = model(false);
  public channelsForm = new FormGroup({
    mailingList: new FormControl(''),
    chatChannel: new FormControl(''),
    website: new FormControl(''),
  });
  public savingChannels = signal(false);

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
    return !!(c?.mailing_list || c?.chat_channel || c?.website) || this.canEdit();
  });

  public chatPlatformLabel: Signal<string> = this.initChatPlatformLabel();
  public chatPlatformIcon: Signal<string> = this.initChatPlatformIcon();
  public repoPlatformLabel: Signal<string> = this.initRepoPlatformLabel();
  public repoPlatformIcon: Signal<string> = this.initRepoPlatformIcon();

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
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update description' });
        },
      });
  }

  public openEditChannels(): void {
    this.channelsForm.patchValue({
      mailingList: this.committee()?.mailing_list || '',
      chatChannel: this.committee()?.chat_channel || '',
      website: this.committee()?.website || '',
    });
    this.showChannelsModal.set(true);
  }

  public cancelEditChannels(): void {
    this.showChannelsModal.set(false);
  }

  public saveChannels(): void {
    const committee = this.committee();
    if (!committee?.uid) {
      return;
    }
    this.savingChannels.set(true);

    this.committeeService
      .updateCommittee(committee.uid, {
        mailing_list: this.channelsForm.get('mailingList')?.value || null,
        chat_channel: this.channelsForm.get('chatChannel')?.value || null,
        website: this.channelsForm.get('website')?.value || null,
      })
      .pipe(finalize(() => this.savingChannels.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Channels updated' });
          this.showChannelsModal.set(false);
          this.refreshCommittee();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update channels' });
        },
      });
  }

  public handleJoinRequest(): void {
    const committee = this.committee();
    if (!committee || this.joiningOrLeaving()) {
      return;
    }
    if (committee.join_mode === 'open') {
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
          error: () => {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: `Failed to join "${committee.name}"` });
          },
        });
    } else {
      // Backend does not yet support application-based join requests — show guidance instead
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
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: `Failed to leave "${committee.name}"` });
        },
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
}
