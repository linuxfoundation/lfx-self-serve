// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
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
 * Wiring only (#6331). What a carousel sends, when Create waits, how cards are seeded and how a stored draft is read are
 * rules in `campaign-meta-carousel.utils.ts`, `campaign-meta-form.utils.ts` and `campaign-meta-draft.utils.ts`, tested
 * there; the editor is tested in its own spec. Here: the cards reach the request, the capability gates it, the draft
 * round-trip, and the editor replacing the one image and the variant preview.
 */
describe('ImplementationTabComponent meta carousel', () => {
  const foundation = signal({ slug: 'tlf' });
  let createCampaign: ReturnType<typeof vi.fn>;

  const brief = {
    eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
    totalBudget: 500,
    selectedPlatforms: ['meta-ads'],
    metaCopy: {
      variants: [
        { primaryText: 'Join us', headline: 'Keynotes', description: '' },
        { primaryText: 'Other', headline: 'Workshops', description: 'Hands on' },
      ],
      recommendedGeos: ['US'],
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
    f.componentRef.setInput('createCapabilityRead', 'ready');
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('metaCreativeEnabled', true);
    f.componentRef.setInput('metaCarouselEnabled', true);
    if (draft !== null) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief);
    c(f)['selectedPlatforms'].set(['meta-ads']);
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
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  /** Choose carousel and give each seeded card an image URL. */
  const carousel = (f: ComponentFixture<ImplementationTabComponent>): void => {
    c(f)['onMetaFormatSelect']('carousel');
    const cards: Record<string, unknown>[] = c(f)['metaCarouselCards']();
    c(f)['onMetaCarouselCardsChange'](cards.map((card, i) => ({ ...card, imageUrl: `https://cdn/${i}.png` })));
  };
  const sent = (): Record<string, unknown> => createCampaign.mock.calls.at(-1)?.[0]['metaConfig'];

  it('sends single ads as before, the cards as variants once chosen, and nothing while the capability is off', STATE_ONLY, async () => {
    const { f } = await mount();
    c(f)['submit']();
    expect(sent()).not.toHaveProperty('format');

    c(f)['onMetaFormatSelect']('carousel');
    expect(c(f)['createBlockedReason']()).toBe('Meta Ads: Card 1 of a carousel needs an image.');
    expect(c(f)['metaObjectiveOptions']()).not.toContain('leads');
    carousel(f);
    c(f)['submit']();
    expect(sent()).toMatchObject({
      format: 'carousel',
      variants: [
        { primaryText: 'Join us', headline: 'Keynotes', imageUrl: 'https://cdn/0.png' },
        { primaryText: '', headline: 'Workshops', description: 'Hands on', imageUrl: 'https://cdn/1.png' },
      ],
    });

    f.componentRef.setInput('metaCarouselEnabled', false);
    expect(c(f)['createBlockedReason']()).toContain('carousel ads are not available');
    c(f)['submit']();
    expect(createCampaign).toHaveBeenCalledTimes(2);
  });

  it('saves the format, cards and message in the draft, and holds a restored carousel the deployment no longer offers', STATE_ONLY, async () => {
    const first = await mount();
    carousel(first.f);
    c(first.f)['onMetaCarouselMessageChange']('Meet the speakers');
    const saved = first.latest();
    expect(saved).toMatchObject({ metaFormat: 'carousel', metaCarouselMessage: 'Meet the speakers' });
    expect(saved?.metaCarouselCards).toHaveLength(2);
    first.f.destroy();

    const { f } = await mount(saved);
    expect(c(f)['metaCarouselSelected']()).toBe(true);
    expect(c(f)['metaCarouselCards']()[1].imageUrl).toBe('https://cdn/1.png');

    f.componentRef.setInput('metaCarouselEnabled', null);
    expect(c(f)['metaCarouselSelected']()).toBe(false);
    expect(c(f)['createBlockedReason']()).toContain('carousel ads are not available');
  });

  it('shows the card editor in place of the one image and the variant preview', async () => {
    const { f } = await mount();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="implementation-meta-image"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="implementation-meta-carousel"]')).toBeNull();

    c(f)['onMetaFormatSelect']('carousel');
    f.detectChanges();
    expect(el.querySelector('[data-testid="implementation-meta-carousel"] [data-testid="meta-carousel-editor-card-1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="implementation-meta-image"]')).toBeNull();
    expect(el.querySelector('[data-testid="implementation-meta-variant-0"]')).toBeNull();
  });
});
