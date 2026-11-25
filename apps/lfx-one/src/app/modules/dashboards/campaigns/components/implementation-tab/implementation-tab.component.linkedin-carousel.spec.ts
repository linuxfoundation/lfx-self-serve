// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, LinkedInCarouselCardDraft, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
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
 * Wiring only (linuxfoundation/lfx-v2-campaign-service#665). What a carousel sends and why Create waits are rules in
 * `campaign-linkedin-carousel-form.utils.ts` and `campaign-linkedin-carousel.utils.ts`, tested there. Here: the cards reach
 * the request with no variants, a non-square image and a lead gen objective hold Create, and (one render) the format is
 * offered while the single image variants and the lead generation choice are hidden.
 */
describe('ImplementationTabComponent linkedin carousel', () => {
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const SQUARE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
  const WIDE = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
  const stored = (id: string, width: number, height: number) => ({
    id,
    projectId: 'tlf',
    briefId: 'b-1',
    mimeType: 'image/png',
    byteSize: 1000,
    checksum: 'c',
    width,
    height,
  });
  const LEAD_GEN: LinkedInObjectiveDraft = {
    objective: 'lead_generation',
    conversions: [],
    conversionsOwner: null,
    leadGenForm: '6755260984438374400',
    leadGenFormOwner: `tlf|${ACCOUNT.accountId}`,
  };
  const card = (key: string, imageAssetId: string): LinkedInCarouselCardDraft => ({
    key,
    imageAssetId,
    imageAssetBriefId: 'b-1',
    headline: `Talk ${key}`,
    destinationUrl: '',
  });
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
    f.componentRef.setInput('linkedInCarouselEnabled', true);
    f.componentRef.setInput('linkedInLeadGenEnabled', true);
    f.componentRef.setInput('linkedInAssetUploadEnabled', true);
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
            getLinkedInLeadForms: () => of({ accountId: '111', forms: [] }),
            listCreativeAssets: () => of({ assets: [stored(SQUARE, 1080, 1080), stored(WIDE, 1200, 628)], videos: [] }),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it('sends the cards with no variants, and holds a non-square image and lead generation', STATE_ONLY, async () => {
    const f = await mount();
    c(f)['onLinkedInFormatSelect']('carousel');
    // The first switch starts the two cards a carousel needs at least.
    expect(c(f)['linkedInCarouselCards']()).toHaveLength(2);
    c(f)['onLinkedInCarouselCardsChange']([card('card-1', SQUARE), card('card-2', SQUARE)]);
    c(f)['onLinkedInCarouselIntroTextChange']('Meet the speakers');
    await f.whenStable();

    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    const sent = createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];
    expect(sent).toMatchObject({
      format: 'carousel',
      carouselIntroText: 'Meet the speakers',
      carouselCards: [
        { imageAssetId: SQUARE, headline: 'Talk card-1' },
        { imageAssetId: SQUARE, headline: 'Talk card-2' },
      ],
      variants: [],
    });

    // The library recorded the second image as 1200x628: Create waits, naming the card.
    c(f)['onLinkedInCarouselCardsChange']([card('card-1', SQUARE), card('card-2', WIDE)]);
    expect(c(f)['createBlockedReason']()).toContain('choose another image for card 2');

    // A hidden single image variant whose image is for another brief holds nothing: the carousel does not send it.
    const variantKey = c(f)['linkedInVariants']()[0].key;
    c(f)['linkedInVariants'].update((variants: Record<string, unknown>[]) =>
      variants.map((v) => (v['key'] === variantKey ? { ...v, imageAssetId: WIDE, imageAssetName: 'old.png', imageAssetBriefId: 'b-0' } : v))
    );
    c(f)['onLinkedInCarouselCardsChange']([card('card-1', SQUARE), card('card-2', SQUARE)]);
    expect(c(f)['createBlockedReason']()).toBeNull();

    c(f)['onLinkedInObjectiveDraftChange'](LEAD_GEN);
    expect(c(f)['createBlockedReason']()).toContain('cannot be carousels yet');
  });

  it('offers the carousel and its editor in place of the variants, and hides lead generation beside it', async () => {
    const f = await mount();
    const query = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);
    const formatValues = (): unknown[] =>
      f.debugElement
        .query(By.css('[data-testid="implementation-linkedin-format"]'))
        .componentInstance['options']()
        .map((o: { value: unknown }) => o.value);
    expect(formatValues()).toContain('carousel');
    expect(f.debugElement.query(By.directive(LinkedInObjectivePickerComponent))?.componentInstance.leadGenOffered()).toBe(true);

    c(f)['onLinkedInFormatSelect']('carousel');
    f.detectChanges();
    await f.whenStable();

    expect(query('linkedin-carousel-editor')).not.toBeNull();
    expect(query('implementation-linkedin-variants')).toBeNull();
    expect(f.debugElement.query(By.directive(LinkedInObjectivePickerComponent))?.componentInstance.leadGenOffered()).toBe(false);
  });
});
