// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { emptyLinkedInDeliveryOptionsDraft, linkedInDeliveryOptionsCreateRefusal } from '@lfx-one/shared/utils';
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
 * Wiring only (campaign-service#667). What the toggles send, when Create waits and how a stored draft is read are rules
 * in `campaign-linkedin-delivery-options-form.utils.ts`, tested there. Here: the toggles reach the request (and nothing by
 * default), the capability gates them, the saved draft and the restore, and the hold reaches Create.
 */
describe('ImplementationTabComponent linkedin delivery options', () => {
  /** The active foundation: a foundation switch keeps the page (and the tab) mounted. */
  const foundation = signal({ slug: 'tlf' });
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const SECOND = { ...ACCOUNT, accountId: 'urn:li:sponsoredAccount:222', label: 'Second Account' };
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
    f.componentRef.setInput('linkedInDeliveryOptionsEnabled', true);
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

  const toggle = (f: ComponentFixture<ImplementationTabComponent>, option: string, checked: boolean): void =>
    c(f)['onLinkedInDeliveryOptionChange'](option, { target: { checked } });
  const sent = (): Record<string, unknown> => createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];

  it('sends nothing by default, both options once on, and nothing while the capability is off', STATE_ONLY, async () => {
    const { f } = await mount();
    expect(c(f)['linkedInDeliveryOptionsShown']()).toBe(true);
    c(f)['submit']();
    expect(sent()).not.toHaveProperty('audienceExpansionEnabled');
    expect(sent()).not.toHaveProperty('offsiteDeliveryEnabled');

    toggle(f, 'audienceExpansion', true);
    toggle(f, 'audienceNetwork', true);
    c(f)['submit']();
    expect(sent()).toMatchObject({ audienceExpansionEnabled: true, offsiteDeliveryEnabled: true });

    f.componentRef.setInput('linkedInDeliveryOptionsEnabled', false);
    expect(c(f)['linkedInDeliveryOptionsShown']()).toBe(false);
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    expect(sent()).not.toHaveProperty('audienceExpansionEnabled');
    expect(sent()).not.toHaveProperty('offsiteDeliveryEnabled');
  });

  it('holds a toggle that is on, keeping it shown, while the capability is unread', STATE_ONLY, async () => {
    const { f } = await mount();
    f.componentRef.setInput('linkedInDeliveryOptionsEnabled', null);
    toggle(f, 'audienceExpansion', true);
    expect(c(f)['linkedInDeliveryOptionsShown']()).toBe(true);
    expect(c(f)['createBlockedReason']()).toBe(linkedInDeliveryOptionsCreateRefusal(c(f)['linkedInDeliveryOptions'](), null));

    f.componentRef.setInput('linkedInDeliveryOptionsEnabled', true);
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    expect(sent()).toMatchObject({ audienceExpansionEnabled: true });
  });

  it('saves the options in the draft, restores them, and drops them on a brief switch', STATE_ONLY, async () => {
    const first = await mount();
    toggle(first.f, 'audienceNetwork', true);
    const saved = first.latest();
    expect(saved).toMatchObject({ linkedInDeliveryOptions: { audienceExpansion: false, audienceNetwork: true } });
    first.f.destroy();

    const { f } = await mount(saved);
    expect(c(f)['linkedInDeliveryOptions']()).toEqual({ audienceExpansion: false, audienceNetwork: true });

    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', brief('oss-na-2026'));
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['linkedInDeliveryOptions']()).toEqual(emptyLinkedInDeliveryOptionsDraft());
  });
});
