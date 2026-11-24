// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { META_LEAD_FORM_INACTIVE_REFUSAL } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft, ProjectContext } from '@lfx-one/shared/interfaces';
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
 * Wiring only (#5940). Which objectives are offered, when a form holds Create and which call to action a form
 * may carry are rules in `campaign-meta-lead-form.utils.ts`, tested there; the picker is tested in its own spec.
 * Here: the input reaches the objective list, the helper's answer reaches Create and the request, and a foundation
 * switch and a draft restored under another foundation reach the reset; a held form the picker reports as inactive
 * holds Create, and a draft restored before the foundation resolves keeps its form once it does (#6107).
 */
describe('ImplementationTabComponent meta lead form', () => {
  let createCampaign: ReturnType<typeof vi.fn>;

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

  async function mount(leadFormsEnabled: boolean | null): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('createCapabilityRead', 'ready');
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('metaLeadFormsEnabled', leadFormsEnabled);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    c(f)['selectedPlatforms'].set(['meta-ads']);
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c(f)['onMetaObjectiveChange']({ target: { value: 'leads' } });
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
            getMetaLeadForms: () =>
              of({
                pageId: '100000000000001',
                forms: [
                  { id: '111', name: 'Registrations', status: 'ACTIVE' },
                  { id: '222', name: 'Old form', status: 'ARCHIVED' },
                ],
              }),
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(ProjectContextService).setRouteLensKind('foundation');
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
  });

  it('offers Leads only on an explicit yes, and holds Create until a form is chosen', async () => {
    expect(c(await mount(null))['metaObjectiveOptions']()).not.toContain('leads');

    const f = await mount(true);
    expect(c(f)['metaObjectiveOptions']()).toContain('leads');
    expect(f.nativeElement.querySelector('[data-testid="implementation-meta-lead-form"]')).not.toBeNull();
    expect(c(f)['createBlockedReason']()).toContain('Choose a lead form');
  });

  it('sends the chosen form as metaConfig.leadFormId on the Leads objective', STATE_ONLY, async () => {
    const f = await mount(true);
    c(f)['onMetaLeadFormChange']('111');
    f.detectChanges();
    expect(c(f)['createBlockedReason']()).toBeNull();
    c(f)['submit']();
    await f.whenStable();
    expect(createCampaign.mock.calls.at(-1)?.[0]['metaConfig']).toMatchObject({ objective: 'leads', leadFormId: '111' });
  });

  it('drops Leads and the form on a foundation switch', STATE_ONLY, async () => {
    const f = await mount(true);
    c(f)['onMetaLeadFormChange']('111');
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'uid-cncf', slug: 'cncf', name: 'cncf' } as ProjectContext, false);
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['metaObjective']()).toBe('traffic');
    expect(c(f)['metaLeadFormId']()).toBe('');
  });

  it('drops Leads and the form when a draft saved under another foundation is restored', STATE_ONLY, async () => {
    const f = await mount(true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaLeadFormChange']('111');
    f.detectChanges();
    await f.whenStable();
    expect(saved).not.toBeNull();
    f.destroy();

    TestBed.inject(ProjectContextService).setFoundation({ uid: 'uid-cncf', slug: 'cncf', name: 'cncf' } as ProjectContext, false);
    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('metaLeadFormsEnabled', true);
    restored.componentRef.setInput('draft', saved);
    restored.componentRef.setInput('briefData', brief());
    restored.detectChanges();
    await restored.whenStable();
    expect(c(restored)['metaObjective']()).toBe('traffic');
    expect(c(restored)['metaLeadFormId']()).toBe('');
  });

  it('holds Create when the picker reports the held form as no longer active', async () => {
    const f = await mount(true);
    c(f)['onMetaLeadFormChange']('222');
    f.detectChanges();
    await f.whenStable();
    expect(c(f)['createBlockedReason']()).toContain(META_LEAD_FORM_INACTIVE_REFUSAL);
  });

  it('keeps Leads and the form of a draft restored before the foundation is known, once it resolves', STATE_ONLY, async () => {
    const f = await mount(true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaLeadFormChange']('111');
    f.detectChanges();
    await f.whenStable();
    f.destroy();

    const context = TestBed.inject(ProjectContextService);
    context.clearFoundation(false);
    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('metaLeadFormsEnabled', true);
    restored.componentRef.setInput('draft', saved);
    restored.componentRef.setInput('briefData', brief());
    let resaved: CampaignImplementationDraft | null = null;
    restored.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (resaved = d));
    restored.detectChanges();
    await restored.whenStable();
    // Saved meanwhile with its form and stamp, so a tab left before the foundation resolves loses nothing.
    expect(resaved).toMatchObject({ metaObjective: 'leads', metaLeadFormId: '111', metaLeadFormProject: 'tlf' });

    context.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    restored.detectChanges();
    await restored.whenStable();
    expect(c(restored)['metaObjective']()).toBe('leads');
    expect(c(restored)['metaLeadFormId']()).toBe('111');
  });

  it('keeps a form choice made before the foundation is known over the waiting draft', STATE_ONLY, async () => {
    const f = await mount(true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaLeadFormChange']('111');
    f.detectChanges();
    await f.whenStable();
    f.destroy();

    const context = TestBed.inject(ProjectContextService);
    context.clearFoundation(false);
    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('metaLeadFormsEnabled', true);
    restored.componentRef.setInput('draft', saved);
    restored.componentRef.setInput('briefData', brief());
    restored.detectChanges();
    await restored.whenStable();

    c(restored)['onMetaLeadFormChange']('333');
    context.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    restored.detectChanges();
    await restored.whenStable();
    expect(c(restored)['metaLeadFormId']()).toBe('333');
  });

  it('does not carry a draft waiting for the foundation into another brief', STATE_ONLY, async () => {
    const f = await mount(true);
    let saved: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (saved = d));
    c(f)['onMetaLeadFormChange']('111');
    f.detectChanges();
    await f.whenStable();
    f.destroy();

    const context = TestBed.inject(ProjectContextService);
    context.clearFoundation(false);
    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('metaLeadFormsEnabled', true);
    restored.componentRef.setInput('draft', saved);
    restored.componentRef.setInput('briefData', brief());
    restored.detectChanges();
    await restored.whenStable();

    restored.componentRef.setInput('draft', null);
    restored.componentRef.setInput('briefData', { ...brief(), eventDetails: { ...brief().eventDetails, name: 'OSS NA 2026', slug: 'oss-na-2026' } });
    restored.detectChanges();
    await restored.whenStable();
    context.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    restored.detectChanges();
    await restored.whenStable();
    expect(c(restored)['metaObjective']()).not.toBe('leads');
    expect(c(restored)['metaLeadFormId']()).toBe('');
  });
});
