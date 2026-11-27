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
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Wiring only (#6332). Which variant sends which video, the picker's options, when the videos hold Create and how a stored
 * draft is read are rules in `campaign-meta-video-form.utils.ts` and `campaign-meta-video.utils.ts`, tested there. Here:
 * the capability gates the video into the request and the Create hold, the draft round-trips through the bindings, and
 * the picker replaces the one image once every variant is a video ad.
 */
describe('ImplementationTabComponent meta video', () => {
  const A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const foundation = signal({ slug: 'tlf' });
  let createCampaign: ReturnType<typeof vi.fn>;
  let upload$: Subject<{ id: string; mimeType: string }>;
  let cancelUpload: ReturnType<typeof vi.fn>;

  const brief = {
    eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
    totalBudget: 500,
    selectedPlatforms: ['meta-ads'],
    metaCopy: {
      variants: [
        { primaryText: 'Join us', headline: 'Keynotes', description: '' },
        { primaryText: 'Other', headline: 'Workshops', description: '' },
      ],
      recommendedGeos: ['US'],
    },
    keywords: [],
    hsUtm: null,
    driveFolderUrl: '',
  } as unknown as CampaignBriefOutput;
  const c = (f: ComponentFixture<ImplementationTabComponent>): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  async function mount(
    video: boolean | null,
    draft: CampaignImplementationDraft | null = null
  ): Promise<{ f: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    let captured: CampaignImplementationDraft | null = null;
    f.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('createCapabilityRead', 'ready');
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true });
    f.componentRef.setInput('metaCreativeEnabled', true);
    f.componentRef.setInput('metaVideoEnabled', video);
    if (draft !== null) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief);
    c(f)['selectedPlatforms'].set(['meta-ads']);
    f.detectChanges();
    await f.whenStable();
    c(f)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c(f)['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c(f)['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c(f)['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c(f)['metaImageUrl'].set('https://cdn/x.png');
    f.detectChanges();
    return { f, latest: () => captured };
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    upload$ = new Subject();
    cancelUpload = vi.fn();
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
            creativeVideoDeleting: signal(null),
            uploadCreativeAsset: () => upload$,
            forgetCreativeAssetUpload: vi.fn(),
            cancelCreativeAssetUpload: cancelUpload,
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
            listCreativeAssets: () => of({ assets: [], documents: [], videos: [{ id: A, byteSize: 1, checksum: 'abcdef0123' }] }),
          },
        },
      ],
    }).compileComponents();
  });

  const sent = (): Record<string, any> => createCampaign.mock.calls.at(-1)?.[0]['metaConfig'];

  it('sends the picked video in place of its image only on a yes, and holds Create on a lead form or once withdrawn', STATE_ONLY, async () => {
    const { f } = await mount(true);
    c(f)['onMetaVariantVideoPick'](1, A);
    c(f)['submit']();
    expect(sent()['variants']).toEqual([
      { primaryText: 'Join us', headline: 'Keynotes', description: '', imageUrl: 'https://cdn/x.png' },
      { primaryText: 'Other', headline: 'Workshops', description: '', videoAssetId: A },
    ]);

    f.componentRef.setInput('metaLeadFormsEnabled', true);
    c(f)['metaObjective'].set('leads');
    c(f)['metaLeadFormId'].set('123');
    expect(c(f)['createBlockedReason']()).toBe('Meta Ads: A video ad cannot use a lead form. Remove the lead form, or use an image on variant 2.');
    c(f)['metaObjective'].set('traffic');

    f.componentRef.setInput('metaVideoEnabled', null);
    expect(c(f)['createBlockedReason']()).toContain('video ads are not available');
    c(f)['onMetaVariantVideoPick'](1, '');
    c(f)['submit']();
    expect(sent()['variants'][1]).toEqual({ primaryText: 'Other', headline: 'Workshops', description: '', imageUrl: 'https://cdn/x.png' });
  });

  const mp4 = (): { files: File[] } => ({ files: [new File([new Uint8Array(8)], 'promo.mp4', { type: 'video/mp4' })] });

  it('holds Create while a variant video uploads, puts it on that variant, and re-reads the library on a delete', STATE_ONLY, async () => {
    const { f } = await mount(true);
    const uploader = { clear: vi.fn() };
    c(f)['onMetaVariantVideoFileSelect'](1, mp4(), uploader);
    expect(uploader.clear).toHaveBeenCalled();
    expect(c(f)['createBlockedReason']()).toBe('Waiting for the Meta Ads video upload to finish.');
    expect(c(f)['metaVideoPickerHeld']()).toBe(true);

    upload$.next({ id: A, mimeType: 'video/mp4' });
    expect(c(f)['metaVariantVideos']()[1]).toEqual({ assetId: A, assetName: 'promo.mp4', assetBriefId: 'b-1' });
    c(f)['onMetaVariantVideoPick'](0, A);
    expect(c(f)['metaVariantVideos']()[0].assetName).toBe('promo.mp4');
    expect(c(f)['createBlockedReason']()).toBeNull();

    const revision = c(f)['creativeLibraryRevision']();
    c(f)['onStoredVideoDeleted'](A);
    expect(c(f)['creativeLibraryRevision']()).toBe(revision + 1);
    const videos: { assetId: string }[] = c(f)['metaVariantVideos']();
    expect(videos.map((video) => video.assetId)).toEqual(['', '']);
  });

  it("lets go of an older brief's video upload on a brief switch, cancelling it", STATE_ONLY, async () => {
    const { f } = await mount(true);
    c(f)['onMetaVariantVideoFileSelect'](0, mp4());
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-2', message: null, approved: true });
    expect(c(f)['createBlockedReason']()).not.toBe('Waiting for the Meta Ads video upload to finish.');
    expect(c(f)['metaVariantVideoViews']()[0].uploading).toBe(false);

    c(f)['resetMetaFields']();
    expect(cancelUpload).toHaveBeenCalledWith('meta-video');
  });

  it('saves the picked videos in the draft and restores them through the bindings', STATE_ONLY, async () => {
    const first = await mount(true);
    c(first.f)['onMetaVariantVideoPick'](0, A);
    const saved = first.latest();
    expect(saved?.metaVariantVideos).toEqual([{ assetId: A, assetName: '', assetBriefId: 'b-1' }]);
    first.f.destroy();

    const { f } = await mount(true, saved);
    expect(c(f)['metaVariantVideoViews']()[0].assetId).toBe(A);
    c(f)['submit']();
    expect(sent()['variants'][0]).toMatchObject({ videoAssetId: A });
    expect(sent()['variants'][0]).not.toHaveProperty('imageUrl');
  });

  it('shows the video pickers only on a yes, and hides the one image once every variant is a video ad', async () => {
    const off = await mount(false);
    const offEl = off.f.nativeElement as HTMLElement;
    expect(offEl.querySelector('[data-testid="implementation-meta-variant-video-0"]')).toBeNull();
    expect(offEl.querySelector('[data-testid="implementation-meta-image"]')).not.toBeNull();
    off.f.destroy();

    const { f } = await mount(true);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="implementation-meta-variant-video-pick-1"]')).not.toBeNull();
    c(f)['onMetaVariantVideoPick'](0, A);
    c(f)['onMetaVariantVideoPick'](1, A);
    f.detectChanges();
    expect(el.querySelector('[data-testid="implementation-meta-image"]')).toBeNull();
    expect(el.querySelector('[data-testid="implementation-meta-variant-image-0"]')).toBeNull();
  });
});
