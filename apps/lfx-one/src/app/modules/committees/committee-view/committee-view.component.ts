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
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { Committee, CommitteeMember, CommitteeMemberVisibility, getCommitteeCategorySeverity, TagSeverity } from '@lfx-one/shared';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { MenuItem, MessageService } from 'primeng/api';
import { catchError, combineLatest, finalize, map, of, switchMap, take } from 'rxjs';

import { CommitteeMeetingsComponent } from '../components/committee-meetings/committee-meetings.component';
import { CommitteeMembersComponent } from '../components/committee-members/committee-members.component';
import { CommitteeOverviewComponent } from '../components/committee-overview/committee-overview.component';
import { CommitteeSettingsTabComponent } from '../components/committee-settings-tab/committee-settings-tab.component';
import { CommitteeSurveysComponent } from '../components/committee-surveys/committee-surveys.component';

type CommitteeTab = 'overview' | 'members' | 'votes' | 'meetings' | 'surveys' | 'documents' | 'settings';

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
    CommitteeMeetingsComponent,
    CommitteeMembersComponent,
    CommitteeOverviewComponent,
    CommitteeSettingsTabComponent,
    CommitteeSurveysComponent,
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

  public meetingsTimeFilter = signal<'upcoming' | 'past'>('upcoming');

  // -- Writable signals --
  public loading = signal<boolean>(true);
  public error = signal<boolean>(false);
  public errorType = signal<'not-found' | 'server-error' | null>(null);
  public refresh = signal(0);
  public membersRefresh = signal(0);
  public membersLoading = signal<boolean>(true);
  public myRoleLoading = signal(true);

  // -- Channels edit state --
  public showChannelsModal = model(false);
  public channelsForm = new FormGroup({
    mailingList: new FormControl(''),
    chatChannel: new FormControl(''),
  });
  public savingChannels = signal(false);


  // -- Computed / toSignal --
  public committee: Signal<Committee | null> = this.initializeCommittee();
  public members: Signal<CommitteeMember[]> = this.initializeMembers();
  public myMembership: Signal<MyCommittee | null> = this.initMyMembership();
  public myRole: Signal<string | null> = computed(() => this.myMembership()?.my_role ?? null);
  public myMemberUid: Signal<string | null> = computed(() => this.myMembership()?.my_member_uid ?? null);
  public isVisitor: Signal<boolean> = computed(() => this.myRole() === null && !this.myRoleLoading());

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
  public repoPlatformLabel: Signal<string> = this.initRepoPlatformLabel();

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
    const validTabs: CommitteeTab[] = ['overview', 'members', 'votes', 'meetings', 'surveys', 'documents', 'settings'];
    if (!validTabs.includes(tab as CommitteeTab)) {
      return;
    }
    this.activeTab.set(tab as CommitteeTab);
    if (tab === 'meetings' && (context === 'past' || context === 'upcoming')) {
      this.meetingsTimeFilter.set(context);
    }
  }

  public openEditChannels(): void {
    this.channelsForm.patchValue({
      mailingList: this.committee()?.mailing_list || '',
      chatChannel: this.committee()?.chat_channel || '',
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
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Channels updated' });
          this.showChannelsModal.set(false);
          this.savingChannels.set(false);
          this.refreshCommittee();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update channels' });
          this.savingChannels.set(false);
        },
      });
  }

  public handleJoinRequest(): void {
    const committee = this.committee();
    if (!committee) {
      return;
    }
    if (committee.join_mode === 'open') {
      this.committeeService
        .joinCommittee(committee.uid)
        .pipe(take(1))
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
      this.messageService.add({ severity: 'info', summary: 'Request Required', detail: 'Contact a group admin to request membership.' });
    }
  }

  public handleLeaveRequest(): void {
    const committee = this.committee();
    if (!committee) {
      return;
    }
    this.committeeService
      .leaveCommittee(committee.uid)
      .pipe(take(1))
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
    return computed(() => {
      const url = this.committee()?.chat_channel?.toLowerCase() || '';
      if (url.includes('slack')) return 'Slack';
      if (url.includes('discord')) return 'Discord';
      if (url.includes('teams.microsoft') || url.includes('teams.live')) return 'Microsoft Teams';
      if (url.includes('chat.google')) return 'Google Chat';
      if (url.includes('zulip')) return 'Zulip';
      if (url.includes('matrix') || url.includes('element')) return 'Matrix / Element';
      return 'Other';
    });
  }

  private initRepoPlatformLabel(): Signal<string> {
    return computed(() => {
      const url = this.committee()?.website?.toLowerCase() || '';
      if (url.includes('github')) return 'GitHub';
      if (url.includes('gitlab')) return 'GitLab';
      if (url.includes('bitbucket')) return 'Bitbucket';
      return 'Website';
    });
  }

  private initMyMembership(): Signal<MyCommittee | null> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.membersRefresh)]).pipe(
        switchMap(([committee]) => {
          if (!committee?.uid) {
            this.myRoleLoading.set(false);
            return of(null);
          }
          this.myRoleLoading.set(true);
          return this.committeeService.getMyCommittees().pipe(
            map((list) => list.find((c) => c.uid === committee.uid) ?? null),
            catchError(() => of(null)),
            finalize(() => this.myRoleLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
