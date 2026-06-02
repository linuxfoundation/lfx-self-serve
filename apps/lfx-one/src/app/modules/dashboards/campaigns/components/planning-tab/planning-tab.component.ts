// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CAMPAIGN_GOALS, CAMPAIGN_PLATFORMS } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { debounceTime, Subject, Subscription } from 'rxjs';

import type {
  CampaignBriefOutput,
  CampaignEventDetails,
  CampaignGoal,
  CampaignKeyword,
  CampaignPlatform,
  CampaignSSEEventType,
  HubSpotUtmLookupResult,
  SSEEvent,
} from '@lfx-one/shared/interfaces';
import type { CampaignGoalOption, CampaignPlatformOption } from '@lfx-one/shared/constants';

type PlanningStep = 'input' | 'generating' | 'review';

@Component({
  selector: 'lfx-planning-tab',
  imports: [ReactiveFormsModule, ButtonComponent],
  templateUrl: './planning-tab.component.html',
  styleUrl: './planning-tab.component.scss',
})
export class PlanningTabComponent implements OnInit {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly fb = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // === Outputs ===
  public readonly proceedToImplementation = output<CampaignBriefOutput>();

  // === Constants ===
  protected readonly platforms: CampaignPlatformOption[] = [...CAMPAIGN_PLATFORMS];
  protected readonly goals: CampaignGoalOption[] = [...CAMPAIGN_GOALS];

  // === Forms ===
  protected readonly briefForm = this.fb.nonNullable.group({
    url: ['', [Validators.required]],
    campaignGoal: ['conversions'],
    targetAudience: [''],
    valueProp: [''],
    totalBudget: [''],
    driveFolderUrl: [''],
  });

