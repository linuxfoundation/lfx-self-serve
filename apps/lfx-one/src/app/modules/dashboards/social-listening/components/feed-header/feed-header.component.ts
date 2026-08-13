// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, model } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
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
 * Social Listening feed header (LFXV2-3016): Feed/Analytics tabs on the left (via
 * `lfx-card-tabs-bar`), sub-project / platform / period selects and the search input on the
 * right. The Filters button + badge are intentionally absent — LFXV2-3017 adds them.
 *
 * State lives in the page container and round-trips through query params; this component only
 * two-way-binds it via `model()`. The `lfx-select` / `lfx-input-text` wrappers are form-bound,
 * so an internal `headerForm` bridges the two (form → model via `valueChanges`; model → form
 * via `setValue(..., { emitEvent: false })`, which cannot loop).
 */
@Component({
  selector: 'lfx-feed-header',
  imports: [ReactiveFormsModule, CardTabsBarComponent, SelectComponent, InputTextComponent],
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

  public readonly projectOptions = model.required<SocialListeningOption[]>();
  public readonly platformOptions = model.required<SocialListeningOption[]>();
  public readonly optionsLoading = model<boolean>(false);

  // Neutral defaults — the model→form effects below populate the real values at construction
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

  protected readonly isAnalyticsTab = computed(() => this.activeTab() === 'analytics');
  /** PCC behavior: a foundation with exactly one sub-project shows a static badge, not a select. */
  protected readonly hasSingleProject = computed(() => this.projectOptions().length === 2);
  protected readonly singleProjectName = computed(() => this.projectOptions()[1]?.label ?? '');

  public constructor() {
    // External state (query-param decode, reset effects) pushes into the form; emitEvent: false
    // so the valueChanges bridges below don't echo it back and loop.
    effect(() => this.headerForm.controls.period.setValue(this.selectedPeriod(), { emitEvent: false }));
    effect(() => this.headerForm.controls.sourceProject.setValue(this.selectedProject(), { emitEvent: false }));
    effect(() => this.headerForm.controls.platform.setValue(this.selectedPlatform(), { emitEvent: false }));
    effect(() => this.headerForm.controls.search.setValue(this.searchInput(), { emitEvent: false }));

    // A foundation with a single sub-project locks the select to it (ported from PCC).
    effect(() => {
      const options = this.projectOptions();
      if (options.length === 2) {
        this.selectedProject.set(options[1].value);
      }
    });

    this.headerForm.controls.period.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedPeriod.set(value));
    this.headerForm.controls.sourceProject.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedProject.set(value));
    this.headerForm.controls.platform.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedPlatform.set(value));
    this.headerForm.controls.search.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.searchInput.set(value));
  }

  protected onTabChange(tabId: string): void {
    if (tabId === 'feed' || tabId === 'analytics') {
      this.activeTab.set(tabId);
    }
  }
}
