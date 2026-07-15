// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, map, of, switchMap } from 'rxjs';

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
  private readonly router = inject(Router);

  protected readonly tabs = CAMPAIGN_TABS;
  protected readonly programTypes = CAMPAIGN_PROGRAM_TYPES;
  protected readonly selectedTab = signal<CampaignTab>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);

  protected readonly activeProgramTypeConfig = computed(() => this.programTypes.find((pt) => pt.id === this.selectedProgramType()) ?? this.programTypes[0]);

  public constructor() {
    // campaignAccessGuard only runs on navigation. An in-place context switch (setFoundation uses
    // Location.replaceState — no navigation) would otherwise leave this managed surface mounted for
    // a project the user can't manage, and its child tabs would fetch data for that context.
    // Re-probe campaign_manager on every foundation change and redirect (fail closed) when access
    // is lost. Key off `selectedFoundation` — not the lens-dependent `activeContext` — to match the
    // guard's slug source: projectQueryParamGuard seeds the foundation from `?project=` before this
    // page mounts, whereas `activeContext` still trails the lens on a cold deep-link (would give a
    // null/project slug and redirect a legitimately-authorized user). The entry foundation was
    // already authorized by the guard, so its probe resolves true; the getProject cache is shared.
    toObservable(this.projectContextService.selectedFoundation)
      .pipe(
        switchMap((foundation) =>
          foundation?.slug
            ? this.projectService.getProject(foundation.slug, false, { marketing: true }).pipe(
                map((project) => project?.campaignManager === true),
                catchError(() => of(false))
              )
            : of(false)
        ),
        takeUntilDestroyed()
      )
      .subscribe((allowed) => {
        if (!allowed) {
          const slug = this.projectContextService.selectedFoundation()?.slug;
          this.router.navigate(['/foundation/overview'], slug ? { queryParams: { project: slug } } : {});
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
}
