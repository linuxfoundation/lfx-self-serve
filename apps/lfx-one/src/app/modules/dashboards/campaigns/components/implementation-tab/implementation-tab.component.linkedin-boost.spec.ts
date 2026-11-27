// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { linkedInBoostCreateRefusal } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Wiring only (campaign-service#673). What a boost sends, the post field's error, when Create waits and how a stored draft
 * is read are rules in `campaign-linkedin-boost.utils.ts` and `campaign-linkedin-draft.utils.ts`, tested there. Here: the
 * post reaches the request, the capability gates it, the draft round-trip, and the post field replacing the ad variants.
 */
describe('ImplementationTabComponent linkedin boost', () => {
  const foundation = signal({ slug: 'tlf' });
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const POST = 'urn:li:share:7518402035831111680';
  let createCampaign: ReturnType<typeof vi.fn>;

  const brief = {
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
  } as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  async function mount(draft: CampaignImplementationDraft | null = null): Promise<{
    f: ComponentFixture<ImplementationTabComponent>;
    latest: () => CampaignImplementationDraft | null;
  }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    let captured: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('linkedInBoostEnabled', true);
    if (draft !== null) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief);
    c(f)['selectedPlatforms'].set(['linkedin-ads']);
    f.detectChanges();
    await f.whenStable();
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    return { f, latest: () => captured };
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: foundation } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            getLinkedInAccounts: () => of([ACCOUNT]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  const boost = (f: ComponentFixture<ImplementationTabComponent>, post: string): void => {
    c(f)['onLinkedInFormatSelect']('boost');
    c(f)['onLinkedInBoostPostInput']({ target: { value: post } });
  };
  const sent = (): Record<string, unknown> => createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];

  it('sends the post with no variants, holds an empty post, and sends nothing while the capability is off', STATE_ONLY, async () => {
    const { f } = await mount();
    boost(f, '');
    expect(c(f)['createBlockedReason']()).toBe(linkedInBoostCreateRefusal(''));

    boost(f, POST);
    c(f)['submit']();
    expect(sent()).toMatchObject({ format: 'boost', boostPost: POST, variants: [] });

    f.componentRef.setInput('linkedInBoostEnabled', false);
    expect(c(f)['createBlockedReason']()).toContain('boosting a post is not available');
    c(f)['submit']();
    expect(createCampaign).toHaveBeenCalledTimes(1);
  });

  it('saves the format and post in the draft, and holds a restored boost the deployment no longer offers', STATE_ONLY, async () => {
    const first = await mount();
    boost(first.f, POST);
    const saved = first.latest();
    expect(saved).toMatchObject({ linkedInFormat: 'boost', linkedInBoostPost: POST });
    first.f.destroy();

    const { f } = await mount(saved);
    expect(c(f)['linkedInBoostPost']()).toBe(POST);
    expect(c(f)['linkedInBoostSelected']()).toBe(true);

    f.componentRef.setInput('linkedInBoostEnabled', null);
    expect(c(f)['linkedInBoostSelected']()).toBe(false);
    expect(c(f)['createBlockedReason']()).toContain('boosting a post is not available');
  });

  it('shows the post field in place of the ad variants', async () => {
    const { f } = await mount();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="implementation-linkedin-variants"]')).not.toBeNull();

    boost(f, 'urn:li:activity:1');
    f.detectChanges();
    expect(el.querySelector('[data-testid="implementation-linkedin-boost-post"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="implementation-linkedin-variants"]')).toBeNull();
    expect(el.querySelector('[data-testid="implementation-linkedin-boost-post-error"]')?.textContent).toContain('activity URN');
  });
});
