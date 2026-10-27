// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NpsGaugeComponent } from '@components/nps-gauge/nps-gauge.component';
import { SurveyStatus } from '@lfx-one/shared';
import {
  NpsBreakdown,
  Survey,
  SurveyComment,
  SurveyEngagementRates,
  SurveyParticipationStats,
  SurveyResponseItem,
  SurveyResyncDialogData,
  SurveyResyncScope,
} from '@lfx-one/shared/interfaces';
import {
  getResponseComment,
  getSurveyDisplayStatus,
  getSurveyEngagementRates,
  getSurveyResyncScope,
  hasSurveyResponse,
  isSurveyOpenForFollowUp,
} from '@lfx-one/shared/utils';
import { SurveyStatusLabelPipe } from '@pipes/survey-status-label.pipe';
import { ProjectContextService } from '@services/project-context.service';
import { SurveyService } from '@services/survey.service';
import { DrawerModule } from 'primeng/drawer';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, finalize, of, startWith, switchMap } from 'rxjs';

import { SurveyResponsesListComponent } from '../survey-responses-list/survey-responses-list.component';
import { SurveyResyncDialogComponent } from '../survey-resync-dialog/survey-resync-dialog.component';

@Component({
  selector: 'lfx-survey-results-drawer',
  imports: [DrawerModule, DatePipe, NgTemplateOutlet, SurveyStatusLabelPipe, SkeletonModule, NpsGaugeComponent, SurveyResponsesListComponent],
  providers: [DialogService],
  templateUrl: './survey-results-drawer.component.html',
  styleUrl: './survey-results-drawer.component.scss',
})
export class SurveyResultsDrawerComponent {
  // === Services ===
  private readonly surveyService = inject(SurveyService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly surveyId = input<string | null>(null);
  public readonly listSurvey = input<Survey | null>(null);
  public readonly hasPMOAccess = input<boolean>(false);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly duplicate = output<string>();
  public readonly closeSurvey = output<string>();

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(false);
  protected readonly showAdminMenu = signal<boolean>(false);
  protected readonly activeTab = signal<'overview' | 'responses'>('overview');
  protected readonly responsesLoading = signal<boolean>(false);
  protected readonly responsesLoadError = signal<boolean>(false);
  /** Bumped after a reminder or resync so the survey and its rows reload. */
  private readonly refreshCount = signal<number>(0);

  // === Computed: project scope + responsive drawer width ===
  protected readonly projectUid: Signal<string | null> = computed(() => this.projectContextService.activeContext()?.uid ?? null);
  // The Responses table needs more room than the aggregate Overview, so widen the
  // drawer when that tab is active and snap back to the narrower width otherwise.
  protected readonly drawerStyleClass: Signal<string> = computed(() => {
    const width = this.activeTab() === 'responses' ? 'xl:w-[75%] lg:w-[80%]' : 'xl:w-[45%] lg:w-[55%]';
    return `${width} md:w-[70%] sm:w-[90%] w-full survey-results-drawer`;
  });

  // === Derived Signals (from API) ===
  protected readonly survey: Signal<Survey | null> = this.initSurvey();
  /** Every per-recipient row, loaded only for Manage users (rows carry personal links). */
  protected readonly responses: Signal<SurveyResponseItem[]> = this.initResponses();

  // === Computed Signals ===
  protected readonly isSurveyClosed: Signal<boolean> = this.initIsSurveyClosed();
  protected readonly isNpsSurvey: Signal<boolean> = this.initIsNpsSurvey();
  protected readonly participationStats: Signal<SurveyParticipationStats> = this.initParticipationStats();
  protected readonly npsScore: Signal<number> = this.initNpsScore();
  protected readonly npsBreakdown: Signal<NpsBreakdown | null> = this.initNpsBreakdown();
  protected readonly groupName: Signal<string> = this.initGroupName();
  protected readonly engagementRates: Signal<SurveyEngagementRates | null> = this.initEngagementRates();
  protected readonly comments: Signal<SurveyComment[]> = this.initComments();
  /** Resync is offered only while open, and only when it can be kept to this project's committee. */
  protected readonly resyncScope: Signal<SurveyResyncScope | null> = computed(() => {
    const s = this.survey();
    return s && this.hasPMOAccess() && isSurveyOpenForFollowUp(s) ? getSurveyResyncScope(s, this.projectUid()) : null;
  });
  protected readonly hasComments: Signal<boolean> = computed(() => this.comments().length > 0);
  protected readonly commentsCount: Signal<number> = computed(() => this.comments().length);

  // === Protected Methods ===
  protected onClose(): void {
    this.showAdminMenu.set(false);
    this.activeTab.set('overview');
    this.visible.set(false);
  }

  protected setTab(tab: 'overview' | 'responses'): void {
    this.activeTab.set(tab === 'responses' && !this.hasPMOAccess() ? 'overview' : tab);
  }

  protected toggleAdminMenu(): void {
    this.showAdminMenu.update((v) => !v);
  }

  protected closeAdminMenu(): void {
    this.showAdminMenu.set(false);
  }

  protected onDuplicate(): void {
    const s = this.survey();
    if (s?.uid) {
      this.duplicate.emit(s.uid);
      this.closeAdminMenu();
    }
  }

  protected onCloseSurvey(): void {
    const s = this.survey();
    if (s?.uid) {
      this.closeSurvey.emit(s.uid);
      this.closeAdminMenu();
    }
  }

  protected refresh(): void {
    this.refreshCount.update((n) => n + 1);
  }

  protected openResyncDialog(): void {
    const survey = this.survey();
    const scope = this.resyncScope();
    if (!survey || !scope) return;
    this.closeAdminMenu();
    const data: SurveyResyncDialogData = { survey, committeeUid: scope.committeeUid };
    this.dialogService
      .open(SurveyResyncDialogComponent, {
        header: 'Resync recipients',
        width: 'min(760px, 96vw)',
        modal: true,
        closable: true,
        draggable: false,
        data,
      })
      ?.onClose.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sent) => {
        if (sent === true) this.refresh();
      });
  }

  protected getBreakdownPercentage(count: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((count / total) * 100);
  }

  // === Private Initializers ===
  private initSurvey(): Signal<Survey | null> {
    return toSignal(
      // Same project scope as the response rows, so totals/NPS and rates/comments always match;
      // `refreshCount` reloads after a reminder or resync.
      combineLatest([toObservable(this.surveyId), toObservable(this.projectUid), toObservable(this.refreshCount)]).pipe(
        switchMap(([id, projectUid, refreshCount]) => {
          if (!id) {
            this.loading.set(false);
            return of(null);
          }

          this.loading.set(true);
          const listData = this.listSurvey();

          return this.surveyService.getSurvey(id, projectUid ?? undefined, { skipCache: refreshCount > 0 }).pipe(
            catchError(() => of(listData)),
            finalize(() => this.loading.set(false)),
            startWith(listData)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initResponses(): Signal<SurveyResponseItem[]> {
    return toSignal(
      // `visible` is a trigger so reopening the drawer refetches (and retries a failed load);
      // closing it cancels an in-flight load. `refreshCount` reloads after a reminder or resync.
      combineLatest([
        toObservable(this.surveyId),
        toObservable(this.projectUid),
        toObservable(this.hasPMOAccess),
        toObservable(this.visible),
        toObservable(this.refreshCount),
      ]).pipe(
        switchMap(([id, projectUid, canManage, visible]) => {
          this.responsesLoadError.set(false);
          if (!id || !canManage || !visible) {
            this.responsesLoading.set(false);
            return of([] as SurveyResponseItem[]);
          }
          this.responsesLoading.set(true);
          return this.surveyService.getAllSurveyResponses(id, projectUid ?? undefined).pipe(
            catchError((error) => {
              console.error(`Failed to load responses for survey ${id}:`, error);
              this.responsesLoadError.set(true);
              return of([] as SurveyResponseItem[]);
            }),
            finalize(() => this.responsesLoading.set(false)),
            // Clear the previous survey's rows while this one loads, so they never show under its title.
            startWith([] as SurveyResponseItem[])
          );
        })
      ),
      { initialValue: [] as SurveyResponseItem[] }
    );
  }

  private initEngagementRates(): Signal<SurveyEngagementRates | null> {
    return computed(() => {
      const rows = this.responses();
      return rows.length > 0 ? getSurveyEngagementRates(rows) : null;
    });
  }

  private initIsSurveyClosed(): Signal<boolean> {
    return computed(() => {
      const s = this.survey();
      if (!s) return false;
      const displayStatus = getSurveyDisplayStatus(s);
      return displayStatus === SurveyStatus.CLOSED;
    });
  }

  private initIsNpsSurvey(): Signal<boolean> {
    return computed(() => {
      const s = this.survey();
      return s?.is_nps_survey ?? false;
    });
  }

  private initParticipationStats(): Signal<SurveyParticipationStats> {
    return computed(() => {
      const s = this.survey();
      if (!s) {
        return { eligibleParticipants: 0, totalResponses: 0, participationRate: 0 };
      }

      const eligibleParticipants = s.total_recipients || 0;
      const totalResponses = s.total_responses || 0;
      const participationRate = eligibleParticipants > 0 ? Math.round((totalResponses / eligibleParticipants) * 100) : 0;

      return { eligibleParticipants, totalResponses, participationRate };
    });
  }

  private initNpsScore(): Signal<number> {
    return computed(() => {
      const s = this.survey();
      if (!s?.is_nps_survey) return 0;

      // Use top-level nps_value from detail API if available
      if (s.nps_value !== undefined) {
        return s.nps_value;
      }

      // Fall back: calculate from committees
      if (s.committees?.length > 0) {
        const totalResponses = s.committees.reduce((sum, c) => sum + c.total_responses, 0);
        if (totalResponses > 0) {
          const weightedNps = s.committees.reduce((sum, c) => sum + c.nps_value * c.total_responses, 0);
          return Math.round(weightedNps / totalResponses);
        }
      }

      return 0;
    });
  }

  private initNpsBreakdown(): Signal<NpsBreakdown | null> {
    return computed(() => {
      const s = this.survey();
      if (!s?.is_nps_survey) return null;

      // Use top-level counts from detail API if available
      if (s.num_promoters !== undefined && s.num_passives !== undefined && s.num_detractors !== undefined) {
        return {
          promoters: s.num_promoters,
          passives: s.num_passives,
          detractors: s.num_detractors,
          nonResponses: Math.max(0, (s.total_recipients || 0) - (s.total_responses || 0)),
        };
      }

      // Fall back: calculate from committees
      if (s.committees?.length > 0) {
        return {
          promoters: s.committees.reduce((sum, c) => sum + c.num_promoters, 0),
          passives: s.committees.reduce((sum, c) => sum + c.num_passives, 0),
          detractors: s.committees.reduce((sum, c) => sum + c.num_detractors, 0),
          nonResponses: Math.max(0, s.total_recipients - s.total_responses),
        };
      }

      return null;
    });
  }

  private initGroupName(): Signal<string> {
    return computed(() => {
      const s = this.survey();
      if (!s) return 'Unknown';

      // For multi-committee surveys, use the category label
      if (s.committees?.length > 1 && s.committee_category) {
        return s.committee_category;
      }

      return s.committees?.[0]?.committee_name || s.committee_category || 'Unknown';
    });
  }

  /** Comments come from the response rows (Manage users only); nothing upstream fills an aggregate comments field. */
  private initComments(): Signal<SurveyComment[]> {
    return computed(() =>
      this.responses()
        .filter(hasSurveyResponse)
        .map((row) => ({ id: row.id, comment: getResponseComment(row) ?? '', submitted_at: row.response_datetime ?? '' }))
        .filter((c) => c.comment !== '')
        .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    );
  }
}
