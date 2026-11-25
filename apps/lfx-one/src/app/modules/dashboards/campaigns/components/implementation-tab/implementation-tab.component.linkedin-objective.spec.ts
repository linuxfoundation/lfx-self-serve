// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LINKEDIN_CONVERSIONS_OWNER_MESSAGE } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import { emptyLinkedInObjectiveDraft, linkedInTargetCostCreateRefusal } from '@lfx-one/shared/utils';
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
 * Wiring only (#5764 rows 2 and 4). What the draft sends, how a stored draft is read and why Create waits are rules in
 * `campaign-linkedin-objective-form.utils.ts`, tested there; the picker is tested in its own spec. Here: the draft
 * reaches the request (and nothing by default), the saved draft and the restore, and its refusal reaches Create. The
 * target cost (campaign-service#674) on the same terms: its rules are in `campaign-linkedin-target-cost.utils.ts`.
 */
describe('ImplementationTabComponent linkedin objective', () => {
  /** The active foundation: a foundation switch keeps the page (and the tab) mounted. */
  const foundation = signal({ slug: 'tlf' });
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const SECOND = { ...ACCOUNT, accountId: 'urn:li:sponsoredAccount:222', label: 'Second Account' };
  const DRAFT: LinkedInObjectiveDraft = { objective: 'conversions', conversions: ['104012'], conversionsOwner: `tlf|${ACCOUNT.accountId}` };
  let createCampaign: ReturnType<typeof vi.fn>;

  const brief = (slug = 'kubecon-eu-2026'): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
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

  async function mount(draft: CampaignImplementationDraft | null = null): Promise<{
    f: ComponentFixture<ImplementationTabComponent>;
    latest: () => CampaignImplementationDraft | null;
  }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    let captured: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('linkedInConversionsEnabled', true);
    if (draft !== null) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief());
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
            getLinkedInAccounts: () => of([ACCOUNT, SECOND]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it('sends nothing by default, and the objective and rules once chosen', STATE_ONLY, async () => {
    const { f } = await mount();
    c(f)['submit']();
    const before = createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];
    expect(before).not.toHaveProperty('objective');
    expect(before).not.toHaveProperty('conversions');

    c(f)['onLinkedInObjectiveDraftChange'](DRAFT);
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    expect(createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig']).toMatchObject({ objective: 'conversions', conversions: ['104012'] });
  });

  it('saves the objective in the draft, restores it, and drops it on a brief switch', STATE_ONLY, async () => {
    const first = await mount();
    c(first.f)['onLinkedInObjectiveDraftChange'](DRAFT);
    const saved = first.latest();
    expect(saved).toMatchObject({ linkedInObjectiveDraft: DRAFT });
    first.f.destroy();

    const { f } = await mount(saved);
    expect(c(f)['linkedInObjectiveDraft']()).toEqual(DRAFT);

    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', brief('oss-na-2026'));
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['linkedInObjectiveDraft']()).toEqual(emptyLinkedInObjectiveDraft());
  });

  it('sends a typed target cost inside automatic bidding, holds Create on a refused one, and drops it with manual bidding', STATE_ONLY, async () => {
    const { f } = await mount();
    f.componentRef.setInput('biddingEnabled', true);
    f.componentRef.setInput('linkedInTargetCostEnabled', true);
    c(f)['onLinkedInObjectiveDraftChange']({ ...emptyLinkedInObjectiveDraft(), targetCost: '17.88' });
    expect(c(f)['linkedInObjectivePickerShown']()).toBe(true);
    c(f)['submit']();
    expect(createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig']['bidding']).toEqual({ strategy: 'automatic', targetAmount: 17.88 });

    const refused = { ...emptyLinkedInObjectiveDraft(), targetCost: '0' };
    c(f)['onLinkedInObjectiveDraftChange'](refused);
    expect(c(f)['createBlockedReason']()).toBe(linkedInTargetCostCreateRefusal(refused, true));

    c(f)['onBiddingChange']('linkedin-ads', { strategy: 'manual', bidAmount: 5 });
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    expect(createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig']['bidding']).toEqual({ strategy: 'manual', bidAmount: 5 });
  });

  it('holds a typed target cost, keeping its field, while the bidding and target cost capabilities are both unread', STATE_ONLY, async () => {
    const { f } = await mount();
    f.componentRef.setInput('biddingEnabled', null);
    f.componentRef.setInput('linkedInTargetCostEnabled', null);
    const typed = { ...emptyLinkedInObjectiveDraft(), targetCost: '17.88' };
    c(f)['onLinkedInObjectiveDraftChange'](typed);
    expect(c(f)['linkedInTargetCostFieldShown']()).toBe(true);
    expect(c(f)['createBlockedReason']()).toBe(linkedInTargetCostCreateRefusal(typed, false, true));

    f.componentRef.setInput('biddingEnabled', true);
    f.componentRef.setInput('linkedInTargetCostEnabled', true);
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    expect(createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig']['bidding']).toEqual({ strategy: 'automatic', targetAmount: 17.88 });
  });

  it('holds Create, never dropping the choice, for rules of another ad account and while the capability is off', STATE_ONLY, async () => {
    const { f } = await mount();
    c(f)['onLinkedInObjectiveDraftChange'](DRAFT);
    c(f)['campaignForm'].controls['linkedInAccountId'].setValue(SECOND.accountId);
    expect(c(f)['createBlockedReason']()).toBe(`LinkedIn Ads: ${LINKEDIN_CONVERSIONS_OWNER_MESSAGE}`);
    expect(c(f)['linkedInObjectiveDraft']()).toEqual(DRAFT);

    c(f)['campaignForm'].controls['linkedInAccountId'].setValue(ACCOUNT.accountId);
    f.componentRef.setInput('linkedInConversionsEnabled', false);
    expect(c(f)['createBlockedReason']()).toBe('LinkedIn Ads: the campaign objective is not available right now. Choose "Set by bidding" as the objective.');
  });
});
