// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, inject, model, PLATFORM_ID, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { SkeletonModule } from 'primeng/skeleton';

import { CHAIR_AVATAR_COLOR, DETAIL_TABS, getCommitteeCategorySeverity, VALID_DEMO_PROJECT_SLUGS } from '@lfx-one/shared/constants';
import type {
  GroupDetailTabConfig,
  GroupDetailTabId,
  GroupMember,
  MyDocumentItem,
  OrgGroupDetail,
  Survey,
  TagSeverity,
  Vote,
} from '@lfx-one/shared/interfaces';
import { getChatPlatformIcon, getChatPlatformLabel, getRepoPlatformIcon, getRepoPlatformLabel } from '@lfx-one/shared/utils';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { DocumentsTableComponent } from '@components/documents-table/documents-table.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { SurveyResultsDrawerComponent } from '@app/modules/surveys/components/survey-results-drawer/survey-results-drawer.component';
import { SurveysTableComponent } from '@app/modules/surveys/components/surveys-table/surveys-table.component';
import { VoteResultsDrawerComponent } from '@app/modules/votes/components/vote-results-drawer/vote-results-drawer.component';
import { VotesTableComponent } from '@app/modules/votes/components/votes-table/votes-table.component';
import { AccountContextService } from '@services/account-context.service';

import { OrgGroupsService } from '../services/org-groups.service';
import { OrgGroupMeetingCardComponent } from './components/org-group-meeting-card/org-group-meeting-card.component';

/** Group detail page shell (LFXV2-1879) — overview, members, meetings, votes, surveys, documents tabs. */
@Component({
  selector: 'lfx-org-group-detail',
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    TagComponent,
    SkeletonModule,
    OrgGroupMeetingCardComponent,
    TableComponent,
    VotesTableComponent,
    VoteResultsDrawerComponent,
    SurveysTableComponent,
    SurveyResultsDrawerComponent,
    DocumentsTableComponent,
  ],
  templateUrl: './org-group-detail.component.html',
})
export class OrgGroupDetailComponent {
  // ─── Private injections ──────────────────────────────────────────────────────

  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly groupsService = inject(OrgGroupsService);
  private readonly accountContext = inject(AccountContextService);

  // ─── Constants exposed to template ───────────────────────────────────────────

  protected readonly tabs: readonly GroupDetailTabConfig[] = DETAIL_TABS;
  protected readonly chairAvatarColor = CHAIR_AVATAR_COLOR;

  /** Pure platform-detection helpers exposed for template binding. */
  protected readonly chatPlatformIcon = getChatPlatformIcon;
  protected readonly chatPlatformLabel = getChatPlatformLabel;
  protected readonly repoPlatformIcon = getRepoPlatformIcon;
  protected readonly repoPlatformLabel = getRepoPlatformLabel;

  // ─── Two-way bindings ─────────────────────────────────────────────────────────

  protected voteResultsDrawerVisible = model<boolean>(false);
  protected surveyResultsDrawerVisible = model<boolean>(false);

  // ─── Mutable state ────────────────────────────────────────────────────────────

  protected activeTab = signal<GroupDetailTabId>('overview');
  protected selectedVoteId = signal<string | null>(null);
  protected selectedVote = signal<Vote | null>(null);
  protected selectedSurveyId = signal<string | null>(null);
  protected selectedSurvey = signal<Survey | null>(null);

  // ─── Route param signal ───────────────────────────────────────────────────────

  private readonly groupId = toSignal(this.route.paramMap.pipe(switchMap((p) => of(p.get('groupId') ?? ''))), { initialValue: '' });

  // ─── Server data ──────────────────────────────────────────────────────────────

  protected readonly loading = signal(true);
  protected readonly detail: Signal<OrgGroupDetail | null> = this.initDetail();

  // ─── Computed helpers ─────────────────────────────────────────────────────────

  /** Org Lens is a cross-company aggregate view — gate content on an Impersonate company selection, like the groups list and Org Project Detail. */
  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);

  protected readonly hasNextMeeting = computed(() => (this.detail()?.nextMeetings.length ?? 0) > 0);
  protected readonly hasPastMeeting = computed(() => (this.detail()?.pastMeetings.length ?? 0) > 0);
  protected readonly nextMeeting = computed(() => this.detail()?.nextMeetings[0] ?? null);
  protected readonly pastMeeting = computed(() => this.detail()?.pastMeetings[0] ?? null);

  /** Guards the "Parent Project" link — only known Org Lens project-detail demo ids are navigable. */
  protected readonly hasValidParentProject = computed(() => VALID_DEMO_PROJECT_SLUGS.has(this.detail()?.parentProjectId ?? ''));

  protected readonly members = computed<GroupMember[]>(() => this.detail()?.members ?? []);
  protected readonly votes = computed<Vote[]>(() => this.detail()?.votes ?? []);
  protected readonly surveys = computed<Survey[]>(() => this.detail()?.surveys ?? []);
  protected readonly documents = computed<MyDocumentItem[]>(() => this.detail()?.documents ?? []);

  /** Group type tag severity, keyed off the same category→severity map production uses for committees. */
  protected readonly typeSeverity: Signal<TagSeverity> = this.initTypeSeverity();

  /** Votes tab only shows for groups with voting enabled, mirroring committee's `enable_voting` gate. */
  protected readonly visibleTabs: Signal<readonly GroupDetailTabConfig[]> = this.initVisibleTabs();

  constructor() {
    // Angular reuses this component instance across `/org/groups/:groupId` navigations — reset the
    // tab selection so switching groups doesn't strand the viewer on a tab the new group may not have.
    effect(() => {
      this.groupId();
      this.activeTab.set('overview');
    });
  }

  // ─── Public methods ───────────────────────────────────────────────────────────

  protected switchTab(id: GroupDetailTabId): void {
    this.activeTab.set(id);
  }

  protected goToParentProject(): void {
    const parentProjectId = this.detail()?.parentProjectId;
    if (parentProjectId && this.hasValidParentProject()) {
      void this.router.navigate(['/org/projects', parentProjectId]);
    }
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.visibleTabs().map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (isPlatformBrowser(this.platformId)) {
        (document.getElementById(`org-group-detail-tab-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  protected formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  protected viewVoteResults(voteUid: string): void {
    const vote = this.votes().find((v) => v.uid === voteUid) || null;
    this.selectedVoteId.set(voteUid);
    this.selectedVote.set(vote);
    this.voteResultsDrawerVisible.set(true);
  }

  protected viewSurveyResults(survey: Survey): void {
    this.selectedSurveyId.set(survey.uid);
    this.selectedSurvey.set(survey);
    this.surveyResultsDrawerVisible.set(true);
  }

  // ─── Private initializers ─────────────────────────────────────────────────────

  private initVisibleTabs(): Signal<readonly GroupDetailTabConfig[]> {
    return computed(() => this.tabs.filter((tab) => tab.id !== 'votes' || this.detail()?.votingEnabled));
  }

  private initTypeSeverity(): Signal<TagSeverity> {
    return computed(() => getCommitteeCategorySeverity(this.detail()?.type ?? ''));
  }

  private initDetail(): Signal<OrgGroupDetail | null> {
    return toSignal(
      toObservable(this.groupId).pipe(
        switchMap((id) => {
          if (!id) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.groupsService.getGroupDetail(id).pipe(
            switchMap((data) => {
              this.loading.set(false);
              return of(data);
            }),
            catchError((err) => {
              console.error('[OrgGroupDetail] failed to load group detail', err);
              this.loading.set(false);
              return of(null);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }
}
