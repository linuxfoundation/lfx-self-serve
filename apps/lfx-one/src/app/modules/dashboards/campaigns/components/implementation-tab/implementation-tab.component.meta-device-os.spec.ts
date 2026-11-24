// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, MetaDeviceOsDraft, ProjectContext } from '@lfx-one/shared/interfaces';
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
 * Wiring only (#5904 row 6). What each flag sends, how a saved draft is read, when Create is held and which device and
 * OS combinations are refused are rules in `campaign-meta-device-os.utils.ts`, tested there; the boxes are tested in
 * their own spec. Here: the values reach the request, a placement change reaches the rule, the draft and the restore,
 * and the block reaches Create.
 */
describe('ImplementationTabComponent meta devices and operating systems', () => {
  let createCampaign: ReturnType<typeof vi.fn>;

  const DEVICE_OS: MetaDeviceOsDraft = { devicePlatforms: ['mobile'], userOs: ['iOS'] };
  const brief = (slug = 'kubecon-eu-2026'): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads'],
      metaCopy: { variants: [{ primaryText: 'Primary', headline: 'Headline', description: '' }], recommendedGeos: ['US'] },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  async function mount(
    device: boolean | null,
    os: boolean | null,
    draft: CampaignImplementationDraft | null = null
  ): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('createCapabilityRead', 'ready');
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('metaDeviceTargetingEnabled', device);
    f.componentRef.setInput('metaOsTargetingEnabled', os);
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

  it('sends the devices and systems in the targeting block, and holds Create for desktop only beside Audience Network', STATE_ONLY, async () => {
    const f = await mount(true, true);
    c(f)['onMetaDeviceOsChange'](DEVICE_OS);
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    await f.whenStable();
    expect(createCampaign.mock.calls.at(-1)?.[0]['metaConfig']['targeting']).toMatchObject(DEVICE_OS);

    c(f)['onMetaDeviceOsChange']({ devicePlatforms: ['desktop'], userOs: [] });
    c(f)['onMetaPlacementChange']('audienceNetwork', { target: { checked: true } });
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toContain('Audience Network');
  });

  it('saves the devices and systems in the draft, restores them, and drops them on a brief switch', STATE_ONLY, async () => {
    const f = await mount(true, true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaDeviceOsChange'](DEVICE_OS);
    f.detectChanges();
    await f.whenStable();
    expect(saved).toMatchObject({ metaDevicePlatforms: ['mobile'], metaUserOs: ['iOS'] });
    f.destroy();

    const restored = await mount(true, true, saved);
    expect(c(restored)['metaDeviceOs']()).toEqual(DEVICE_OS);

    restored.componentRef.setInput('draft', null);
    restored.componentRef.setInput('briefData', brief('oss-na-2026'));
    restored.detectChanges();
    await restored.whenStable();
    expect(c(restored)['metaDeviceOs']()).toEqual({ devicePlatforms: [], userOs: [] });
  });

  it('holds Create for systems this deployment does not send, until they are cleared', STATE_ONLY, async () => {
    const f = await mount(true, false);
    c(f)['onMetaDeviceOsChange'](DEVICE_OS);
    f.detectChanges();
    expect(c(f)['metaDeviceOsBlock']()?.kind).toBe('unsupported');
    expect(c(f)['createBlockedReason']()).toContain('operating systems');
    expect(c(f)['metaDeviceOsClearLabel']()).toBe('Clear the operating systems');

    c(f)['clearUnsendableMetaDeviceOs']();
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    expect(c(f)['metaDeviceOs']()).toEqual({ devicePlatforms: ['mobile'], userOs: [] });
  });
});
