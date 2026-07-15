// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, combineLatest, EMPTY, map, Observable, of, startWith, switchMap } from 'rxjs';

import { CAMPAIGN_PROGRAM_TYPES, CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignProgramType, CampaignTab } from '@lfx-one/shared/interfaces';

import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { MonitoringTabComponent } from './components/monitoring-tab/monitoring-tab.component';
import { OptimizationTabComponent } from './components/optimization-tab/optimization-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

@Component({
  selector: 'lfx-campaigns',
  imports: [PlanningTabComponent, ImplementationTabComponent, MonitoringTabComponent, OptimizationTabComponent],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.scss',
})
export class CampaignsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly tabs = CAMPAIGN_TABS;
  protected readonly programTypes = CAMPAIGN_PROGRAM_TYPES;
  protected readonly selectedTab = signal<CampaignTab>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);

  protected readonly activeProgramTypeConfig = computed(() => this.programTypes.find((pt) => pt.id === this.selectedProgramType()) ?? this.programTypes[0]);

  /**
   * campaign_manager access for the currently selected foundation. Gates the template so the
   * management panels never render (and their child tabs never fire requests) for a context the
   * user can't manage — the marketing APIs are not yet server-enforced, so this is the fail-closed
   * front stop. `startWith(false)` resets it on every switch: the panels unmount immediately, then
   * re-render only once the probe returns true. Keyed off `selectedFoundation` (seeded from
   * `?project=` by projectQueryParamGuard, matching the guard's slug source) rather than the
   * lens-dependent `activeContext`, which trails the lens on cold deep links.
   */
  protected readonly authorized: Signal<boolean> = toSignal(this.initAuthorized(), { initialValue: false });

  public constructor() {
    // campaignAccessGuard only runs on navigation, but an in-place context switch (setFoundation
    // uses Location.replaceState — no navigation) doesn't re-run it. Redirect (fail closed) when
    // the newly selected foundation resolves without campaign_manager. Slug prefers
    // selectedFoundation, then `?project=` (same as the guard) so a deep link is not denied while
    // projectQueryParamGuard is still seeding context. No slug yet → wait (EMPTY), never treat
    // "pending seed" as denial.
    combineLatest([toObservable(this.projectContextService.selectedFoundation), this.route.queryParamMap])
      .pipe(
        switchMap(([foundation, params]) => {
          const slug = foundation?.slug ?? params.get('project') ?? undefined;
          if (!slug) {
            return EMPTY;
          }
          return this.probeCampaignManager(slug).pipe(map((allowed) => ({ allowed, slug })));
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ allowed, slug }) => {
        if (!allowed) {
          this.router.navigate(['/foundation/overview'], { queryParams: { project: slug } });
        }
      });
  }

  protected selectTab(tab: CampaignTab): void {
    this.selectedTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let newIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % this.tabs.length;
    } else if (event.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      newIndex = 0;
    } else if (event.key === 'End') {
      newIndex = this.tabs.length - 1;
    }

    if (newIndex !== null) {
      event.preventDefault();
      this.selectTab(this.tabs[newIndex].id);
      if (isPlatformBrowser(this.platformId)) {
        const target = (event.target as HTMLElement).parentElement?.children[newIndex] as HTMLElement | undefined;
        target?.focus();
      }
    }
  }

  protected onProgramTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (this.programTypes.some((pt) => pt.id === value)) {
      this.selectedProgramType.set(value as CampaignProgramType);
      this.briefOutput.set(null);
      this.selectedTab.set('planning');
    }
  }

  protected onProceedToImplementation(brief: CampaignBriefOutput): void {
    this.briefOutput.set(brief);
    this.selectedTab.set('implementation');
  }

  private initAuthorized(): Observable<boolean> {
    return combineLatest([toObservable(this.projectContextService.selectedFoundation), this.route.queryParamMap]).pipe(
      switchMap(([foundation, params]) => {
        const slug = foundation?.slug ?? params.get('project') ?? undefined;
        return this.probeCampaignManager(slug).pipe(startWith(false));
      })
    );
  }

  private probeCampaignManager(slug: string | undefined): Observable<boolean> {
    if (!slug) {
      return of(false);
    }
    return this.projectService.getProject(slug, false, { marketing: true }).pipe(
      map((project) => project?.campaignManager === true),
      catchError(() => of(false))
    );
  }
}
