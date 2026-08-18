// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, ElementRef, inject, input, model, output, Signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { buildMarketingImpactPeriodOptions } from '@lfx-one/shared/utils';

import type { FilterPillOption, MarketingImpactPeriodOption, SocialListeningOption, SocialListeningTab } from '@lfx-one/shared/interfaces';

/** Feed/Analytics tab pills for the header's `lfx-card-tabs-bar`. */
const SOCIAL_LISTENING_TAB_OPTIONS: FilterPillOption[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'analytics', label: 'Analytics' },
];

/**
 * Social Listening feed header (LFXV2-3016/17/18): tabs, scope selects, search, Filters button, and
 * the analytics export trigger. State lives in the page; `headerForm` bridges the form-bound wrappers.
 */
@Component({
  selector: 'lfx-feed-header',
  imports: [ReactiveFormsModule, ButtonComponent, CardTabsBarComponent, SelectComponent, InputTextComponent],
  templateUrl: './feed-header.component.html',
  styleUrl: './feed-header.component.scss',
})
export class FeedHeaderComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  public readonly activeTab = model.required<SocialListeningTab>();
  public readonly selectedPeriod = model.required<string>();
  public readonly selectedProject = model.required<string>();
  public readonly selectedPlatform = model.required<string>();
  public readonly searchInput = model.required<string>();

  public readonly projectOptions = input.required<SocialListeningOption[]>();
  public readonly platformOptions = input.required<SocialListeningOption[]>();
  public readonly optionsLoading = input(false);

  // === Filters panel trigger (LFXV2-3017) ===
  public readonly filtersVisible = model(false);
  public readonly activeFilterCount = input(0);
  public readonly filtersPrefetch = output<void>();

  // === Analytics export (LFXV2-3018) — button renders on the Analytics tab only ===
  public readonly exporting = input(false);
  /** Disabled beyond the in-flight export (e.g. while analytics panels still load). */
  public readonly exportDisabled = input(false);
  public readonly exportAnalytics = output<void>();

  // Neutral defaults — the model→form bridges below populate the real values at construction
  // (required models can't be read in field initializers).
  protected readonly headerForm = this.fb.nonNullable.group({
    period: [''],
    sourceProject: ['all'],
    platform: ['all'],
    search: [''],
  });

  protected readonly tabOptions = SOCIAL_LISTENING_TAB_OPTIONS;
  /** Resolved per component instance (matches marketing-impact): the month list depends on "now". */
  protected readonly periodOptions: MarketingImpactPeriodOption[] = buildMarketingImpactPeriodOptions();

  private readonly filtersTrigger = viewChild<unknown, ElementRef<HTMLElement>>('filtersTrigger', { read: ElementRef });

  /** Tracks the open→close transition so focus is only restored after the panel actually closed. */
  private filtersOpened = false;

  protected readonly isAnalyticsTab = computed(() => this.activeTab() === 'analytics');
  /** PCC behavior: a foundation with exactly one sub-project shows a static badge, not a select. */
  protected readonly hasSingleProject = computed(() => this.projectOptions().length === 2);
  protected readonly singleProjectName = computed(() => this.projectOptions()[1]?.label ?? '');

  public constructor() {
    // External state (query-param decode, reset effects) pushes into the form; emitEvent: false
    // so the valueChanges bridges below don't echo it back and loop.
    const controls = this.headerForm.controls;
    this.bindModelToControl(this.selectedPeriod, controls.period);
    this.bindModelToControl(this.selectedProject, controls.sourceProject);
    this.bindModelToControl(this.selectedPlatform, controls.platform);
    this.bindModelToControl(this.searchInput, controls.search);

    this.headerForm.controls.period.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedPeriod.set(value));
    this.headerForm.controls.sourceProject.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedProject.set(value));
    this.headerForm.controls.platform.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedPlatform.set(value));
    this.headerForm.controls.search.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.searchInput.set(value));

    this.restoreFocusOnFiltersClose();
  }

  protected onTabChange(tabId: string): void {
    if (tabId === 'feed' || tabId === 'analytics') {
      this.activeTab.set(tabId);
    }
  }

  protected toggleFilters(): void {
    this.filtersVisible.update((visible) => !visible);
  }

  /** Dialog contract: closing the panel (Escape, backdrop, toggle) must hand focus back to its trigger. */
  private restoreFocusOnFiltersClose(): void {
    effect(() => {
      if (this.filtersVisible()) {
        this.filtersOpened = true;
        return;
      }

      if (!this.filtersOpened) {
        return;
      }

      this.filtersOpened = false;
      untracked(() => this.filtersTrigger()?.nativeElement.querySelector('button')?.focus());
    });
  }

  /** Pushes signal state into the form — a non-reactive sink, which is what `effect()` is for. */
  private bindModelToControl(source: Signal<string>, control: FormControl<string>): void {
    effect(() => control.setValue(source(), { emitEvent: false }));
  }
}
