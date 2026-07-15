// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { SelectComponent } from '@components/select/select.component';
import { FOCUS_VISIBLE_TABS, MARKETING_IMPACT_FOCUS_OPTIONS, MARKETING_IMPACT_TABS } from '@lfx-one/shared/constants';
import { buildMarketingImpactPeriodOptions, getDefaultMarketingImpactPeriod } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, map, Observable, of, startWith, switchMap } from 'rxjs';

import type {
  FilterPillOption,
  MarketingImpactFocusProgram,
  MarketingImpactPeriodOption,
  MarketingImpactTab,
  MarketingImpactTabOption,
} from '@lfx-one/shared/interfaces';

import { AttributionSectionComponent } from './components/attribution-section/attribution-section.component';
import { EmailTabComponent } from './components/email-tab/email-tab.component';
import { OverviewTabComponent } from './components/overview-tab/overview-tab.component';
import { PerformanceMarketingTabComponent } from './components/performance-marketing-tab/performance-marketing-tab.component';
import { SocialAccountsTabComponent } from './components/social-accounts-tab/social-accounts-tab.component';
import { SocialListeningTabComponent } from './components/social-listening-tab/social-listening-tab.component';
import { WebActivityTabComponent } from './components/web-activity-tab/web-activity-tab.component';

@Component({
  selector: 'lfx-marketing-impact',
  imports: [
    ReactiveFormsModule,
    SelectComponent,
    ButtonComponent,
    FilterPillsComponent,
    OverviewTabComponent,
    AttributionSectionComponent,
    PerformanceMarketingTabComponent,
    EmailTabComponent,
    WebActivityTabComponent,
    SocialAccountsTabComponent,
    SocialListeningTabComponent,
  ],
  templateUrl: './marketing-impact.component.html',
  styleUrl: './marketing-impact.component.scss',
})
export class MarketingImpactComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly defaultPeriod = getDefaultMarketingImpactPeriod();

  // === Forms ===
  protected readonly headerForm = this.fb.nonNullable.group({
    period: [this.defaultPeriod],
  });

  protected readonly periodOptions: MarketingImpactPeriodOption[] = buildMarketingImpactPeriodOptions();
  protected readonly focusOptions: FilterPillOption[] = MARKETING_IMPACT_FOCUS_OPTIONS;
  protected readonly tabs: MarketingImpactTabOption[] = MARKETING_IMPACT_TABS;

  // === WritableSignals ===
  protected readonly selectedFocus = signal<MarketingImpactFocusProgram>('all');
  protected readonly selectedTab = signal<MarketingImpactTab>('overview');

  // === Computed Signals ===
  protected readonly hasFoundation = computed(() => !!this.projectContextService.selectedFoundation());
  protected readonly foundationName = computed(() => this.projectContextService.selectedFoundation()?.name ?? '');
  protected readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug);
  protected readonly selectedPeriod: Signal<string> = this.initSelectedPeriod();
  protected readonly contextLabel: Signal<string> = this.initContextLabel();
  protected readonly visibleTabs: Signal<MarketingImpactTabOption[]> = this.initVisibleTabs();

  /**
   * marketing_auditor access for the currently selected foundation. Gates the tab content so the
   * analytics child tabs never mount (and never fire requests) for a context the user can't audit —
   * the marketing APIs are not yet server-enforced, so this is the fail-closed front stop.
   * `startWith(false)` resets it on every switch: the tabs unmount immediately, then re-render only
   * once the probe returns true. Keyed off `selectedFoundation` (seeded from `?project=` by
   * projectQueryParamGuard, matching the guard's slug source) rather than the lens-dependent
   * `activeContext`, which trails the lens on cold deep links.
   */
  protected readonly authorized: Signal<boolean> = toSignal(this.initAuthorized(), { initialValue: false });

  public constructor() {
    // marketingViewGuard only runs on navigation, but an in-place context switch (setFoundation uses
    // Location.replaceState — no navigation) doesn't re-run it. Redirect (fail closed) when the newly
    // selected foundation resolves without marketing_auditor. This subscription uses resolved probe
    // values (no startWith), so the transient "resolving" state never triggers a spurious redirect;
    // the entry foundation was authorized by the guard so its probe is true.
    toObservable(this.projectContextService.selectedFoundation)
      .pipe(
        switchMap((foundation) => this.probeMarketingAuditor(foundation?.slug)),
        takeUntilDestroyed()
      )
      .subscribe((allowed) => {
        if (!allowed) {
          const slug = this.projectContextService.selectedFoundation()?.slug;
          this.router.navigate(['/foundation/overview'], slug ? { queryParams: { project: slug } } : {});
        }
      });
  }

  // === Protected Methods ===
  protected onFocusChange(focusId: string): void {
    if (this.focusOptions.some((o) => o.id === focusId)) {
      const focus = focusId as MarketingImpactFocusProgram;
      this.selectedFocus.set(focus);

      const allowed = FOCUS_VISIBLE_TABS[focus];
      if (!allowed.has(this.selectedTab())) {
        this.selectedTab.set(this.tabs.find((t) => allowed.has(t.id))?.id ?? 'overview');
      }
    }
  }

  protected onTabChange(tabId: MarketingImpactTab): void {
    this.selectedTab.set(tabId);
  }

  // === Private Initializers ===
  private initSelectedPeriod(): Signal<string> {
    return toSignal(this.headerForm.controls.period.valueChanges.pipe(startWith(this.defaultPeriod)), {
      initialValue: this.defaultPeriod,
    });
  }

  private initVisibleTabs(): Signal<MarketingImpactTabOption[]> {
    return computed(() => {
      const allowed = FOCUS_VISIBLE_TABS[this.selectedFocus()];
      return this.tabs.filter((t) => allowed.has(t.id));
    });
  }

  private initAuthorized(): Observable<boolean> {
    return toObservable(this.projectContextService.selectedFoundation).pipe(
      switchMap((foundation) => this.probeMarketingAuditor(foundation?.slug).pipe(startWith(false)))
    );
  }

  private probeMarketingAuditor(slug: string | undefined): Observable<boolean> {
    if (!slug) {
      return of(false);
    }
    return this.projectService.getProject(slug, false, { marketing: true }).pipe(
      map((project) => project?.marketingAuditor === true),
      catchError(() => of(false))
    );
  }

  private initContextLabel(): Signal<string> {
    return computed(() => {
      const name = this.foundationName();
      const periodValue = this.selectedPeriod();
      const option = this.periodOptions.find((o) => o.value === periodValue);
      const periodLabel = option?.label ?? '';
      if (!name || !periodLabel) return '';
      return `Cross-channel performance for ${name} · ${periodLabel}`;
    });
  }
}
