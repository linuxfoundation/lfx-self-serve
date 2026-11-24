// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, MetaDetailedTargetingPicks, ProjectContext } from '@lfx-one/shared/interfaces';
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
 * Wiring only (#5904 row 4). Which lists a flag sends, how a saved draft is read and when Create is held are rules
 * in `campaign-meta-detailed-targeting.utils.ts`, tested there; the picker is tested in its own spec. Here: the
 * picks reach the request, the draft and the restore, and the block reaches Create.
 */
describe('ImplementationTabComponent meta detailed targeting', () => {
  let createCampaign: ReturnType<typeof vi.fn>;

  const PICKS: MetaDetailedTargetingPicks = {
    interests: [{ id: '6003', name: 'Open source' }],
    behaviors: [{ id: '6004', name: 'Early adopters' }],
    workPositions: [{ id: '105', name: 'Engineer' }],
  };
  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads'],
      metaCopy: { variants: [{ primaryText: 'Primary', headline: 'Headline', description: '' }], recommendedGeos: ['US'] },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  async function mount(
    interest: boolean | null,
    behavior: boolean | null,
    draft: CampaignImplementationDraft | null = null
  ): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('createCapabilityRead', 'ready');
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('metaInterestTargetingEnabled', interest);
    f.componentRef.setInput('metaBehaviorTargetingEnabled', behavior);
    if (draft !== null) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    c(f)['selectedPlatforms'].set(['meta-ads']);
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    await f.whenStable();
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
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(ProjectContextService).setRouteLensKind('foundation');
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
  });

  it('sends the picks as metaConfig.targeting ids', STATE_ONLY, async () => {
    const f = await mount(true, true);
    c(f)['onMetaDetailedTargetingChange'](PICKS);
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    await f.whenStable();
    expect(createCampaign.mock.calls.at(-1)?.[0]['metaConfig']['targeting']).toMatchObject({
      interests: ['6003'],
      behaviors: ['6004'],
      workPositions: ['105'],
    });
  });

  it('saves the picks in the draft and restores them', STATE_ONLY, async () => {
    const f = await mount(true, true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaDetailedTargetingChange'](PICKS);
    f.detectChanges();
    await f.whenStable();
    expect(saved).toMatchObject({ metaDetailedTargeting: PICKS });
    f.destroy();

    const restored = await mount(true, true, saved);
    expect(c(restored)['metaDetailedTargeting']()).toEqual(PICKS);
  });

  it('holds Create for picks in a list this deployment does not send, until they are cleared', STATE_ONLY, async () => {
    const f = await mount(true, false);
    c(f)['onMetaDetailedTargetingChange'](PICKS);
    f.detectChanges();
    expect(c(f)['metaDetailedTargetingBlock']()?.kind).toBe('unsupported');
    expect(c(f)['createBlockedReason']()).toContain('detailed targeting');

    c(f)['clearUnsendableMetaDetailedTargeting']();
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    expect(c(f)['metaDetailedTargeting']().interests).toEqual(PICKS.interests);
  });
});
