// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SlicePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_BUDGET_DEFAULTS,
  CAMPAIGN_CHAR_LIMITS,
  CAMPAIGN_JOB_POLL_INTERVAL_MS,
  LINKEDIN_AD_ACCOUNTS,
  LINKEDIN_CHAR_LIMITS,
  LINKEDIN_DEFAULT_ACCOUNT_ID,
  LINKEDIN_GEO_RESOLVE_MAP,
} from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { map, startWith, Subscription, take } from 'rxjs';

import type { Signal } from '@angular/core';
import type {
  CampaignBriefOutput,
  CampaignCreateResponse,
  CampaignCreateResult,
  CampaignKeyword,
  CampaignPlatform,
  CampaignType,
  LinkedInAdAccount,
  LinkedInCreativeVariant,
  LinkedInGeoTarget,
  LinkedInTargetingProfile,
} from '@lfx-one/shared/interfaces';

type ImplementationStep = 'form' | 'creating' | 'results';

@Component({
  selector: 'lfx-implementation-tab',
  imports: [ReactiveFormsModule, ButtonComponent, SlicePipe],
  templateUrl: './implementation-tab.component.html',
  styleUrl: './implementation-tab.component.scss',
})
export class ImplementationTabComponent {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly briefData = input<CampaignBriefOutput | null>(null);

  // === Constants ===
  protected readonly charLimits = CAMPAIGN_CHAR_LIMITS;
  protected readonly linkedInCharLimits = LINKEDIN_CHAR_LIMITS;
  protected readonly linkedInAccounts: readonly LinkedInAdAccount[] = LINKEDIN_AD_ACCOUNTS;
  protected readonly allKnownGeos: LinkedInGeoTarget[] = [...new Map(Object.values(LINKEDIN_GEO_RESOLVE_MAP).map((g) => [g.urn, g])).values()];
  protected readonly todayDate = new Date().toISOString().split('T')[0];
  protected readonly defaultEndDate = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

