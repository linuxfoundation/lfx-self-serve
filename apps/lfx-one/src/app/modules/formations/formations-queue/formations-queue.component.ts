// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { FormationService } from '@services/formation.service';
import { ProjectApplicationService } from '@services/project-application.service';
import { ProjectContextService } from '@services/project-context.service';
import type {
  FilterPillOption,
  FormationQueueTiles,
  FormationsQueueFilterState,
  FormationsQueueResponse,
  ProjectApplicationTab,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import {
  createEmptyFormationsQueueResponse,
  FORMATIONS_QUEUE_PAGE_TAB_OPTIONS,
  LF_FOUNDATION_ROOT_SLUG,
  PROJECT_APPLICATION_TABS,
} from '@lfx-one/shared/constants';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, EMPTY, finalize, map, of, switchMap } from 'rxjs';

import { FormationPageTabsComponent } from '../components/formation-page-tabs/formation-page-tabs.component';
import { FormationsTableComponent } from '../components/formations-table/formations-table.component';
import { ProjectApplicationsPanelComponent } from '../components/project-applications-panel/project-applications-panel.component';

/**
 * Foundation-lens Formations queue. #3037 adds a "Project proposals" page tab (`?tab=proposals`) — the
 * formation team's review queue for project applications. Applications have no parent, so the queue is
 * never scoped to a project tree; it is offered only on The Linux Foundation (`tlf`) and only to
 * `team:formation` members. Query-service still filters every document by the caller's access.
 */
