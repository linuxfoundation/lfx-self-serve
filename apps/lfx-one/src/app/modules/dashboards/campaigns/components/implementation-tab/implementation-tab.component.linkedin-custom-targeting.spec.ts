// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, LinkedInTargetingDraft } from '@lfx-one/shared/interfaces';
import { emptyLinkedInTargetingDraft } from '@lfx-one/shared/utils';
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
 * Wiring only (#5764 rows 8–11). What the draft sends, how a stored draft is read and why Create waits are rules in
 * `campaign-linkedin-targeting-form.utils.ts`, tested there; the editor is tested in its own spec. Here: the draft
 * reaches the request in place of the profile edit, the saved draft and the restore, and its refusal reaches Create.
 */
describe('ImplementationTabComponent linkedin custom targeting', () => {
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };
  const DRAFT: LinkedInTargetingDraft = { clauses: [{ skills: [{ urn: 'urn:li:skill:1', name: 'Go' }] }], exclude: {} };
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
    f.componentRef.setInput('linkedInTargetingEnabled', true);
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
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'tlf' }) } },
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

  it('sends the clauses as linkedInConfig.targeting with no profile edit, and nothing once a profile is chosen', STATE_ONLY, async () => {
    const { f } = await mount();
    // Removals held on the profile: they would go as a profile edit, which custom targeting replaces.
    c(f)['campaignForm'].controls['linkedInTargetingRemovals'].setValue({ skills: ['urn:li:skill:9'], groups: [] });
    c(f)['onLinkedInCustomTargetingOn']();
    c(f)['onLinkedInTargetingDraftChange'](DRAFT);
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    const sent = createCampaign.mock.calls.at(-1)?.[0]['linkedInConfig'];
    expect(sent['targeting']).toEqual({ include: [{ skills: ['urn:li:skill:1'] }] });
    expect(sent).not.toHaveProperty('targetingProfileEdit');

    c(f)['setLinkedInTargetingProfile']('cloud-native');
    expect(c(f)['linkedInCustomTargetingSelected']()).toBe(false);
  });

  it('saves the toggle and clauses in the draft, restores them, and drops them on a brief switch', STATE_ONLY, async () => {
    const first = await mount();
    c(first.f)['onLinkedInCustomTargetingOn']();
    c(first.f)['onLinkedInTargetingDraftChange'](DRAFT);
    const saved = first.latest();
    expect(saved).toMatchObject({ linkedInCustomTargeting: true, linkedInTargetingDraft: DRAFT });
    first.f.destroy();

    const { f } = await mount(saved);
    expect(c(f)['linkedInCustomTargeting']()).toBe(true);
    expect(c(f)['linkedInTargetingDraft']()).toEqual(DRAFT);

    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', brief('oss-na-2026'));
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['linkedInCustomTargeting']()).toBe(false);
    expect(c(f)['linkedInTargetingDraft']()).toEqual(emptyLinkedInTargetingDraft());
  });

  it('holds Create while the clauses are refused, and not once the capability is off', STATE_ONLY, async () => {
    const { f } = await mount();
    c(f)['onLinkedInCustomTargetingOn']();
    expect(c(f)['createBlockedReason']()).toBe('LinkedIn Ads: fix the custom targeting. Add at least one included targeting clause.');

    f.componentRef.setInput('linkedInTargetingEnabled', false);
    expect(c(f)['createBlockedReason']()).toBeNull();
  });
});