  // === Forms ===
  protected readonly campaignForm = this.fb.nonNullable.group({
    eventName: ['', [Validators.required]],
    eventSlug: [''],
    countryCode: ['US'],
    registrationUrl: ['', [Validators.required]],
    budgetUsd: [500, [Validators.required, Validators.min(1)]],
    searchBudgetPct: [CAMPAIGN_BUDGET_DEFAULTS.searchBudgetPct],
    startDate: ['', [Validators.required]],
    endDate: ['', [Validators.required]],
    includeSearch: [true],
    includeDemandGen: [true],
    headlines: this.fb.array([this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)])]),
    descriptions: this.fb.array([this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)])]),
  });

  // === WritableSignals ===
  protected readonly step = signal<ImplementationStep>('form');
  protected readonly creationProgress = signal<string[]>([]);
  protected readonly results = signal<CampaignCreateResult[]>([]);
  protected readonly errors = signal<string[]>([]);
  protected readonly briefKeywords = signal<CampaignKeyword[]>([]);
  protected readonly briefHsToken = signal<string | null>(null);
  protected readonly briefDriveFolderUrl = signal('');
  protected readonly selectedPlatforms = signal<CampaignPlatform[]>(['google-ads']);
  protected readonly linkedInGeoTargets = signal<LinkedInGeoTarget[]>([]);
  protected readonly linkedInTargetingProfile = signal<LinkedInTargetingProfile>('cloud-native');
  protected readonly linkedInVariants = signal<LinkedInCreativeVariant[]>([]);
  protected readonly linkedInBudgetUsd = signal(500);
  protected readonly linkedInLifetimeBudget = signal(false);
  protected readonly linkedInAccountId = signal<string>(LINKEDIN_DEFAULT_ACCOUNT_ID);

  // === Computed Signals ===
  protected readonly showGoogleSection = computed(() => this.selectedPlatforms().includes('google-ads'));
  protected readonly showLinkedInSection = computed(() => this.selectedPlatforms().includes('linkedin-ads'));
  protected readonly selectedLinkedInAccount = computed(
    () => this.linkedInAccounts.find((a) => a.accountId === this.linkedInAccountId()) ?? this.linkedInAccounts[0]
  );

  protected readonly canSubmit = computed(() => {
    const platforms = this.selectedPlatforms();
    const googleSelected = platforms.includes('google-ads');
    const linkedInSelected = platforms.includes('linkedin-ads');
    if (!googleSelected && !linkedInSelected) return false;

    const form = this.campaignForm.controls;
    const sharedFieldsValid = !!form.eventName.value?.trim() && !!form.registrationUrl.value?.trim() && !!form.startDate.value && !!form.endDate.value;
    if (!sharedFieldsValid) return false;

    if (googleSelected && this.campaignForm.invalid) return false;
    if (googleSelected && !this.campaignForm.controls.includeSearch.value && !this.campaignForm.controls.includeDemandGen.value) return false;
    if (linkedInSelected && this.linkedInBudgetUsd() < 1) return false;
    if (linkedInSelected && this.linkedInGeoTargets().length === 0) return false;
    if (linkedInSelected && this.linkedInVariants().length === 0) return false;
    return true;
  });

  protected readonly availableGeoTargets = computed(() => {
    const selected = new Set(this.linkedInGeoTargets().map((g) => g.urn));
    return this.allKnownGeos.filter((g) => !selected.has(g.urn));
  });

  // === Reactive Signals (from form valueChanges) ===
  protected readonly displayBudgetPct: Signal<number> = this.initDisplayBudgetPct();
  protected readonly campaignName: Signal<string> = this.initCampaignName();

  // === Form Array Accessors ===
  protected get headlinesArray(): FormArray {
    return this.campaignForm.controls.headlines as FormArray;
  }

  protected get descriptionsArray(): FormArray {
    return this.campaignForm.controls.descriptions as FormArray;
  }

  // === Private State ===
  private jobSubscription: Subscription | null = null;

  // === Lifecycle ===
  public constructor() {
    effect(() => {
      const brief = this.briefData();
      if (!brief) return;
      this.populateFromBrief(brief);
    });
  }

  // === Protected Methods ===
  protected addHeadline(): void {
    (this.campaignForm.controls.headlines as FormArray).push(
      this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)])
    );
  }

  protected removeHeadline(index: number): void {
    const arr = this.campaignForm.controls.headlines as FormArray;
    if (arr.length > 1) arr.removeAt(index);
  }

  protected addDescription(): void {
    (this.campaignForm.controls.descriptions as FormArray).push(
      this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)])
    );
  }

  protected removeDescription(index: number): void {
    const arr = this.campaignForm.controls.descriptions as FormArray;
    if (arr.length > 1) arr.removeAt(index);
  }

  protected removeGeoTarget(index: number): void {
    this.linkedInGeoTargets.update((targets) => targets.filter((_, i) => i !== index));
  }

  protected addGeoTarget(urn: string): void {
    if (!urn) return;
    const geo = this.allKnownGeos.find((g) => g.urn === urn);
    if (geo && !this.linkedInGeoTargets().some((g) => g.urn === urn)) {
      this.linkedInGeoTargets.update((targets) => [...targets, geo]);
    }
  }

  protected setLinkedInTargetingProfile(profile: LinkedInTargetingProfile): void {
    this.linkedInTargetingProfile.set(profile);
  }

  protected setLinkedInLifetimeBudget(value: boolean): void {
    this.linkedInLifetimeBudget.set(value);
  }

  protected setLinkedInBudget(value: number): void {
    this.linkedInBudgetUsd.set(value);
  }

  protected setLinkedInAccount(accountId: string): void {
    this.linkedInAccountId.set(accountId);
  }

  protected onLinkedInAccountChange(event: Event): void {
    this.linkedInAccountId.set((event.target as HTMLSelectElement).value);
  }

  protected onGeoTargetChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.addGeoTarget(select.value);
    select.value = '';
  }

  protected onLinkedInBudgetInput(event: Event): void {
    this.linkedInBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
  }

  protected onLinkedInLifetimeBudgetChange(event: Event): void {
    this.linkedInLifetimeBudget.set((event.target as HTMLInputElement).checked);
  }


  protected submit(): void {
    const platforms = this.selectedPlatforms();
    const googleSelected = platforms.includes('google-ads');
    const linkedInSelected = platforms.includes('linkedin-ads');

    if (!googleSelected && !linkedInSelected) return;

    const controls = this.campaignForm.controls;
    const sharedFieldsValid =
      !!controls.eventName.value?.trim() && !!controls.registrationUrl.value?.trim() && !!controls.startDate.value && !!controls.endDate.value;
    if (!sharedFieldsValid) return;

    if (googleSelected && this.campaignForm.invalid) return;
    if (googleSelected && !controls.includeSearch.value && !controls.includeDemandGen.value) return;
    if (linkedInSelected && this.linkedInBudgetUsd() < 1) return;
    if (linkedInSelected && this.linkedInGeoTargets().length === 0) return;
    if (linkedInSelected && this.linkedInVariants().length === 0) return;

    this.step.set('creating');
    this.creationProgress.set(['Submitting campaign...']);
    this.results.set([]);
    this.errors.set([]);

    const form = this.campaignForm.getRawValue();
    const campaignTypes: CampaignType[] = [];
    if (form.includeSearch) campaignTypes.push('search');
    if (form.includeDemandGen) campaignTypes.push('demand-gen');
    const slug = form.eventSlug || form.eventName.toLowerCase().replace(/\s+/g, '-');

    const request = {
      eventName: form.eventName,
      eventSlug: slug,
      countryCode: form.countryCode,
      registrationUrl: form.registrationUrl,
      hsToken: this.briefHsToken() ?? undefined,
      campaignTypes,
      budgetUsd: form.budgetUsd,
      searchBudgetPct: form.searchBudgetPct,
      startDate: form.startDate,
      endDate: form.endDate,
      keywords: this.briefKeywords(),
      headlines: (form.headlines as string[]).filter((h) => h.trim()),
      descriptions: (form.descriptions as string[]).filter((d) => d.trim()),
      geoTargets: [form.countryCode],
      driveFolderUrl: this.briefDriveFolderUrl() || undefined,
      platforms,
      ...(platforms.includes('linkedin-ads')
        ? {
            linkedInConfig: {
              eventName: form.eventName,
              eventSlug: slug,
              dates: `${form.startDate} - ${form.endDate}`,
              registrationUrl: form.registrationUrl,
              hsToken: this.briefHsToken() ?? undefined,
              budgetUsd: this.linkedInBudgetUsd(),
              lifetimeBudget: this.linkedInLifetimeBudget(),
              startDate: form.startDate,
              endDate: form.endDate,
              geoTargets: this.linkedInGeoTargets(),
              targetingProfile: this.linkedInTargetingProfile(),
              variants: this.linkedInVariants(),
              adAccountId: this.linkedInAccountId(),
            },
          }
        : {}),
    };

    this.campaignService.createCampaign(request).subscribe({
      next: (response) => {
        if (response.result) {
          this.results.set(response.result.campaigns);
          this.errors.set(response.result.errors);
          this.step.set('results');
          return;
        }
        if (response.error) {
          this.errors.set([response.error]);
          this.step.set('results');
          return;
        }
        if (!response.jobId) {
          this.errors.set(['Campaign creation could not be started. The ad platform integration may not be configured. Please contact your administrator.']);
          this.step.set('form');
          return;
        }
        this.creationProgress.update((msgs) => [...msgs, `Job started: ${response.jobId}`]);
        this.pollJob(response.jobId);
      },
      error: () => {
        this.errors.set(['Unable to reach the campaign service. Please check your connection and try again.']);
        this.step.set('form');
      },
    });
  }

  protected reset(): void {
    this.jobSubscription?.unsubscribe();
    this.jobSubscription = null;
    this.step.set('form');
    this.creationProgress.set([]);
    this.results.set([]);
    this.errors.set([]);
  }

  // === Private Methods ===
  private populateFromBrief(brief: CampaignBriefOutput): void {
    const details = brief.eventDetails;
    this.campaignForm.patchValue({
      eventName: details.name,
      eventSlug: details.slug,
      countryCode: details.countryCode || 'US',
      registrationUrl: details.registrationUrl,
      budgetUsd: brief.totalBudget ?? 500,
      startDate: this.todayDate,
      endDate: this.defaultEndDate,
    });

    if (brief.selectedPlatforms?.length) {
      this.selectedPlatforms.set(brief.selectedPlatforms);
    }

    const searchCopy = brief.structuredCopy?.['google_search'] as Record<string, unknown> | undefined;
    if (searchCopy) {
      const headlines = (searchCopy['headlines'] as string[]) ?? [];
      const descriptions = (searchCopy['descriptions'] as string[]) ?? [];

      const headlinesArr = this.campaignForm.controls.headlines as FormArray;
      headlinesArr.clear();
      for (const h of headlines) {
        headlinesArr.push(this.fb.control(h, [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)]));
      }

      const descriptionsArr = this.campaignForm.controls.descriptions as FormArray;
      descriptionsArr.clear();
      for (const d of descriptions) {
        descriptionsArr.push(this.fb.control(d, [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)]));
      }
    }

    if (brief.linkedInCopy) {
      this.linkedInVariants.set(brief.linkedInCopy.variants);
      this.linkedInGeoTargets.set(brief.linkedInCopy.recommendedGeoTargets);
      this.linkedInTargetingProfile.set(brief.linkedInCopy.recommendedTargetingProfile);
      if (brief.linkedInCopy.strategy) {
        this.linkedInBudgetUsd.set(brief.linkedInCopy.strategy.budgetRecommendation.lifetimeBudgetUsd);
        this.linkedInLifetimeBudget.set(true);
      }
    }

    this.briefKeywords.set(brief.keywords);
    this.briefHsToken.set(brief.hsUtm);
    this.briefDriveFolderUrl.set(brief.driveFolderUrl);
  }

  private pollJob(jobId: string): void {
    const MAX_POLL_DURATION_MS = 300_000;
    const MAX_POLLS = Math.ceil(MAX_POLL_DURATION_MS / CAMPAIGN_JOB_POLL_INTERVAL_MS);
    this.jobSubscription = this.campaignService
      .getCreateResult(jobId)
      .pipe(take(MAX_POLLS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: CampaignCreateResponse | null) => {
          if (result) {
            this.results.set(result.campaigns);
            this.errors.set(result.errors);
            this.step.set('results');
          }
        },
        error: (error: unknown) => {
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'Lost connection to the campaign creation process. Please try again or check your ad platforms directly.';
          this.errors.set([message]);
          this.step.set('results');
        },
        complete: () => {
          if (this.step() === 'creating') {
            this.errors.set(['Campaign creation is taking longer than expected. Check your ad platforms to see if campaigns were created.']);
            this.step.set('results');
          }
        },
      });
  }

  // === Private Initializers ===
  private initDisplayBudgetPct(): Signal<number> {
    return toSignal(
      this.campaignForm.controls.searchBudgetPct.valueChanges.pipe(
        startWith(this.campaignForm.controls.searchBudgetPct.value),
        map((v) => 100 - v)
      ),
      { initialValue: 100 - CAMPAIGN_BUDGET_DEFAULTS.searchBudgetPct }
    );
  }

  private initCampaignName(): Signal<string> {
    return toSignal(
      this.campaignForm.valueChanges.pipe(
        startWith(this.campaignForm.getRawValue()),
        map((form) => {
          const name = form.eventName;
          const region = form.countryCode || 'NA';
          const startDate = form.startDate || '';
          const includeSearch = form.includeSearch;
          const includeDemandGen = form.includeDemandGen;
          let channel = 'Search';
          if (includeSearch && includeDemandGen) channel = 'Multi';
          else if (includeDemandGen) channel = 'DG Display';
          return name ? `Events | ${name} | ${region} | Conversions | Prospecting | ${channel} | Linux Foundation | BoFU | ${startDate}` : '';
        })
      ),
      { initialValue: '' }
    );
  }
}