@Component({
  selector: 'lfx-formations-queue',
  imports: [FormationPageTabsComponent, FormationsTableComponent, ProjectApplicationsPanelComponent, StatCardGridComponent],
  templateUrl: './formations-queue.component.html',
  styleUrl: './formations-queue.component.scss',
})
export class FormationsQueueComponent {
  private readonly formationService = inject(FormationService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectApplicationService = inject(ProjectApplicationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly pageTabOptions: FilterPillOption[] = FORMATIONS_QUEUE_PAGE_TAB_OPTIONS;
  protected readonly tabs = PROJECT_APPLICATION_TABS;

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly filters = signal<FormationsQueueFilterState>({ subStage: undefined, search: '' });
  // Starts true — this page has nothing meaningful to show before the first fetch resolves; false
  // would flash "No formations yet" for one frame.
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);

  /** `null` until the access check answers. */
  private readonly isFormationTeam: Signal<boolean | null> = toSignal(this.projectApplicationService.getAccess(), { initialValue: null });
  private readonly requestedTab: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('tab'))), { initialValue: null });
  /** The proposals tab exists only on The Linux Foundation, and only for formation-team members. */
  protected readonly showProposalsTab = computed(
    () => this.projectContextService.selectedFoundation()?.slug === LF_FOUNDATION_ROOT_SLUG && this.isFormationTeam() === true
  );
  /** A `?tab=proposals` link the caller can't use falls back to the formations list. */
  protected readonly pageTab: Signal<ProjectApplicationTab> = computed(() =>
    this.showProposalsTab() && this.requestedTab() === PROJECT_APPLICATION_TABS.proposals
      ? PROJECT_APPLICATION_TABS.proposals
      : PROJECT_APPLICATION_TABS.formations
  );

  /**
   * Whether the formations read should run: only on the formations tab, and — for a `?tab=proposals` deep
   * link — only once the access check has answered, so a cold load doesn't fire a read it then discards.
   */
  private readonly formationsReadActive: Signal<boolean> = computed(() => {
    if (this.requestedTab() === PROJECT_APPLICATION_TABS.proposals && this.isFormationTeam() === null) {
      return false;
    }
    return this.pageTab() === PROJECT_APPLICATION_TABS.formations;
  });

  private readonly response: Signal<FormationsQueueResponse> = this.initResponse();
  protected readonly rows = computed(() => this.response().rows);
  /** The server's pre-filter counts, passed through to the table so its pill labels can carry them. */
  protected readonly queueTiles: Signal<FormationQueueTiles> = computed(() => this.response().tiles);
  protected readonly statCards: Signal<StatCardItem[]> = this.initStatCards();
  // GH-2367: reflects the foundation the queue is actually scoped to, so the copy doesn't claim
  // "every foundation" once a `parent` filter has narrowed the rows to one.
  protected readonly subtitle = computed(() => {
    const foundation = this.projectContextService.selectedFoundation();
    return foundation
      ? `${foundation.name}'s formations between Prospect and Active.`
      : 'Every foundation, project, and child project between Prospect and Active.';
  });

  protected onPageTabChange(tab: string): void {
    // Returning to Formations recreates the table with its default pill and search, so reset the filters to
    // match — the same reason as onRetry below.
    if (tab === PROJECT_APPLICATION_TABS.formations) {
      this.filters.set({ subStage: undefined, search: '' });
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === PROJECT_APPLICATION_TABS.proposals ? tab : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onFiltersChange(filters: FormationsQueueFilterState): void {
    this.filters.set(filters);
  }

  protected onRetry(): void {
    // The error state's @else branch (formations-queue.component.html) destroys FormationsTableComponent,
    // which resets its own statusTab/searchForm to defaults — reset filters() to match, or the retried
    // fetch would run with stale filter values the freshly re-created table no longer displays.
    // filters.set() always allocates a fresh object, so it alone re-triggers initResponse()'s
    // combineLatest via the filters branch — an additional refresh$.next() here would double-fire.
    this.filters.set({ subStage: undefined, search: '' });
  }

  private initResponse(): Signal<FormationsQueueResponse> {
    // Unlike foundation-health.component.ts's selectedFoundationSlug$, this deliberately does NOT
    // filter(slug => !!slug): a null/no-foundation selection is a legitimate, must-still-fetch state
    // here (root scope = every formation, today's behavior), not an incomplete-context state to wait
    // out. That does mean a cold load fires one root-scoped fetch before
    // NavigationService.applyDefaultSelection seeds the default foundation, which switchMap then
    // discards — accepted, not fixed here, since skipping it would mean filtering out the same null
    // state this comment just said must still fetch. distinctUntilChanged only dedupes repeated
    // emissions of the *same* foundation (setFoundation's isSameProjectContext gate can still let a
    // re-enriched same-foundation object through) so an unrelated filters() change doesn't also
    // retrigger it as if the foundation had changed.
    const foundationUid$ = toObservable(this.projectContextService.selectedFoundation).pipe(
      map((foundation) => foundation?.uid),
      distinctUntilChanged()
    );
    return toSignal(
      // The formations read is skipped while the Project proposals tab is showing (#3037) — nothing renders it.
      combineLatest([this.refresh$, toObservable(this.filters), foundationUid$, toObservable(this.formationsReadActive).pipe(distinctUntilChanged())]).pipe(
        switchMap(([, filters, foundationUid, readActive]) => {
          if (!readActive) {
            return EMPTY;
          }
          this.loadFailed.set(false);
          this.loading.set(true);
          return this.formationService.getFormationsQueue(filters.subStage, filters.search, foundationUid).pipe(
            catchError((error: unknown) => {
              console.error('[FormationsQueue] Failed to load Formations queue', error);
              this.loadFailed.set(true);
              return of(createEmptyFormationsQueueResponse());
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: createEmptyFormationsQueueResponse() }
    );
  }

  /**
   * The four health tiles — how big the pipeline is, what is ready, what is stuck, what is parked.
   * Every value is a server count over the same unfiltered set (`buildQueueTilesFromRows`), so the
   * strip holds still while a stage pill or search narrows the rows below it. The per-stage
   * Exploratory/Engaged counts live on the pills instead, where the stage filter already is.
   */
  private initStatCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const t = this.queueTiles();
      return [
        {
          value: t.total,
          label: 'In formation',
          // GH-2584 dropped the `unmapped` clause that used to append here. It read "N outside
          // formation stages", which stopped being true once the queue began listing only
          // formations still in progress — every row is inside formation now, and an unmapped row
          // means only that its sub-stage has no tile to sit in.
          //
          // `tiles.unmapped` is still on the response but nothing reads it; the same gap is what
          // the BFF logs at DEBUG, and that log — not this tile — is the detector for a new
          // upstream sub-stage.
          subLine: `${t.foundations} ${t.foundations === 1 ? 'foundation' : 'foundations'} · ${t.projects} ${t.projects === 1 ? 'project' : 'projects'}`,
          icon: 'fa-light fa-diagram-project',
          iconContainerClass: 'bg-blue-50 text-blue-600',
        },
        {
          value: t.ready,
          label: 'Ready to activate',
          subLine: 'All gating items done',
          icon: 'fa-light fa-flag-checkered',
          iconContainerClass: 'bg-emerald-50 text-emerald-600',
        },
        {
          value: t.blocked,
          label: 'Blocked',
          subLine: `${t.blocked_items} blocked ${t.blocked_items === 1 ? 'item' : 'items'}`,
          icon: 'fa-light fa-hand',
          iconContainerClass: 'bg-red-50 text-red-600',
        },
        {
          value: t.on_hold,
          label: 'On hold',
          // Where the stage is changed — the sidebar card says the same of stage and legal entity.
          subLine: 'Paused in the admin tool',
          icon: 'fa-light fa-pause',
          iconContainerClass: 'bg-amber-50 text-amber-600',
        },
      ];
    });
  }
}