  // === WritableSignals ===
  protected readonly step = signal<PlanningStep>('input');
  protected readonly selectedPlatforms = signal<Set<CampaignPlatform>>(new Set(['google-ads']));
  protected readonly statusMessages = signal<string[]>([]);
  protected readonly eventDetails = signal<CampaignEventDetails | null>(null);
  protected readonly copyBuffer = signal('');
  protected readonly structuredCopy = signal<Record<string, unknown> | null>(null);
  protected readonly hsUtm = signal<string | null>(null);
  protected readonly hsSearching = signal(false);
  protected readonly hsCreating = signal(false);
  protected readonly hsStatus = signal<string | null>(null);
  protected readonly hsNotFound = signal(false);
  protected readonly hsMatches = signal<{ name: string; hs_utm: string }[]>([]);
  protected readonly keywords = signal<CampaignKeyword[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected lastLookedUpEvent = '';
  private readonly urlInput$ = new Subject<string>();

  // === Editable Review Signals ===
  protected readonly editSearchHeadlines = signal<string[]>([]);
  protected readonly editSearchDescriptions = signal<string[]>([]);
  protected readonly editDisplayHeadlines = signal<string[]>([]);
  protected readonly editDisplayDescriptions = signal<string[]>([]);
  protected readonly editDisplayBusinessName = signal('');
  protected readonly editDisplayCta = signal('');
  protected readonly editKeywords = signal<CampaignKeyword[]>([]);
  protected readonly isEditing = signal(false);

  // === Computed Signals ===
  private readonly formValid = toSignal(this.briefForm.statusChanges, { initialValue: this.briefForm.status });
  protected readonly canGenerate = computed(() => this.formValid() === 'VALID' && this.selectedPlatforms().size > 0);
  protected readonly isGenerating = computed(() => this.step() === 'generating');
  protected readonly hasResults = computed(() => this.step() === 'review');

  // === Private State ===
  private briefSubscription: Subscription | null = null;

  // === Lifecycle ===
  public ngOnInit(): void {
    this.urlInput$.pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe((eventName) => this.lookupHubSpot(eventName));
  }

  // === Protected Methods ===
  protected togglePlatform(platformId: CampaignPlatform): void {
    const current = new Set(this.selectedPlatforms());
    if (current.has(platformId)) {
      current.delete(platformId);
    } else {
      current.add(platformId);
    }
    this.selectedPlatforms.set(current);
  }

  protected isPlatformSelected(platformId: CampaignPlatform): boolean {
    return this.selectedPlatforms().has(platformId);
  }

  protected onUrlInput(): void {
    const url = this.briefForm.controls.url.value.trim();
    const eventName = this.extractEventName(url);
    if (eventName.length > 3) {
      this.urlInput$.next(eventName);
    }
  }

  protected selectHsMatch(hsUtm: string, name: string): void {
    this.hsUtm.set(hsUtm);
    this.hsStatus.set(`Selected: ${name}`);
  }

  protected createInHubSpot(): void {
    if (!this.lastLookedUpEvent) return;
    this.hsCreating.set(true);
    this.hsStatus.set(null);
    this.campaignService.createHubSpotUtm(this.lastLookedUpEvent).subscribe({
      next: (result) => {
        if (result?.created && result.hs_utm) {
          this.hsUtm.set(result.hs_utm);
          this.hsNotFound.set(false);
          this.hsStatus.set(`Created: ${result.campaign_name}`);
        } else {
          this.hsStatus.set('Failed to create campaign');
        }
        this.hsCreating.set(false);
      },
      error: () => {
        this.hsStatus.set('Create failed');
        this.hsCreating.set(false);
      },
    });
  }

  protected generate(): void {
    if (!this.canGenerate()) return;

    this.step.set('generating');
    this.statusMessages.set([]);
    this.eventDetails.set(null);
    this.copyBuffer.set('');
    this.structuredCopy.set(null);
    this.keywords.set([]);
    this.errorMessage.set(null);

    const budgetRaw = this.briefForm.controls.totalBudget.value;
    const budgetStr = typeof budgetRaw === 'string' ? budgetRaw.trim() : String(budgetRaw ?? '');
    const request = {
      url: this.briefForm.controls.url.value.trim(),
      platforms: [...this.selectedPlatforms()] as CampaignPlatform[],
      campaignGoal: (this.briefForm.controls.campaignGoal.value || undefined) as CampaignGoal | undefined,
      targetAudience: this.briefForm.controls.targetAudience.value.trim() || undefined,
      valueProp: this.briefForm.controls.valueProp.value.trim() || undefined,
      totalBudget: budgetStr ? Number(budgetStr) : undefined,
    };

    this.briefSubscription = this.campaignService
      .generateBrief(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event: SSEEvent<CampaignSSEEventType>) => this.handleSSEEvent(event),
        error: () => {
          this.errorMessage.set('Connection lost. Please try again.');
          this.step.set('input');
        },
        complete: () => {
          if (this.step() === 'generating') {
            this.step.set('review');
          }
        },
      });
  }

  protected reset(): void {
    this.briefSubscription?.unsubscribe();
    this.briefSubscription = null;
    this.step.set('input');
    this.statusMessages.set([]);
    this.eventDetails.set(null);
    this.copyBuffer.set('');
    this.structuredCopy.set(null);
    this.hsUtm.set(null);
    this.keywords.set([]);
    this.errorMessage.set(null);
    this.isEditing.set(false);
  }

  protected onProceedToImplementation(): void {
    if (this.isEditing()) {
      this.saveEdits();
    }
    const url = this.briefForm.controls.url.value.trim();
    const fallbackName = this.extractEventName(url);
    const fallbackSlug = this.extractSlug(url);
    const details: CampaignEventDetails = this.eventDetails() ?? {
      name: fallbackName,
      dates: '',
      city: '',
      countryCode: 'US',
      audience: '',
      themes: [],
      registrationUrl: url,
      speakers: [],
      slug: fallbackSlug,
      formatNotes: '',
    };
    const budgetRaw2 = this.briefForm.controls.totalBudget.value;
    const budgetStr = typeof budgetRaw2 === 'string' ? budgetRaw2.trim() : String(budgetRaw2 ?? '');
    this.proceedToImplementation.emit({
      eventDetails: details,
      structuredCopy: this.structuredCopy(),
      keywords: this.keywords(),
      hsUtm: this.hsUtm(),
      totalBudget: budgetStr ? Number(budgetStr) : null,
      driveFolderUrl: this.briefForm.controls.driveFolderUrl.value.trim(),
      campaignGoal: (this.briefForm.controls.campaignGoal.value as CampaignGoal) || null,
    });
  }

  protected copyToClipboard(): void {
    if (isPlatformBrowser(this.platformId) && navigator.clipboard) {
      navigator.clipboard.writeText(this.copyBuffer()).catch(() => {
        /* clipboard access denied — fail gracefully */
      });
    }
  }

  protected getSearchCopy(): Record<string, unknown> | null {
    const copy = this.structuredCopy();
    if (!copy) return null;
    const nested = copy['platforms'] as Record<string, unknown> | undefined;
    return (copy['google_search'] as Record<string, unknown>) ?? (nested?.['google_search'] as Record<string, unknown>) ?? null;
  }

  protected getDisplayCopy(): Record<string, unknown> | null {
    const copy = this.structuredCopy();
    if (!copy) return null;
    const nested = copy['platforms'] as Record<string, unknown> | undefined;
    return (
      (copy['google_display'] as Record<string, unknown>) ??
      (copy['demand_gen'] as Record<string, unknown>) ??
      (nested?.['google_display'] as Record<string, unknown>) ??
      (nested?.['demand_gen'] as Record<string, unknown>) ??
      null
    );
  }

  protected asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]) : [];
  }

  protected intentClass(level: string): string {
    switch (level) {
      case 'High':
        return 'bg-green-100 text-green-700';
      case 'Medium':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  protected enterEditMode(): void {
    const search = this.getSearchCopy();
    const display = this.getDisplayCopy();
    this.editSearchHeadlines.set([...this.asStringArray(search?.['headlines'])]);
    this.editSearchDescriptions.set([...this.asStringArray(search?.['descriptions'])]);
    this.editDisplayHeadlines.set([...this.asStringArray(display?.['headlines'])]);
    this.editDisplayDescriptions.set([...this.asStringArray(display?.['descriptions'])]);
    this.editDisplayBusinessName.set((display?.['business_name'] as string) ?? '');
    this.editDisplayCta.set((display?.['call_to_action'] as string) ?? '');
    this.editKeywords.set(this.keywords().map((kw) => ({ ...kw })));
    this.isEditing.set(true);
  }

  protected saveEdits(): void {
    const copy = { ...(this.structuredCopy() ?? {}) };
    const search = { ...((this.getSearchCopy() as Record<string, unknown>) ?? {}) };
    const display = { ...((this.getDisplayCopy() as Record<string, unknown>) ?? {}) };

    search['headlines'] = this.editSearchHeadlines();
    search['descriptions'] = this.editSearchDescriptions();
    display['headlines'] = this.editDisplayHeadlines();
    display['descriptions'] = this.editDisplayDescriptions();
    display['business_name'] = this.editDisplayBusinessName();
    display['call_to_action'] = this.editDisplayCta();

    copy['google_search'] = search;
    const displayKey = copy['demand_gen'] ? 'demand_gen' : 'google_display';
    copy[displayKey] = display;

    this.structuredCopy.set(copy);
    this.keywords.set(this.editKeywords());
    this.isEditing.set(false);
  }

  protected cancelEdit(): void {
    this.isEditing.set(false);
  }

  protected updateEditItem(arr: string[], index: number, value: string): string[] {
    const updated = [...arr];
    updated[index] = value;
    return updated;
  }

  protected addEditItem(sig: typeof this.editSearchHeadlines): void {
    sig.update((items) => [...items, '']);
  }

  protected removeEditItem(sig: typeof this.editSearchHeadlines, index: number): void {
    sig.update((items) => items.filter((_, i) => i !== index));
  }

  protected updateKeywordField(index: number, field: keyof CampaignKeyword, value: string): void {
    this.editKeywords.update((kws) => {
      const updated = kws.map((kw) => ({ ...kw }));
      (updated[index] as Record<string, string>)[field] = value;
      return updated;
    });
  }

  protected addKeyword(): void {
    this.editKeywords.update((kws) => [...kws, { term: '', matchType: 'Broad', intentLevel: 'Medium', notes: '' }]);
  }

  protected removeKeyword(index: number): void {
    this.editKeywords.update((kws) => kws.filter((_, i) => i !== index));
  }

  // === Private Methods ===
  private extractEventName(url: string): string {
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, '');
      const slug = pathname.split('/').pop() ?? '';
      return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } catch {
      return '';
    }
  }

  private extractSlug(url: string): string {
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, '');
      return pathname.split('/').pop() ?? '';
    } catch {
      return '';
    }
  }

  private lookupHubSpot(eventName: string): void {
    if (this.lastLookedUpEvent === eventName) return;
    this.lastLookedUpEvent = eventName;
    this.hsSearching.set(true);
    this.hsStatus.set(null);
    this.hsMatches.set([]);
    this.hsNotFound.set(false);
    this.hsUtm.set(null);

    this.campaignService.lookupHubSpotUtm(eventName).subscribe({
      next: (result: HubSpotUtmLookupResult | null) => {
        if (result?.found && result.hs_utm) {
          this.hsUtm.set(result.hs_utm);
          this.hsMatches.set(result.all_matches ?? []);
          this.hsStatus.set(`Found: ${result.campaign_name}`);
        } else {
          this.hsNotFound.set(true);
          this.hsStatus.set('No matching campaign in HubSpot');
        }
        this.hsSearching.set(false);
      },
      error: () => {
        this.hsStatus.set('HubSpot lookup failed');
        this.hsSearching.set(false);
      },
    });
  }

  private handleSSEEvent(event: SSEEvent<CampaignSSEEventType>): void {
    switch (event.type) {
      case 'status':
        this.statusMessages.update((msgs) => [...msgs, event.data as string]);
        break;
      case 'event':
        this.eventDetails.set(event.data as CampaignEventDetails);
        break;
      case 'copy_token':
        this.copyBuffer.update((buf) => buf + (event.data as string));
        break;
      case 'copy_structured': {
        const raw = event.data as Record<string, unknown>;
        const nested = raw['platforms'] as Record<string, unknown> | undefined;
        if (nested) {
          for (const [key, value] of Object.entries(nested)) {
            if (!(key in raw)) raw[key] = value;
          }
          delete raw['platforms'];
        }
        this.structuredCopy.set(raw);
        break;
      }
      case 'hubspot_utm': {
        const utmData = event.data as { hsUtm?: string } | string;
        this.hsUtm.set(typeof utmData === 'string' ? utmData : (utmData?.hsUtm ?? null));
        break;
      }
      case 'copy_done':
        break;
      case 'keywords':
        this.keywords.set(event.data as CampaignKeyword[]);
        break;
      case 'error':
        this.errorMessage.set(event.data as string);
        this.step.set('input');
        break;
      case 'done':
        this.step.set('review');
        break;
    }
  }
}
