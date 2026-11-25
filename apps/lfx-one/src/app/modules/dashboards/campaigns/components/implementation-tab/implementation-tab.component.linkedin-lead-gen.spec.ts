// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedInObjectivePickerComponent } from '../linkedin-objective-picker/linkedin-objective-picker.component';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Wiring only (linuxfoundation/lfx-v2-campaign-service#664). What a lead gen draft sends and why Create waits are rules in
 * `campaign-linkedin-lead-gen-form.utils.ts` and `campaign-linkedin-lead-gen.utils.ts`, tested there. Here: the draft
 * reaches the request with no variant call to action, a manual bid is refused in the Bidding control, and (one render)
 * the choice is offered while Text Ads and the per-ad call to action are hidden.
 */
describe('ImplementationTabComponent linkedin lead gen', () => {
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const DRAFT: LinkedInObjectiveDraft = {
    objective: 'lead_generation',
    conversions: [],
    conversionsOwner: null,
    leadGenForm: '6755260984438374400',
    leadGenFormOwner: `tlf|${ACCOUNT.accountId}`,
  };
  let createCampaign: ReturnType<typeof vi.fn>;

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads'],
      linkedInCopy: {
        variants: [{ introText: 'Intro', headline: 'Headline' }],
        recommendedGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
        recommendedTargetingProfile: 'cloud-native',
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  async function mount(): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('linkedInLeadGenEnabled', true);
    f.componentRef.setInput('linkedInCallToActionEnabled', true);
    f.componentRef.setInput('linkedInTextAdsEnabled', true);
    f.componentRef.setInput('biddingEnabled', true);
    f.componentRef.setInput('briefData', brief());
    c(f)['selectedPlatforms'].set(['linkedin-ads']);
    f.detectChanges();
    await f.whenStable();
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    return f;
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            getLinkedInAccounts: () => of([ACCOUNT]),
            getLinkedInTargetingProfiles: () => of([]),
            getLinkedInLeadForms: () => of({ accountId: '111', forms: [{ id: DRAFT.leadGenForm, name: 'CFP interest', state: 'DRAFT' }] }),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it('sends the form and Register with no variant call to action, and refuses a manual bid', STATE_ONLY, async () => {
    const f = await mount();
    f.componentRef.setInput('linkedInTargetCostEnabled', true);
    const key = c(f)['linkedInVariantViews']()[0].key;
    c(f)['onLinkedInVariantTextChange'](key, 'callToAction', 'LEARN_MORE');
    c(f)['onLinkedInObjectiveDraftChange'](DRAFT);

    expect(c(f)['createBlockedReason']()).toBeNull();
    // No target cost beside lead generation: a MAX_LEAD target is not documented upstream.
    expect(c(f)['linkedInTargetCostShown']()).toBe(false);
    c(f)['submit']();
    const sent = createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];
    expect(sent).toMatchObject({ objective: 'lead_generation', leadGenForm: DRAFT.leadGenForm, leadGenCallToAction: 'REGISTER' });
    expect(sent['variants'][0]).not.toHaveProperty('callToAction');

    c(f)['onBiddingChange']('linkedin-ads', { strategy: 'manual', bidAmount: 4.5 });
    expect(c(f)['biddingViews']()['linkedin-ads'].error).toContain('automatic bidding only');
    expect(c(f)['canSubmit']()).toBe(false);
  });

  it('asks for another format, not a manual bid, when Text Ads are held beside lead generation', STATE_ONLY, async () => {
    const f = await mount();
    c(f)['onLinkedInFormatSelect']('text');
    c(f)['onLinkedInObjectiveDraftChange'](DRAFT);

    expect(c(f)['createBlockedReason']()).toContain('lead generation campaigns have no Text Ads');
  });

  it('offers lead generation and its form, hiding Text Ads and the per-ad call to action', async () => {
    const f = await mount();
    const query = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);
    // The format select's offered values, as it reads its options.
    const formatValues = (): unknown[] =>
      f.debugElement
        .query(By.css('[data-testid="implementation-linkedin-format"]'))
        .componentInstance['options']()
        .map((o: { value: unknown }) => o.value);
    expect(query('implementation-linkedin-variant-cta-0')).not.toBeNull();
    expect(formatValues()).toContain('text');
    // The picker is mounted on lead gen alone (conversions off) and told it may offer lead generation.
    expect(f.debugElement.query(By.directive(LinkedInObjectivePickerComponent))?.componentInstance.leadGenAvailable()).toBe(true);

    c(f)['onLinkedInObjectiveDraftChange'](DRAFT);
    f.detectChanges();
    await f.whenStable();

    expect(query('linkedin-lead-form-picker')).not.toBeNull();
    expect(query('implementation-linkedin-variant-cta-0')).toBeNull();
    expect(formatValues()).not.toContain('text');
  });
});
