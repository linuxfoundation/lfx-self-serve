// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, MetaDeliveryDraft, ProjectContext } from '@lfx-one/shared/interfaces';
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
 * Wiring only (#5904 row 5). What each flag sends, what a budget mode or objective keeps, how a saved draft is read and
 * when Create is held are rules in `campaign-meta-delivery.utils.ts`, tested there; the controls are tested in their own
 * spec. Here: the values reach the request and the objective change, the draft and the restore, and the block reaches Create.
 */
describe('ImplementationTabComponent meta delivery options', () => {
  let createCampaign: ReturnType<typeof vi.fn>;

  const DELIVERY: MetaDeliveryDraft = {
    adSchedule: { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 },
    frequencyCap: { maxImpressions: 2, intervalDays: 7 },
  };
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
    schedule: boolean | null,
    cap: boolean | null,
    draft: CampaignImplementationDraft | null = null
  ): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('createCapabilityRead', 'ready');
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('metaAdScheduleEnabled', schedule);
    f.componentRef.setInput('metaFrequencyCapEnabled', cap);
    if (draft !== null) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    c(f)['selectedPlatforms'].set(['meta-ads']);
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    if (draft === null) {
      c(f)['onMetaLifetimeBudgetChange']({ target: { checked: true } });
      c(f)['onMetaObjectiveChange']({ target: { value: 'awareness' } });
    }
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

  it('sends the schedule and cap, drops the cap on leaving awareness and the schedule on a daily budget', STATE_ONLY, async () => {
    const f = await mount(true, true);
    c(f)['onMetaDeliveryChange'](DELIVERY);
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    await f.whenStable();
    expect(createCampaign.mock.calls.at(-1)?.[0]['metaConfig']).toMatchObject({ lifetimeBudget: true, ...DELIVERY });

    c(f)['onMetaObjectiveChange']({ target: { value: 'traffic' } });
    expect(c(f)['metaDelivery']()).toEqual({ adSchedule: DELIVERY.adSchedule, frequencyCap: null });
    c(f)['onMetaLifetimeBudgetChange']({ target: { checked: false } });
    expect(c(f)['metaDelivery']()).toEqual({ adSchedule: null, frequencyCap: null });
  });

  it('saves the schedule and cap in the draft, restores them, and drops them on a brief switch', STATE_ONLY, async () => {
    const f = await mount(true, true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaDeliveryChange'](DELIVERY);
    f.detectChanges();
    await f.whenStable();
    expect(saved).toMatchObject({ metaAdSchedule: DELIVERY.adSchedule, metaFrequencyCap: DELIVERY.frequencyCap });
    f.destroy();

    const restored = await mount(true, true, saved);
    expect(c(restored)['metaDelivery']()).toEqual(DELIVERY);

    restored.componentRef.setInput('draft', null);
    restored.componentRef.setInput('briefData', brief('oss-na-2026'));
    restored.detectChanges();
    await restored.whenStable();
    expect(c(restored)['metaDelivery']()).toEqual({ adSchedule: null, frequencyCap: null });
  });

  it('holds Create for a schedule this deployment does not send, until it is cleared', STATE_ONLY, async () => {
    const f = await mount(false, true);
    c(f)['onMetaDeliveryChange'](DELIVERY);
    f.detectChanges();
    expect(c(f)['metaDeliveryBlock']()?.kind).toBe('unsupported');
    expect(c(f)['createBlockedReason']()).toContain('ad schedule');
    expect(c(f)['metaDeliveryClearLabel']()).toBe('Clear the ad schedule');

    c(f)['clearUnsendableMetaDelivery']();
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    expect(c(f)['metaDelivery']()).toEqual({ adSchedule: null, frequencyCap: DELIVERY.frequencyCap });
  });
});
