// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CREATIVE_ASSET_WRONG_TYPE_MESSAGE, GOOGLE_ASSET_PLAN_SLOT_CONTROLS, GOOGLE_CREATIVE_FIELD_SPECS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { GOOGLE_BASE_DRAFT, SEED_KEYWORD, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The Google image slots' stored-image library (`googleAssetUploadEnabled`): picks and uploads ride
 * as `{ imageAssetId }` after the slot's pasted URLs, only images that fit are offered, and a held
 * image the request cannot carry blocks Create rather than vanishing.
 */
describe('ImplementationTabComponent google stored images', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const OTHER_BRIEF = '00000000-0000-4000-8000-000000000001';
  const SQUARE_LOGO = '11111111-0000-4000-8000-000000000001';
  const WIDE_LOGO = '22222222-0000-4000-8000-000000000002';
  const SMALL_WIDE = '33333333-0000-4000-8000-000000000003';
  const UPLOADED = '44444444-0000-4000-8000-000000000004';
  const SLOT = 'displayCreative.logoImages';

  const asset = (id: string, width?: number, height?: number) => ({
    id,
    projectId: 'p',
    briefId: BRIEF_ID,
    mimeType: 'image/png' as const,
    byteSize: 10,
    checksum: 'c',
    width,
    height,
  });
  const LIBRARY = [asset(SQUARE_LOGO, 400, 400), asset(WIDE_LOGO, 1200, 300), asset(SMALL_WIDE, 400, 100), asset('55555555-0000-4000-8000-000000000005')];

  let uploadCreativeAsset: ReturnType<typeof vi.fn>;
  let cancelCreativeAssetUpload: ReturnType<typeof vi.fn>;
  let listCreativeAssets: ReturnType<typeof vi.fn>;

  async function mount(
    upload: boolean | null,
    draft: Partial<CampaignImplementationDraft> = {}
  ): Promise<{ f: ComponentFixture<ImplementationTabComponent>; c: Record<string, any>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('draft', { ...GOOGLE_BASE_DRAFT, includeDisplay: true, ...draft } as unknown as CampaignImplementationDraft);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: BRIEF_ID, message: null, approved: true });
    f.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    f.detectChanges();
    const c = f.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: false, includePerformanceMax: false, includeVideo: false, includeDisplay: true });
    f.componentRef.setInput('demandGenEnabled', true);
    f.componentRef.setInput('googleChannelsEnabled', true);
    f.componentRef.setInput('googleCreativeEnabled', true);
    f.componentRef.setInput('googleAssetUploadEnabled', upload);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, c, latest: () => captured };
  }

  const q = (f: ComponentFixture<ImplementationTabComponent>, id: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const logos = (c: Record<string, any>): unknown => c['googleCreativePayload']()['displayCreative']?.['logoImages'];

  beforeEach(async () => {
    uploadCreativeAsset = vi.fn().mockReturnValue(of({ id: UPLOADED, mimeType: 'image/png', byteSize: 16, checksum: 'ab', created: true }));
    cancelCreativeAssetUpload = vi.fn();
    listCreativeAssets = vi.fn().mockReturnValue(of({ assets: LIBRARY, count: LIBRARY.length, countLimit: 50, bytesUsed: 40, bytesLimit: 1e9 }));

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
            createCampaign: vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } })),
            uploadCreativeAsset,
            resumeCreativeAssetUpload: vi.fn().mockReturnValue(null),
            forgetCreativeAssetUpload: vi.fn(),
            cancelCreativeAssetUpload,
            listCreativeAssets,
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
            // The conversion-action picker's read (#4991): this suite is about images, so the list
            // is empty.
            getGoogleAdsConversionActions: () => of({ accountId: '', actions: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it.each([
    ['unanswered', null],
    ['off', false],
  ])('renders no library controls and reads no library while the capability is %s', async (_label, upload) => {
    const { f, c } = await mount(upload);

    expect(c['googleImageSlots']()).toEqual({});
    expect(q(f, `google-image-library-${SLOT}`)).toBeNull();
    expect(listCreativeAssets).not.toHaveBeenCalled();
  });

  it('renders a library control on every image slot of the section, and none on a text field', async () => {
    const { f, c } = await mount(true);

    expect(Object.keys(c['googleImageSlots']())).toEqual([
      'displayCreative.marketingImages',
      'displayCreative.squareMarketingImages',
      'displayCreative.logoImages',
      'displayCreative.squareLogoImages',
    ]);
    expect(q(f, `google-image-library-${SLOT}`)).not.toBeNull();
    expect(listCreativeAssets).toHaveBeenCalledWith('tlf', BRIEF_ID);
  });

  /** Display's logo is 4:1 at 512x128: the square image, the undersized one and the unmeasured one are not offered. */
  it("offers only the stored images that fit the slot's ratio and minimum size", async () => {
    const { c } = await mount(true);

    const slot = c['googleImageSlots']()[SLOT];
    expect(slot.options.map((o: { value: string }) => o.value)).toEqual([WIDE_LOGO]);
    expect(slot.requirement).toBe('4:1 (within 1%), at least 512x128 px, up to 5 MB');
    expect(c['googleImageSlots']()['displayCreative.squareLogoImages'].options.map((o: { value: string }) => o.value)).toEqual([SQUARE_LOGO]);
  });

  it('sends a picked image as { imageAssetId } after the pasted URLs, and persists it in the draft', async () => {
    const { c, latest } = await mount(true);
    c['campaignForm'].controls.displayCreative.controls.logoImages.setValue('https://cdn.example.org/logo.png');
    c['onGoogleImagePick'](SLOT, WIDE_LOGO);

    expect(logos(c)).toEqual(['https://cdn.example.org/logo.png', { imageAssetId: WIDE_LOGO }]);
    expect(latest()?.googleImageAssets?.[SLOT]).toEqual([{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }]);
    expect(c['googleImageAssetBlock']()).toBeNull();
    // Picked, so no longer offered.
    expect(c['googleImageSlots']()[SLOT].options).toEqual([]);
  });

  it('counts a held image toward the slot minimum, as campaign-service does', async () => {
    const { c } = await mount(true, { includeDisplay: false, includePerformanceMax: true } as Partial<CampaignImplementationDraft>);
    c['campaignForm'].patchValue({ includeDisplay: false, includePerformanceMax: true });
    const pmax = c['campaignForm'].controls.performanceMaxCreative.controls;
    pmax.headlines.setValue('A\nB\nC');
    pmax.longHeadlines.setValue('Long');
    pmax.descriptions.setValue('Short one\nAnother');
    pmax.businessName.setValue('LF');
    pmax.marketingImages.setValue('https://cdn.example.org/m.png');
    pmax.squareMarketingImages.setValue('https://cdn.example.org/s.png');

    expect(c['googleCreativeError']()).toContain('Logo images');
    c['onGoogleImagePick']('performanceMaxCreative.logoImages', SQUARE_LOGO);
    expect(c['googleCreativeError']()).toBeNull();
  });

  it('uploads into the library for the saved brief and holds the upload in the slot it was chosen for', async () => {
    const { c } = await mount(true);
    const revision = c['creativeLibraryRevision']();
    const file = new File([new Uint8Array(16)], 'wide-logo.png', { type: 'image/png' });
    c['onGoogleImageUpload'](SLOT, file);

    expect(uploadCreativeAsset).toHaveBeenCalledWith(file, 'tlf', BRIEF_ID, 'google');
    expect(c['googleHeldImages']()[SLOT]).toEqual([{ id: UPLOADED, name: 'wide-logo.png', briefId: BRIEF_ID }]);
    expect(c['creativeLibraryRevision']()).toBe(revision + 1);
    expect(logos(c)).toEqual([{ imageAssetId: UPLOADED }]);
  });

  it('refuses a file that is not a PNG or JPEG before any upload, blocking Create until it is removed', async () => {
    const { c, latest } = await mount(true);
    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(4)], 'logo.gif', { type: 'image/gif' }));

    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    expect(c['googleImageSlots']()[SLOT].error).toBe(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
    // The operator chose a file for this slot: its refusal holds Create and survives a tab switch.
    expect(c['googleImageAssetBlock']()?.kind).toBe('uploadFailed');
    expect(latest()?.googleImageUploadFailedMessage).toBe(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
    expect(latest()?.googleImageUploadFailedSlot).toBe(SLOT);
    c['onGoogleImageBlockRemove']();
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  it('holds Create while an upload runs, and Cancel aborts the Google upload', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const { c } = await mount(true);
    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(16)], 'l.png', { type: 'image/png' }));

    expect(c['googleImageSlots']()[SLOT].uploading).toBe(true);
    expect(c['canSubmit']()).toBe(false);
    c['onGoogleImageUploadCancel']();
    expect(cancelCreativeAssetUpload).toHaveBeenCalledWith('google');
    expect(c['googleImageUploadStatus']()).toBe('idle');
  });

  it('blocks Create on a failed upload for the brief, until Remove', async () => {
    uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'image is not decodable' } })));
    const { f, c } = await mount(true);
    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(16)], 'l.png', { type: 'image/png' }));
    f.detectChanges();

    expect(c['googleImageAssetBlock']()?.kind).toBe('uploadFailed');
    expect(q(f, 'implementation-google-image-asset-block-uploadFailed')).not.toBeNull();
    expect(c['canSubmit']()).toBe(false);
    c['onGoogleImageBlockRemove']();
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  it.each([
    ['unanswered', null, 'failed'],
    ['off', false, 'unsupported'],
  ])('blocks Create, never drops, a held image while the capability is %s', async (_label, upload, kind) => {
    const { f, c } = await mount(upload, { googleImageAssets: { [SLOT]: [{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }] } });
    f.detectChanges();

    expect(logos(c)).toBeUndefined();
    expect(c['googleImageAssetBlock']()?.kind).toBe(kind);
    expect(q(f, `implementation-google-image-asset-block-${kind}`)).not.toBeNull();
    expect(c['canSubmit']()).toBe(false);

    c['onGoogleImageBlockRemove']();
    expect(c['googleHeldImages']()[SLOT]).toEqual([]);
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  it('blocks a held image stored for another brief, and Remove drops only that one', async () => {
    const { c } = await mount(true, {
      googleImageAssets: {
        [SLOT]: [
          { id: WIDE_LOGO, name: '', briefId: BRIEF_ID },
          { id: UPLOADED, name: 'old.png', briefId: OTHER_BRIEF },
        ],
      },
    });

    expect(c['googleImageAssetBlock']()?.kind).toBe('otherBrief');
    expect(logos(c)).toEqual([{ imageAssetId: WIDE_LOGO }]);
    c['onGoogleImageBlockRemove']();
    expect(c['googleHeldImages']()[SLOT]).toEqual([{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }]);
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  it.each([
    ['missing', '99999999-0000-4000-8000-000000000009'],
    ['misfit', SQUARE_LOGO],
  ])('blocks a held image the library read shows as %s, and Remove drops only that one', async (kind, id) => {
    const { c } = await mount(true, {
      googleImageAssets: {
        [SLOT]: [
          { id: WIDE_LOGO, name: '', briefId: BRIEF_ID },
          { id, name: '', briefId: BRIEF_ID },
        ],
      },
    });

    expect(c['googleImageAssetBlock']()?.kind).toBe(kind);
    expect(c['googleImageSlots']()[SLOT].held[1].problem).not.toBe('');
    expect(c['canSubmit']()).toBe(false);

    c['onGoogleImageBlockRemove']();
    expect(c['googleHeldImages']()[SLOT]).toEqual([{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }]);
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  it('refuses a slot whose pasted URLs and held images together pass its cap', async () => {
    const { c } = await mount(true);
    const display = c['campaignForm'].controls.displayCreative.controls;
    display.headlines.setValue('H1');
    display.longHeadline.setValue('Long');
    display.descriptions.setValue('D1');
    display.businessName.setValue('LF');
    display.marketingImages.setValue('https://cdn.example.org/m.png');
    display.squareMarketingImages.setValue('https://cdn.example.org/sq.png');
    c['onGoogleImagePick'](SLOT, WIDE_LOGO);
    display.logoImages.setValue(['1', '2', '3', '4', '5'].map((n) => `https://cdn.example.org/${n}.png`).join('\n'));

    expect(c['googleCreativeError']()).toBe(
      'Display creative has 6 entries in Logo images (4:1) (pasted URLs and stored images together) — 1 over the cap of 5.'
    );
    expect(c['canSubmit']()).toBe(false);
  });

  const FIVE_LOGO_URLS = ['1', '2', '3', '4', '5'].map((n) => `https://cdn.example.org/${n}.png`).join('\n');
  const DISPLAY_COPY = {
    headlines: 'H1',
    longHeadline: 'Long',
    descriptions: 'D1',
    businessName: 'LF',
    marketingImages: 'https://cdn.example.org/m.png',
    squareMarketingImages: 'https://cdn.example.org/sq.png',
  };

  /** A draft can carry an over-cap slot the controls could not have produced; Create must still refuse it. */
  it('refuses a restored draft whose slot is over its cap', async () => {
    const { c } = await mount(true, {
      googleCreatives: { displayCreative: { ...DISPLAY_COPY, logoImages: FIVE_LOGO_URLS } },
      googleImageAssets: { [SLOT]: [{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }] },
    });

    expect(c['googleCreativeError']()).toContain('1 over the cap of 5');
    expect(c['canSubmit']()).toBe(false);
  });

  /** An upload started before the slot filled lands after it did: the cap is judged on what is held, not on what was offered. */
  it('refuses a slot an upload completed into after it filled', async () => {
    const upload$ = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(upload$);
    const { c } = await mount(true, { googleCreatives: { displayCreative: { ...DISPLAY_COPY, logoImages: '' } } });
    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(16)], 'late.png', { type: 'image/png' }));
    c['campaignForm'].controls.displayCreative.controls.logoImages.setValue(FIVE_LOGO_URLS);
    expect(c['googleCreativeError']()).toBeNull();

    upload$.next({ id: UPLOADED, mimeType: 'image/png', byteSize: 16, checksum: 'ab', created: true });
    upload$.complete();

    expect(c['googleHeldImages']()[SLOT]).toEqual([{ id: UPLOADED, name: 'late.png', briefId: BRIEF_ID }]);
    expect(c['googleCreativeError']()).toContain('6 entries in Logo images (4:1)');
    expect(c['canSubmit']()).toBe(false);
  });

  it('does not block on a failed upload into a section the operator un-ticked', async () => {
    const { f, c } = await mount(true, {
      googleImageUploadFailedMessage: 'image is not decodable',
      googleImageUploadFailedBriefId: BRIEF_ID,
      googleImageUploadFailedSlot: SLOT,
    });
    expect(c['googleImageAssetBlock']()?.kind).toBe('uploadFailed');

    c['campaignForm'].patchValue({ includeDisplay: false, includePerformanceMax: true });
    f.detectChanges();
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  /** campaign-service's Google dispatcher holds at most 5 MiB per image, under the library's 10 MiB. */
  it('neither offers nor accepts an image over the Google byte cap, and refuses one before upload', async () => {
    const big = { ...asset('66666666-0000-4000-8000-000000000006', 1200, 300), byteSize: 6 * 1024 * 1024 };
    listCreativeAssets.mockReturnValue(of({ assets: [...LIBRARY, big], count: 5, countLimit: 50, bytesUsed: 1, bytesLimit: 1e9 }));
    const { c } = await mount(true, { googleImageAssets: { [SLOT]: [{ id: big.id, name: '', briefId: BRIEF_ID }] } });

    expect(c['googleImageSlots']()[SLOT].options.map((o: { value: string }) => o.value)).toEqual([WIDE_LOGO]);
    expect(c['googleImageAssetBlock']()?.kind).toBe('misfit');
    expect(c['googleImageSlots']()[SLOT].held[0].problem).toContain('up to 5 MB');

    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' }));
    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    expect(c['googleImageSlots']()[SLOT].error).toContain('up to 5 MB');
    expect(c['googleImageAssetBlock']()?.kind).toBe('uploadFailed');
  });

  it('stops holding Create for a running upload once its section is un-ticked', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const { f, c } = await mount(true);
    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(16)], 'l.png', { type: 'image/png' }));
    expect(c['googleImageUploadInReach']()).toBe(true);

    c['campaignForm'].patchValue({ includeDisplay: false, includePerformanceMax: true });
    f.detectChanges();
    expect(c['googleImageUploadInReach']()).toBe(false);
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  /** A failed re-save clears the brief id; held images then match no brief and must hold Create, not vanish. */
  it('blocks on held images while the brief id is unresolved, and Remove clears them', async () => {
    const { f, c } = await mount(true, { googleImageAssets: { [SLOT]: [{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }] } });
    f.componentRef.setInput('briefPersistence', { status: 'error', briefId: null, message: 'save failed', approved: true });
    f.detectChanges();

    expect(c['googleImageAssetBlock']()?.kind).toBe('unsaved');
    expect(c['canSubmit']()).toBe(false);
    c['onGoogleImageBlockRemove']();
    expect(c['googleHeldImages']()[SLOT]).toEqual([]);
    expect(c['googleImageAssetBlock']()).toBeNull();
  });

  /** One slug source for the read and the upload, so an upload lands in the library the slot reads. */
  it('uploads under the same project slug the library read uses', async () => {
    const { c } = await mount(true);
    c['onGoogleImageUpload'](SLOT, new File([new Uint8Array(16)], 'l.png', { type: 'image/png' }));

    expect(uploadCreativeAsset.mock.calls[0][1]).toBe(c['activeFoundationSlug']());
    expect(listCreativeAssets.mock.calls[0][0]).toBe(c['activeFoundationSlug']());
  });

  /** A failed read is not evidence of a deletion: campaign-service still refuses a missing asset by name. */
  it('does not call a held image missing when the library read failed', async () => {
    listCreativeAssets.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const { c } = await mount(true, { googleImageAssets: { [SLOT]: [{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }] } });

    expect(c['googleCreativeLibrary']().status).toBe('error');
    expect(c['googleImageAssetBlock']()).toBeNull();
    expect(c['googleImageSlots']()[SLOT].optionsNote).toContain("Couldn't load");
  });

  it('keeps an image held in an un-ticked section without sending or blocking on it', async () => {
    const { c } = await mount(true, { googleImageAssets: { 'demandGenCreative.logoImages': [{ id: SQUARE_LOGO, name: '', briefId: OTHER_BRIEF }] } });

    expect(c['googleImageAssetBlock']()).toBeNull();
    expect(c['googleCreativePayload']()['demandGenCreative']).toBeUndefined();
    expect(c['googleHeldImages']()['demandGenCreative.logoImages']).toHaveLength(1);
  });

  it('restores a failed upload from the draft, so a tab switch does not lift its block', async () => {
    const { c } = await mount(true, {
      googleImageUploadFailedMessage: 'image is not decodable',
      googleImageUploadFailedBriefId: BRIEF_ID,
      googleImageUploadFailedSlot: SLOT,
    });

    expect(c['googleImageAssetBlock']()?.kind).toBe('uploadFailed');
    expect(c['googleImageSlots']()[SLOT].error).toBe('image is not decodable');
  });

  /** "Use suggested images" (#4825): the asset plan's assignments fill only EMPTY, rendered Google image fields. */
  describe('applying the asset plan', () => {
    const assignment = (slot: string, assetIds: string[], channel = 'DISPLAY', platform = 'google-ads') => ({
      slotKey: `${platform}/${channel}/${slot}`,
      platform,
      channel,
      slot,
      label: slot,
      requirement: '',
      assetIds,
      minCount: 0,
      maxCount: 5,
    });

    it('fills empty rendered fields and reports how many', async () => {
      const { c, latest } = await mount(true);
      c['onApplySuggestedGoogleImages']([assignment('logoImages', [WIDE_LOGO]), assignment('squareLogoImages', [SQUARE_LOGO])]);

      expect(logos(c)).toEqual([{ imageAssetId: WIDE_LOGO }]);
      expect(c['googleCreativePayload']()['displayCreative']['squareLogoImages']).toEqual([{ imageAssetId: SQUARE_LOGO }]);
      expect(latest()?.googleImageAssets?.[SLOT]).toEqual([{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }]);
      expect(c['googleSuggestedApplyResult']()).toBe('Filled 2 empty image slots with suggested images.');
    });

    it('leaves a field the operator filled — by a pick or a pasted URL — exactly as it is', async () => {
      const { c } = await mount(true);
      c['onGoogleImagePick'](SLOT, SQUARE_LOGO);
      c['campaignForm'].controls.displayCreative.controls.squareLogoImages.setValue('https://cdn.example.org/square.png');
      c['onApplySuggestedGoogleImages']([
        assignment('logoImages', [WIDE_LOGO]),
        assignment('squareLogoImages', [SQUARE_LOGO]),
        assignment('marketingImages', [UPLOADED]),
      ]);

      expect(logos(c)).toEqual([{ imageAssetId: SQUARE_LOGO }]);
      expect(c['googleCreativePayload']()['displayCreative']['squareLogoImages']).toEqual(['https://cdn.example.org/square.png']);
      expect(c['googleCreativePayload']()['displayCreative']['marketingImages']).toEqual([{ imageAssetId: UPLOADED }]);
      expect(c['googleSuggestedApplyResult']()).toBe('Filled 1 empty image slot with suggested images. Left 2 slots you had already filled as they were.');
    });

    /** The running upload's file is held when it lands, so filling the field now would put it over its max. */
    it('leaves a field with an upload still running as it is', async () => {
      const { c } = await mount(true);
      c['googleImageUploadStatus'].set('uploading');
      c['googleImageUploadSlot'].set(SLOT);
      expect(c['googleImageSlots']()[SLOT].uploading).toBe(true);

      c['onApplySuggestedGoogleImages']([assignment('logoImages', [WIDE_LOGO]), assignment('squareLogoImages', [SQUARE_LOGO])]);

      expect(logos(c)).toBeUndefined();
      expect(c['googleCreativePayload']()['displayCreative']['squareLogoImages']).toEqual([{ imageAssetId: SQUARE_LOGO }]);
      expect(c['googleSuggestedApplyResult']()).toBe('Filled 1 empty image slot with suggested images. Left 1 slot you had already filled as it was.');
    });

    it('fills nothing for another channel, another platform, or a field not on screen', async () => {
      const { c, latest } = await mount(true);
      c['onApplySuggestedGoogleImages']([
        // A real Performance Max slot, mapped, but Performance Max is not the type on screen.
        assignment('LOGO', [WIDE_LOGO], 'PERFORMANCE_MAX'),
        assignment('logoImages', [WIDE_LOGO], 'DISPLAY', 'meta-ads'),
        assignment('youtubeVideoIds', ['x'], 'DISPLAY'),
      ]);

      expect(logos(c)).toBeUndefined();
      expect(latest()?.googleImageAssets?.[SLOT] ?? []).toEqual([]);
      expect(c['googleHeldImages']()['performanceMaxCreative.logoImages'] ?? []).toEqual([]);
      expect(c['googleSuggestedApplyResult']()).toBe('No suggested images to apply: no Google image field on screen has a suggestion.');
    });

    it('caps a field at its own catalogued max', async () => {
      const { c } = await mount(true);
      const max = GOOGLE_CREATIVE_FIELD_SPECS.display.find((f) => f.control === 'logoImages')?.max ?? 0;
      const many = Array.from({ length: max + 2 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
      c['onApplySuggestedGoogleImages']([assignment('logoImages', many)]);

      expect((logos(c) as unknown[]).length).toBe(max);
    });

    it('says when every suggested field was already filled, and pressing again changes nothing', async () => {
      const { c } = await mount(true);
      c['onApplySuggestedGoogleImages']([assignment('logoImages', [WIDE_LOGO])]);
      c['onApplySuggestedGoogleImages']([assignment('logoImages', [SQUARE_LOGO])]);
      // Each apply bumps the sequence, so the grid announces a repeated sentence again.
      expect(c['googleSuggestedApplySeq']()).toBe(2);

      expect(logos(c)).toEqual([{ imageAssetId: WIDE_LOGO }]);
      expect(c['googleSuggestedApplyResult']()).toBe('Nothing to fill: every image field with a suggestion already has images.');
    });

    /** The slot grid reads the library only; the tab tells it what the form already holds, by plan slot (#4833). */
    it('counts pasted URLs and images held for the open brief per plan slot, for the grid', async () => {
      const { c } = await mount(true);
      expect(c['googleFormFilledSlots']()).toEqual({});

      c['campaignForm'].controls.displayCreative.controls.logoImages.setValue('https://cdn.example.org/a.png\nhttps://cdn.example.org/b.png');
      c['onGoogleImagePick']('displayCreative.logoImages', WIDE_LOGO);
      c['onGoogleImagePick']('displayCreative.squareLogoImages', SQUARE_LOGO);
      // Held for another brief: not sent, so not counted.
      c['googleHeldImages'].update((held: Record<string, unknown[]>) => ({
        ...held,
        'displayCreative.marketingImages': [{ id: UPLOADED, name: '', briefId: OTHER_BRIEF }],
      }));

      expect(c['googleFormFilledSlots']()).toEqual({
        'google-ads/DISPLAY/logoImages': 3,
        'google-ads/DISPLAY/squareLogoImages': 1,
      });
    });

    /** Pasted URLs fill a slot whatever the library answers; held images count only where the request would send them. */
    it('counts pasted URLs with the library off, and ignores held images it would not send', async () => {
      const { c } = await mount(false);
      c['campaignForm'].controls.displayCreative.controls.marketingImages.setValue('https://cdn.example.org/wide.png');
      c['googleHeldImages'].update((held: Record<string, unknown[]>) => ({
        ...held,
        'displayCreative.logoImages': [{ id: WIDE_LOGO, name: '', briefId: BRIEF_ID }],
      }));

      expect(c['googleFormFilledSlots']()).toEqual({ 'google-ads/DISPLAY/marketingImages': 1 });
    });

    /** Performance Max names its slots by Google asset field type; the table maps them onto the request's fields. */
    it("maps Performance Max's asset field types onto its fields", async () => {
      const { f, c } = await mount(true);
      c['campaignForm'].patchValue({ includeDisplay: false, includePerformanceMax: true });
      f.detectChanges();
      c['onApplySuggestedGoogleImages']([
        assignment('MARKETING_IMAGE', [WIDE_LOGO], 'PERFORMANCE_MAX'),
        assignment('marketingImages', [SQUARE_LOGO], 'PERFORMANCE_MAX'),
      ]);

      expect(c['googleCreativePayload']()['performanceMaxCreative']['marketingImages']).toEqual([{ imageAssetId: WIDE_LOGO }]);
    });

    /** #5262: Search's plan slots carry the request's own names, so the table maps them one to one. */
    it("fills Search's ad image and business logo fields from the plan, and offers its three slots", async () => {
      const { f, c } = await mount(true);
      c['campaignForm'].patchValue({ includeDisplay: false, includeSearch: true });
      f.detectChanges();

      expect(c['googleSuggestionTargets']()).toEqual([
        'google-ads/SEARCH/adImages',
        'google-ads/SEARCH/landscapeAdImages',
        'google-ads/SEARCH/businessLogoImages',
      ]);
      c['onApplySuggestedGoogleImages']([assignment('adImages', [SQUARE_LOGO], 'SEARCH'), assignment('businessLogoImages', [SQUARE_LOGO], 'SEARCH')]);

      expect(c['googleCreativePayload']()['searchAssets']).toEqual({
        adImages: [{ imageAssetId: SQUARE_LOGO }],
        businessLogoImages: [{ imageAssetId: SQUARE_LOGO }],
      });
      expect(c['googleFormFilledSlots']()).toEqual({ 'google-ads/SEARCH/adImages': 1, 'google-ads/SEARCH/businessLogoImages': 1 });
    });

    it('maps every planned slot onto an image field of its own channel', () => {
      for (const [channel, slots] of Object.entries(GOOGLE_ASSET_PLAN_SLOT_CONTROLS)) {
        const imageControls = (
          GOOGLE_CREATIVE_FIELD_SPECS[channel as keyof typeof GOOGLE_CREATIVE_FIELD_SPECS] as readonly { control: string; image?: unknown }[]
        )
          .filter((field) => field.image)
          .map((field) => field.control);
        for (const control of Object.values(slots)) {
          expect(imageControls, `${channel} ${control}`).toContain(control);
        }
      }
    });

    it('offers suggestions only while a Google image field is on screen, and drops the result on a brief switch', async () => {
      const { f, c } = await mount(true);
      // Display on screen: its four image fields, in the plan's own vocabulary.
      expect(c['googleSuggestionTargets']()).toEqual([
        'google-ads/DISPLAY/marketingImages',
        'google-ads/DISPLAY/squareMarketingImages',
        'google-ads/DISPLAY/logoImages',
        'google-ads/DISPLAY/squareLogoImages',
      ]);
      c['onApplySuggestedGoogleImages']([assignment('logoImages', [WIDE_LOGO])]);
      expect(c['googleSuggestedApplyResult']()).not.toBe('');

      f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: OTHER_BRIEF, message: null, approved: true });
      f.detectChanges();
      expect(c['googleSuggestedApplyResult']()).toBe('');

      const off = await mount(false);
      expect(off.c['googleSuggestionTargets']()).toEqual([]);
    });
  });
});
