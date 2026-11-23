// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  CampaignBriefOutput,
  CampaignIndexDoc,
  CampaignJobOutcome,
  CampaignBriefPersistenceState,
  CampaignImplementationDraft,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { SEED_KEYWORD, stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Microsoft flight dates, behind `microsoftScheduleEnabled`
 * (`LFX_CUTOVER_CAMPAIGN_SERVICE_MICROSOFT_SCHEDULE`).
 *
 * Asserted on what `createCampaign` is CALLED with, because the guarantee that matters is the wire
 * shape: `startDate` / `endDate` on `microsoftConfig` exactly as on `metaConfig` on an explicit yes,
 * and absent otherwise — a campaign-service without #409 drops them, and the create route refuses
 * them while the capability is off.
 */
describe('ImplementationTabComponent microsoft flight dates', () => {
  let createCampaign: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads', 'microsoft-ads'],
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
      metaCopy: {
        variants: [{ primaryText: 'Brief primary', headline: 'Brief meta headline', description: 'Brief description' }],
        recommendedGeos: ['US'],
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  function component(f: ComponentFixture<ImplementationTabComponent> = fixture): Record<string, any> {
    return f.componentInstance as unknown as Record<string, any>;
  }

  function query(testId: string, f: ComponentFixture<ImplementationTabComponent> = fixture): HTMLElement | null {
    return f.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function mount(schedule: boolean | null | undefined): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    if (schedule !== undefined) f.componentRef.setInput('microsoftScheduleEnabled', schedule);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    const c = component(f);
    c['selectedPlatforms'].set(['meta-ads', 'microsoft-ads']);
    c['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c['addMicrosoftKeyword']('service mesh');
    f.detectChanges();
    await f.whenStable();
    return f;
  }

  async function submitted(f: ComponentFixture<ImplementationTabComponent> = fixture): Promise<Record<string, Record<string, unknown>>> {
    expect(component(f)['canSubmit']()).toBe(true);
    component(f)['submit']();
    await f.whenStable();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[createCampaign.mock.calls.length - 1][0];
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
        { provide: CampaignService, useValue: { createCampaign, getLinkedInAccounts: () => of([]), getLinkedInTargetingProfiles: () => of([]) } },
      ],
    }).compileComponents();
  });

  describe.each([
    ['unanswered', undefined],
    ['null', null],
    ['false', false],
  ])('while the capability is %s', (_label, schedule) => {
    it('keeps the warning that Microsoft ignores the flight dates', async () => {
      fixture = await mount(schedule);

      expect(query('implementation-microsoft-no-flight')?.textContent).toContain('Microsoft campaigns are created paused and ignore the flight dates above');
      expect(query('implementation-microsoft-flight')).toBeNull();
    });

    it('sends no flight dates on microsoftConfig, so the create is unchanged', async () => {
      fixture = await mount(schedule);

      const request = await submitted();

      expect(Object.keys(request['microsoftConfig'])).not.toContain('startDate');
      expect(Object.keys(request['microsoftConfig'])).not.toContain('endDate');
      // Meta's are untouched by this capability.
      expect(request['metaConfig']['startDate']).toBe('2026-09-01');
      expect(request['metaConfig']['endDate']).toBe('2026-09-30');
    });
  });

  describe('while the capability is an explicit yes', () => {
    it('replaces the warning with a note that the dates are applied', async () => {
      fixture = await mount(true);

      expect(query('implementation-microsoft-no-flight')).toBeNull();
      expect(query('implementation-microsoft-flight')?.textContent).toContain('The flight dates above are applied to the Microsoft ad group.');
    });

    it('sends the form flight dates on microsoftConfig exactly as metaConfig carries them', STATE_ONLY, async () => {
      fixture = await mount(true);

      const request = await submitted();

      expect(request['microsoftConfig']['startDate']).toBe('2026-09-01');
      expect(request['microsoftConfig']['endDate']).toBe('2026-09-30');
      expect(request['microsoftConfig']['startDate']).toBe(request['metaConfig']['startDate']);
      expect(request['microsoftConfig']['endDate']).toBe(request['metaConfig']['endDate']);
    });

    it('stops sending them, and restores the warning, when the capability is withdrawn', async () => {
      fixture = await mount(true);
      fixture.componentRef.setInput('microsoftScheduleEnabled', null);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('implementation-microsoft-no-flight')).not.toBeNull();
      const request = await submitted();
      expect(Object.keys(request['microsoftConfig'])).not.toContain('startDate');
      expect(Object.keys(request['microsoftConfig'])).not.toContain('endDate');
    });
  });
});

/**
 * The Microsoft image extension: one upload, sent as `microsoftConfig.imageAssetId`. Offered on an
 * explicit yes from `microsoftAssetUploadEnabled`, and checked against Microsoft's 76,800-byte limit,
 * far below the shared upload cap, before anything is stored.
 */
describe('ImplementationTabComponent microsoft image extension', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const ASSET_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  let createCampaign: ReturnType<typeof vi.fn>;
  let uploadCreativeAsset: ReturnType<typeof vi.fn>;
  let resumeCreativeAssetUpload: ReturnType<typeof vi.fn>;
  let cancelCreativeAssetUpload: ReturnType<typeof vi.fn>;

  interface Internals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    selectedPlatforms: { set(v: string[]): void };
    addMicrosoftKeyword(text: string): void;
    microsoftImageAssetId: () => string;
    microsoftImageUploadStatus: () => string;
    canSubmit: () => boolean;
    submit(): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;
  const q = (f: ComponentFixture<ImplementationTabComponent>, id: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (f: ComponentFixture<ImplementationTabComponent>, id: string): void => {
    (q(f, id)?.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
  };

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['microsoft-ads'],
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  async function mount(
    upload: boolean | null,
    draft: CampaignImplementationDraft | null = null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('microsoftAssetUploadEnabled', upload);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: BRIEF_ID, message: null, approved: true });
    f.componentRef.setInput('briefData', brief());
    at(f).selectedPlatforms.set(['microsoft-ads']);
    f.detectChanges();
    await f.whenStable();
    return { fixture: f, latest: () => captured };
  }

  /** Picks the file and lets the pixel-size read (a promise) settle before the upload starts. */
  async function choose(f: ComponentFixture<ImplementationTabComponent>, file: File): Promise<void> {
    const input = q(f, 'implementation-microsoft-image-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve));
    f.detectChanges();
  }

  const png = (size = 16): File => new File([new Uint8Array(size)], 'promo.png', { type: 'image/png' });

  async function uploadedDraft(): Promise<CampaignImplementationDraft> {
    const first = await mount(true);
    await choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
    first.fixture.destroy();
    return draft;
  }

  function fillForm(f: ComponentFixture<ImplementationTabComponent>): void {
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.addMicrosoftKeyword('service mesh');
    f.detectChanges();
  }

  function submitConfig(f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown> {
    fillForm(f);
    at(f).submit();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[0][0]['microsoftConfig'] as Record<string, unknown>;
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    uploadCreativeAsset = vi.fn().mockReturnValue(of({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true }));
    resumeCreativeAssetUpload = vi.fn().mockReturnValue(null);
    cancelCreativeAssetUpload = vi.fn();

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
            uploadCreativeAsset,
            resumeCreativeAssetUpload,
            forgetCreativeAssetUpload: vi.fn(),
            cancelCreativeAssetUpload,
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it.each([
    ['unanswered', null],
    ['off', false],
  ])('renders no upload while the Microsoft upload capability is %s, and sends no imageAssetId', async (_label, upload) => {
    const f = (await mount(upload)).fixture;

    expect(q(f, 'implementation-microsoft-image-file')).toBeNull();
    expect('imageAssetId' in submitConfig(f)).toBe(false);
  });

  it('uploads the chosen image for the saved brief and sends its asset id on microsoftConfig', async () => {
    const f = (await mount(true)).fixture;
    const file = png();
    await choose(f, file);

    expect(uploadCreativeAsset).toHaveBeenCalledWith(file, 'tlf', BRIEF_ID, 'microsoft');
    expect(at(f).microsoftImageAssetId()).toBe(ASSET_ID);
    expect(q(f, 'implementation-microsoft-image-status')?.textContent).toContain('Uploaded: promo.png');
    expect(submitConfig(f)['imageAssetId']).toBe(ASSET_ID);
  });

  it('refuses a file that is not a PNG or JPEG before any upload', async () => {
    const f = (await mount(true)).fixture;
    await choose(f, new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' }));

    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    expect(at(f).microsoftImageUploadStatus()).toBe('error');
  });

  it("refuses an image over Microsoft's 76,800-byte limit before any upload, with a message naming the limit", async () => {
    const f = (await mount(true)).fixture;
    await choose(f, png(76_801));

    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    expect(at(f).microsoftImageUploadStatus()).toBe('error');
    expect(q(f, 'implementation-microsoft-image-error')?.textContent).toContain('76,800 bytes');
  });

  it.each([
    ['an oversized image', () => png(76_801)],
    ['a file that is not a PNG or JPEG', () => new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' })],
  ])('blocks Create after %s replaces an uploaded one, and keeps the reason across a tab switch', async (_label, file) => {
    const first = await mount(true);
    fillForm(first.fixture);
    await choose(first.fixture, png());
    await choose(first.fixture, file());

    expect(q(first.fixture, 'implementation-microsoft-image-asset-block-uploadFailed')).not.toBeNull();
    expect(at(first.fixture).canSubmit()).toBe(false);
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
    expect(draft.microsoftImageUploadFailedBriefId).toBe(BRIEF_ID);
    first.fixture.destroy();

    const second = (await mount(true, draft)).fixture;
    expect(q(second, 'implementation-microsoft-image-asset-block-uploadFailed')).not.toBeNull();
    expect(at(second).canSubmit()).toBe(false);
  });

  it('suggests removing the image, not pasting a URL, when the image service is unavailable', async () => {
    uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const f = (await mount(true)).fixture;
    await choose(f, png());

    expect(q(f, 'implementation-microsoft-image-error')?.textContent).toContain('remove the image to continue without it');
  });

  describe('pixel bounds', () => {
    afterEach(() => vi.unstubAllGlobals());
    const stubSize = (width: number, height: number): void => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close: vi.fn() }));
    };

    it.each([
      [10, 10],
      [39, 20],
      [40, 19],
      [2593, 2048],
      [2592, 2049],
    ])('refuses a %ix%i image before any upload, and blocks Create', async (width, height) => {
      stubSize(width, height);
      const f = (await mount(true)).fixture;
      fillForm(f);
      await choose(f, png());

      expect(uploadCreativeAsset).not.toHaveBeenCalled();
      expect(q(f, 'implementation-microsoft-image-error')?.textContent).toContain(`this one is ${width}x${height}`);
      expect(q(f, 'implementation-microsoft-image-asset-block-uploadFailed')).not.toBeNull();
      expect(at(f).canSubmit()).toBe(false);
    });

    it.each([
      [40, 20],
      [2592, 2048],
    ])('uploads a %ix%i image', async (width, height) => {
      stubSize(width, height);
      const f = (await mount(true)).fixture;
      await choose(f, png());

      expect(uploadCreativeAsset).toHaveBeenCalled();
    });

    it('reads the encoded frame, not the EXIF-rotated one', async () => {
      stubSize(400, 200);
      const f = (await mount(true)).fixture;
      await choose(f, png());

      expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'none' });
    });

    it('leaves an image whose size cannot be read to campaign-service, and uploads it', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')));
      const f = (await mount(true)).fixture;
      await choose(f, png());

      expect(uploadCreativeAsset).toHaveBeenCalled();
    });

    it('saves the pick before the size read, so a tab switch during it restores a blocked draft, not an empty one', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(new Promise(() => undefined)));
      const first = await mount(true);
      const input = q(first.fixture, 'implementation-microsoft-image-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { configurable: true, value: [png()] });
      input.dispatchEvent(new Event('change'));
      first.fixture.detectChanges();
      const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
      expect(draft.microsoftImageUploadPendingName).toBe('promo.png');
      first.fixture.destroy();

      const second = (await mount(true, draft)).fixture;
      fillForm(second);
      expect(uploadCreativeAsset).not.toHaveBeenCalled();
      expect(q(second, 'implementation-microsoft-image-asset-block-uploadFailed')?.textContent).toContain('was interrupted');
      expect(at(second).canSubmit()).toBe(false);
    });

    it('blocks Create when the capability turns unknown during the size read', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(new Promise(() => undefined)));
      const f = (await mount(true)).fixture;
      fillForm(f);
      const input = q(f, 'implementation-microsoft-image-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { configurable: true, value: [png()] });
      input.dispatchEvent(new Event('change'));
      f.componentRef.setInput('microsoftAssetUploadEnabled', null);
      f.componentRef.setInput('createCapabilityRead', 'failed');
      f.detectChanges();

      expect(q(f, 'implementation-microsoft-image-asset-block-failed')).not.toBeNull();
      expect(at(f).canSubmit()).toBe(false);
    });

    it('holds Create while the size is read, and a removal during the read cancels the upload', async () => {
      let resolveSize: (size: { width: number; height: number; close(): void }) => void = () => undefined;
      vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(new Promise((resolve) => (resolveSize = resolve))));
      const f = (await mount(true)).fixture;
      fillForm(f);
      const input = q(f, 'implementation-microsoft-image-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { configurable: true, value: [png()] });
      input.dispatchEvent(new Event('change'));
      f.detectChanges();

      expect(q(f, 'implementation-microsoft-image-status')?.textContent).toContain('Checking image');
      expect(at(f).canSubmit()).toBe(false);

      click(f, 'implementation-microsoft-image-cancel');
      resolveSize({ width: 400, height: 200, close: vi.fn() });
      await new Promise((resolve) => setTimeout(resolve));
      f.detectChanges();

      expect(uploadCreativeAsset).not.toHaveBeenCalled();
      expect(at(f).canSubmit()).toBe(true);
    });
  });

  it.each([
    ['has no id yet', { status: 'saving', briefId: null, message: null, approved: true }],
    ['is saving', { status: 'saving', briefId: '6f9619ff-8b86-d011-b42d-00c04fc964ff', message: null, approved: true }],
  ])('disables the picker while the brief %s', async (_label, persistence) => {
    const f = (await mount(true)).fixture;
    f.componentRef.setInput('briefPersistence', persistence);
    f.detectChanges();

    expect((q(f, 'implementation-microsoft-image-file') as HTMLInputElement).disabled).toBe(true);
  });

  it('uploads an image of exactly 76,800 bytes', async () => {
    const f = (await mount(true)).fixture;
    await choose(f, png(76_800));

    expect(uploadCreativeAsset).toHaveBeenCalled();
    expect(at(f).microsoftImageAssetId()).toBe(ASSET_ID);
  });

  it('holds Create while the upload is in flight, and Cancel aborts the Microsoft upload only', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const f = (await mount(true)).fixture;
    fillForm(f);
    expect(at(f).canSubmit()).toBe(true);

    await choose(f, png());
    expect(at(f).microsoftImageUploadStatus()).toBe('uploading');
    expect(at(f).canSubmit()).toBe(false);

    click(f, 'implementation-microsoft-image-cancel');
    expect(cancelCreativeAssetUpload).toHaveBeenCalledWith('microsoft');
    expect(at(f).microsoftImageUploadStatus()).toBe('idle');
    expect(at(f).canSubmit()).toBe(true);
  });

  it('removes an uploaded image, after which the config goes out without it', async () => {
    const f = (await mount(true)).fixture;
    await choose(f, png());
    click(f, 'implementation-microsoft-image-remove');

    expect(at(f).microsoftImageAssetId()).toBe('');
    expect('imageAssetId' in submitConfig(f)).toBe(false);
  });

  it('carries the upload in the draft, and a remount resumes an upload still in flight', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true);
    await choose(first.fixture, png());
    const draft = first.latest() as CampaignImplementationDraft;
    expect(draft.microsoftImageUploadPendingName).toBe('promo.png');
    expect(draft.microsoftImageUploadPendingBriefId).toBe(BRIEF_ID);
    first.fixture.destroy();

    resumeCreativeAssetUpload.mockReturnValue(pending);
    const second = await mount(true, draft);
    expect(resumeCreativeAssetUpload).toHaveBeenCalledWith('microsoft', BRIEF_ID);
    pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
    second.fixture.detectChanges();
    expect(at(second.fixture).microsoftImageAssetId()).toBe(ASSET_ID);
    expect(second.latest()?.microsoftImageAssetId).toBe(ASSET_ID);
  });

  it('restores a finished upload from the draft and sends it', async () => {
    const draft = await uploadedDraft();
    const f = (await mount(true, draft)).fixture;

    expect(submitConfig(f)['imageAssetId']).toBe(ASSET_ID);
  });

  it.each([
    ['off', false, 'ready', 'unsupported'],
    ['unanswered, with the read failed', null, 'failed', 'failed'],
    ['unanswered, with the read pending', null, 'pending', 'pending'],
  ] as const)('blocks Create for a restored upload while the capability is %s, until it is removed', async (_label, upload, read, kind) => {
    const draft = await uploadedDraft();
    const f = (await mount(upload, draft)).fixture;
    f.componentRef.setInput('createCapabilityRead', read);
    fillForm(f);

    expect(q(f, `implementation-microsoft-image-asset-block-${kind}`)).not.toBeNull();
    expect(at(f).canSubmit()).toBe(false);

    click(f, 'implementation-microsoft-image-asset-block-remove');
    expect(q(f, `implementation-microsoft-image-asset-block-${kind}`)).toBeNull();
    expect(at(f).canSubmit()).toBe(true);
    expect('imageAssetId' in submitConfig(f)).toBe(false);
  });

  it('never sends an upload made for another brief, and says so', async () => {
    const draft = { ...(await uploadedDraft()), microsoftImageAssetBriefId: '0f8fad5b-d9cb-469f-a165-70867728950e' };
    const f = (await mount(true, draft)).fixture;
    fillForm(f);

    expect(q(f, 'implementation-microsoft-image-asset-block-otherBrief')).not.toBeNull();
    expect(at(f).canSubmit()).toBe(false);
  });

  it('keeps Create blocked after a failed upload, until the operator removes it', async () => {
    uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'the image is truncated' } })));
    const f = (await mount(true)).fixture;
    fillForm(f);
    await choose(f, png());

    expect(q(f, 'implementation-microsoft-image-asset-block-uploadFailed')).not.toBeNull();
    expect(at(f).canSubmit()).toBe(false);

    click(f, 'implementation-microsoft-image-asset-block-remove');
    expect(q(f, 'implementation-microsoft-image-asset-block-uploadFailed')).toBeNull();
    expect(at(f).canSubmit()).toBe(true);
  });
});

/**
 * #4983. The Implement tab names the campaigns already created for this event, keeps a failed or
 * lagging read from reading as "none", and says before Create Another what a repeat create on a
 * platform that already has a campaign really does.
 */
describe('ImplementationTabComponent already created for this event', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const brief = {
    eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/kubecon', countryCode: 'US' },
    selectedPlatforms: ['google-ads'],
  } as unknown as CampaignBriefOutput;

  const doc = (id: string, platform: string, status: string, slot?: number): CampaignIndexDoc =>
    ({
      id,
      project_id: 'tlf',
      brief_id: 'b-1',
      platform,
      campaign_name: `KubeCon EU 2026 | ${platform} | ${id}`,
      status,
      version: 1,
      platform_campaign_id: `pc-${id}`,
      ...(slot === undefined ? {} : { slot_version: slot }),
    }) as CampaignIndexDoc;

  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  function setList(campaigns: CampaignIndexDoc[] | null, stale = false, unavailable = false, loading = false): void {
    fixture.componentRef.setInput('briefCampaigns', campaigns);
    fixture.componentRef.setInput('briefCampaignsStale', stale);
    fixture.componentRef.setInput('briefCampaignsUnavailable', unavailable);
    fixture.componentRef.setInput('briefCampaignsLoading', loading);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.componentRef.setInput('briefData', brief);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('lists the live campaigns with platform, name, status and slot, and counts them per platform', () => {
    setList([
      doc('g1', 'google-ads', 'active', 1),
      doc('g2', 'google-ads', 'paused'),
      doc('r1', 'reddit-ads', 'created_degraded', 2),
      doc('gone', 'google-ads', 'deleted', 3),
    ]);

    expect(q('implementation-existing-campaigns')).not.toBeNull();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid^="implementation-existing-row-"]');
    expect(rows).toHaveLength(3);
    expect(q('implementation-existing-row-gone'), 'a deleted campaign was listed as already created').toBeNull();
    const cells = (id: string): string[] =>
      [...(q(`implementation-existing-row-${id}`)?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim() ?? '');
    expect(cells('g1')).toEqual(['Google Ads', 'KubeCon EU 2026 | google-ads | g1', 'active', '1', '—', '—', '—', '—']);
    // No slot recorded (indexed before the field existed) reads as unknown, not as slot 1.
    expect(cells('g2')[3]).toBe('—');
    expect(cells('r1')).toEqual(['Reddit Ads', 'KubeCon EU 2026 | reddit-ads | r1', 'created degraded', '2', '—', '—', '—', '—']);

    expect(q('implementation-existing-notice-google-ads')?.textContent?.trim()).toBe('You already have 2 Google Ads campaigns for this event.');
    expect(q('implementation-existing-notice-reddit-ads')?.textContent?.trim()).toBe('You already have 1 Reddit Ads campaign for this event.');
  });

  /** #4983 ("ss-4"): the labels that tell a second campaign from the first, "—" on a legacy row. */
  it('shows the channel, stage, tactic and created date of each campaign, and "—" where none is recorded', () => {
    setList([
      { ...doc('g1', 'google-ads', 'active', 1), variant: 'default' },
      {
        ...doc('g2', 'google-ads', 'active', 2),
        variant: 'default',
        funnel_stage: 'lower',
        tactic: 'retargeting',
        created_at: '2026-11-02T12:00:00Z',
      },
    ]);

    const labels = (id: string): string[] =>
      ['channel', 'stage', 'tactic', 'created'].map((column) => q(`implementation-existing-${column}-${id}`)?.textContent?.trim() ?? 'missing');
    // The viewer's own calendar day, so the assertion holds in any CI time zone.
    expect(labels('g2')).toEqual([
      'Search',
      'Lower funnel',
      'Retargeting',
      new Date('2026-11-02T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    ]);
    expect(labels('g1')).toEqual(['Search', '—', '—', '—']);
    const headings = [...((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="implementation-existing-table"] th') ?? [])].map((th) =>
      th.textContent?.trim()
    );
    expect(headings).toEqual(['Platform', 'Name', 'Status', 'Slot', 'Channel', 'Stage', 'Tactic', 'Created']);
  });

  it('scrolls the eight-column table inside the card rather than widening the page', () => {
    setList([doc('g1', 'google-ads', 'active', 1)]);
    expect(q('implementation-existing-table-scroll')?.classList.contains('overflow-x-auto')).toBe(true);
    expect(q('implementation-existing-table-scroll')?.querySelector('[data-testid="implementation-existing-table"]')).not.toBeNull();
  });

  it("leaves the created date to the browser during a server render, so the server's day is never shown", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.componentRef.setInput('briefData', brief);
    setList([{ ...doc('g2', 'google-ads', 'active', 2), variant: 'default', funnel_stage: 'lower', created_at: '2026-11-02T12:00:00Z' }]);

    expect(q('implementation-existing-created-g2')?.textContent?.trim()).toBe('—');
    expect(q('implementation-existing-stage-g2')?.textContent?.trim()).toBe('Lower funnel');
  });

  it('says a failed read failed, with Retry, instead of rendering as "nothing created"', () => {
    setList(null, false, true);
    const retry = vi.fn();
    fixture.componentInstance.retryBriefCampaigns.subscribe(retry);

    expect(q('implementation-existing-unavailable')?.textContent).toContain('could not be loaded');
    expect(q('implementation-existing-campaigns')).toBeNull();
    q('implementation-existing-retry')?.querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says an empty but possibly stale answer may be missing recent campaigns, and shows nothing for a fresh empty one', () => {
    setList([], true);
    expect(q('implementation-existing-stale')?.textContent).toContain('may not be listed yet');

    setList([], false);
    expect(q('implementation-existing-stale')).toBeNull();
    expect(q('implementation-existing-campaigns')).toBeNull();

    // Not loaded and not loading: nothing to say, so no panel and no caveat.
    setList(null, false);
    expect(q('implementation-existing-campaigns')).toBeNull();
    expect(q('implementation-existing-stale')).toBeNull();
    expect(q('implementation-existing-loading')).toBeNull();
  });

  it('says it is checking while the list is being read, rather than showing nothing', () => {
    setList(null, false, false, true);
    expect(q('implementation-existing-loading')?.textContent).toContain('Checking for campaigns already created');
    expect(q('implementation-existing-campaigns')).toBeNull();
  });

  it('says before Create Another that a platform with a campaign returns it rather than making a second', () => {
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('results');
    setList([doc('g1', 'google-ads', 'active', 1), doc('gone', 'reddit-ads', 'deleted', 1), doc('claim', 'meta-ads', 'pending', 1)]);

    const notice = q('implementation-create-another-notice')?.textContent ?? '';
    expect(notice).toContain('Creating the same campaign again on Google Ads returns the one already created there');
    expect(notice, 'a deleted campaign was counted as one campaign-service returns').not.toContain('Reddit');
    expect(notice, 'a pending claim was counted as one campaign-service returns').not.toContain('Meta');

    setList([]);
    expect(q('implementation-create-another-notice')).toBeNull();
  });

  it('names the platforms the job just created, before the list has caught up', () => {
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('results');
    (fixture.componentInstance as unknown as { platformResults: { set(v: unknown): void } }).platformResults.set([
      { platform: 'microsoft-ads', ok: true },
      { platform: 'reddit-ads', ok: false, error: 'refused' },
    ]);
    setList(null, false, false, true);

    const notice = q('implementation-create-another-notice')?.textContent ?? '';
    expect(notice).toContain('Microsoft Ads');
    expect(notice, 'a failed platform was named as created').not.toContain('Reddit');
  });

  it.each([
    ['an outcome', (): Observable<CampaignJobOutcome | null> => of({ campaigns: [], platformResults: [], errors: [] } as unknown as CampaignJobOutcome)],
    ['a lost poll', (): Observable<CampaignJobOutcome | null> => throwError(() => new Error('lost'))],
    ['a poll that runs out', (): Observable<CampaignJobOutcome | null> => EMPTY],
  ])('asks the parent to re-read the list once when a create job settles with %s', STATE_ONLY, (_label, answer) => {
    vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(answer());
    (fixture.componentInstance as unknown as { step: { set(v: string): void } }).step.set('creating');
    const settled = vi.fn();
    fixture.componentInstance.createJobSettled.subscribe(settled);

    (fixture.componentInstance as unknown as { pollJob(jobId: string, projectSlug: string): void }).pollJob('job-1', 'tlf');

    expect(settled).toHaveBeenCalledTimes(1);
  });
});

/**
 * #4983 ("ss-3"). A deliberate second campaign on a platform that already has one: offered only where
 * the deployment allows it, labelled by funnel stage, confirmed every time, and sent with the slot
 * version the operator saw for the SAME slot (for Google, the same channel).
 */
describe('ImplementationTabComponent create another campaign', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let dialogClose: Subject<boolean | undefined>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let createCampaign: MockInstance<CampaignService['createCampaign']>;

  const doc = (id: string, slot: number, variant = 'default', status = 'active', platformCampaignId: string | undefined = `pc-${id}`): CampaignIndexDoc =>
    ({
      id,
      project_id: 'tlf',
      brief_id: 'b-1',
      platform: 'google-ads',
      platform_campaign_id: platformCampaignId,
      campaign_name: `KubeCon | ${id}`,
      status,
      version: 1,
      slot_version: slot,
      variant,
    }) as CampaignIndexDoc;

  interface Internals {
    selectedPlatforms: { set(v: string[]): void };
    briefKeywords: { set(v: unknown[]): void };
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }>; get(name: string): { controls: { setValue(v: unknown): void }[] } | null };
    canSubmit(): boolean;
    submit(): void;
    anotherForm: { controls: { stage: { setValue(v: string | null): void; value: string | null }; tactic: { setValue(v: string | null): void } } };
    step: { set(v: string): void };
    platformResults: { set(v: unknown): void };
    rememberSlotVersions(results: unknown[]): void;
  }
  const c = (): Internals => fixture.componentInstance as unknown as Internals;
  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  function makeGoogleSearchValid(): void {
    c().selectedPlatforms.set(['google-ads']);
    c().briefKeywords.set([SEED_KEYWORD]);
    c().campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c().campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c().campaignForm.controls['startDate'].setValue('2026-09-01');
    c().campaignForm.controls['endDate'].setValue('2026-09-30');
    c().campaignForm.controls['includeSearch'].setValue(true);
    c().campaignForm.controls['includeDemandGen'].setValue(false);
    c()
      .campaignForm.get('headlines')
      ?.controls.forEach((ctrl) => ctrl.setValue('Attend KubeCon'));
    c()
      .campaignForm.get('descriptions')
      ?.controls.forEach((ctrl) => ctrl.setValue('Join us in September'));
    fixture.detectChanges();
  }

  function setLists(campaigns: CampaignIndexDoc[], allowed: string[]): void {
    fixture.componentRef.setInput('briefCampaigns', campaigns);
    fixture.componentRef.setInput('multiCampaignPlatforms', allowed);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogClose = new Subject<boolean | undefined>();
    dialogOpen = vi.fn(() => ({ onClose: dialogClose }));
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    })
      .overrideComponent(ImplementationTabComponent, { set: { providers: [{ provide: DialogService, useValue: { open: dialogOpen } }] } })
      .compileComponents();
    createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(NEVER);
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-1', message: null, approved: true } as CampaignBriefPersistenceState);
    fixture.detectChanges();
    await fixture.whenStable();
    makeGoogleSearchValid();
  });

  it('offers it only on a platform the deployment allows, and leaves a plain retry alone elsewhere', () => {
    setLists([doc('g1', 1)], []);
    expect(q('implementation-create-another')).toBeNull();
    expect(c().canSubmit(), 'a repeat create where another is not offered must stay a retry').toBe(true);

    setLists([doc('g1', 1)], ['google-ads']);
    expect(q('implementation-create-another')).not.toBeNull();
  });

  it('requires a funnel stage before the create can go', () => {
    setLists([doc('g1', 1)], ['google-ads']);
    expect(c().canSubmit()).toBe(false);
    expect(q('implementation-create-another-block')?.textContent).toContain('Choose a funnel stage');

    c().anotherForm.controls.stage.setValue('mid');
    fixture.detectChanges();
    expect(c().canSubmit()).toBe(true);
  });

  it('refuses a create that mixes a platform being created again with one that is not', () => {
    setLists([doc('g1', 1)], ['google-ads', 'microsoft-ads']);
    c().anotherForm.controls.stage.setValue('mid');
    c().selectedPlatforms.set(['google-ads', 'microsoft-ads']);
    fixture.detectChanges();

    expect(c().canSubmit()).toBe(false);
    expect(q('implementation-create-another-block')?.textContent).toContain('can only include platforms that already have one');
  });

  it('confirms first, then sends the latest slot version of the same channel with the stage and tactic', () => {
    // Search (the default slot) is at version 2; a Demand Gen campaign on its own slot is ignored.
    setLists([doc('g1', 1), doc('g2', 2), doc('dg', 5, 'demand-gen')], ['google-ads']);
    c().anotherForm.controls.stage.setValue('mid');
    c().anotherForm.controls.tactic.setValue('retargeting');
    fixture.detectChanges();

    c().submit();
    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(createCampaign, 'nothing may be sent before the operator confirms').not.toHaveBeenCalled();

    dialogClose.next(true);

    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(createCampaign.mock.calls[0][0].another).toEqual({ funnelStage: 'mid', tactic: 'retargeting', expectedSlotVersions: { 'google-ads': 2 } });
  });

  it('sends nothing when the confirmation is dismissed', STATE_ONLY, () => {
    setLists([doc('g1', 1)], ['google-ads']);
    c().anotherForm.controls.stage.setValue('top');
    fixture.detectChanges();

    c().submit();
    dialogClose.next(false);

    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("expects past this tab's own job when the list has not caught up yet", () => {
    setLists([doc('g1', 1)], ['google-ads']);
    c().rememberSlotVersions([{ platform: 'google-ads', ok: true, slotVersion: 3, variant: 'default' }]);
    c().anotherForm.controls.stage.setValue('lower');
    fixture.detectChanges();

    c().submit();
    dialogClose.next(true);

    expect(createCampaign.mock.calls[0][0].another?.expectedSlotVersions).toEqual({ 'google-ads': 3 });
  });

  it('keeps a first campaign on a new Google channel a plain create', () => {
    // Search has a campaign; Demand Gen is a different slot with none, so there is nothing to add another to.
    fixture.componentRef.setInput('demandGenEnabled', true);
    setLists([doc('g1', 1)], ['google-ads']);
    c().campaignForm.controls['includeSearch'].setValue(false);
    c().campaignForm.controls['includeDemandGen'].setValue(true);
    fixture.detectChanges();

    expect(q('implementation-create-another'), 'a first Demand Gen campaign was forced into create-another').toBeNull();
    expect(q('implementation-create-another-block')).toBeNull();
  });

  it('leaves an unfinished latest campaign to a plain retry, which is what reconciles it', () => {
    setLists([doc('g1', 1), doc('g2', 2, 'default', 'pending', undefined)], ['google-ads']);

    expect(q('implementation-create-another')).toBeNull();
    expect(c().canSubmit()).toBe(true);
  });

  it('forgets the slots it saw when the brief changes', () => {
    setLists([], ['google-ads']);
    c().rememberSlotVersions([{ platform: 'google-ads', ok: true, slotVersion: 1, variant: 'default' }]);
    fixture.detectChanges();
    expect(q('implementation-create-another')).not.toBeNull();

    fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'b-2', message: null, approved: true } as CampaignBriefPersistenceState);
    fixture.detectChanges();
    expect(q('implementation-create-another'), "another brief's slot was treated as this one's").toBeNull();
  });

  it('heads the results as returned, not created, when every campaign came back existing', STATE_ONLY, () => {
    c().step.set('results');
    c().platformResults.set([{ platform: 'google-ads', ok: true, campaignId: '9', reused: true }]);
    fixture.detectChanges();

    expect((fixture.componentInstance as unknown as { platformResultsHeading(): string }).platformResultsHeading()).toBe('Existing Campaigns Returned');
  });

  it('does not head a reused row beside an unconfirmed one as if every campaign already existed', STATE_ONLY, () => {
    c().step.set('results');
    c().platformResults.set([
      { platform: 'google-ads', ok: true, campaignId: '9', reused: true },
      { platform: 'microsoft-ads', ok: false, error: 'campaign-service did not answer in time' },
    ]);
    fixture.detectChanges();

    expect((fixture.componentInstance as unknown as { platformResultsHeading(): string }).platformResultsHeading()).not.toBe('Existing Campaigns Returned');
  });

  it('labels a campaign this tab just created with the stage and tactic its job reported', () => {
    setLists([doc('g1', 1)], ['google-ads']);
    c().rememberSlotVersions([{ platform: 'google-ads', ok: true, slotVersion: 2, variant: 'default', funnelStage: 'mid', tactic: 'keyword' }]);
    c().anotherForm.controls.stage.setValue('top');
    fixture.detectChanges();

    c().submit();
    const existing = (dialogOpen.mock.calls[0] as unknown as [unknown, { data: { existing: { slot: string; labels: unknown }[] } }])[1].data.existing;
    expect(existing.find((row) => row.slot === '2')?.labels).toEqual({ channel: 'Search', stage: 'Mid funnel', tactic: 'Keyword', created: '—' });
  });

  it('heads a reused row beside a proven pre-create failure as both, not as unconfirmed', STATE_ONLY, () => {
    c().step.set('results');
    c().platformResults.set([
      { platform: 'google-ads', ok: true, campaignId: '9', reused: true },
      { platform: 'reddit-ads', ok: false, error: 'reddit-ads refused the request (HTTP 400) before anything was created; nothing was created' },
    ]);
    fixture.detectChanges();

    expect((fixture.componentInstance as unknown as { platformResultsHeading(): string }).platformResultsHeading()).toBe(
      'Existing Campaigns Returned; Nothing Else Created'
    );
  });

  it('lists a campaign this tab just created in the confirmation, before the index shows it', () => {
    setLists([doc('g1', 1)], ['google-ads']);
    c().rememberSlotVersions([{ platform: 'google-ads', ok: true, slotVersion: 2, variant: 'default' }]);
    c().anotherForm.controls.stage.setValue('top');
    fixture.detectChanges();

    c().submit();
    const existing = (dialogOpen.mock.calls[0] as unknown as [unknown, { data: { existing: { id: string; slot: string }[] } }])[1].data.existing;
    expect(existing.map((row) => row.slot)).toEqual(['1', '2']);
  });

  it('matches a Google campaign indexed before channels were recorded to no channel, leaving a plain create', () => {
    const legacy = { ...doc('g1', 1) } as CampaignIndexDoc;
    delete legacy.variant;
    setLists([legacy], ['google-ads']);

    expect(q('implementation-create-another'), 'an unlabelled Google campaign was read as Search').toBeNull();
    expect(c().canSubmit()).toBe(true);
  });

  it('stops expecting a slot this tab saw once the list shows that campaign deleted', () => {
    setLists([doc('g1', 1)], ['google-ads']);
    c().rememberSlotVersions([{ platform: 'google-ads', ok: true, slotVersion: 2, variant: 'default' }]);
    setLists([doc('g1', 1), doc('g2', 2, 'default', 'deleted')], ['google-ads']);
    c().anotherForm.controls.stage.setValue('mid');
    fixture.detectChanges();

    c().submit();
    dialogClose.next(true);

    expect(createCampaign.mock.calls[0][0].another?.expectedSlotVersions).toEqual({ 'google-ads': 1 });
  });

  it('keeps the chosen stage shown when the pickers are hidden and shown again', () => {
    setLists([doc('g1', 1)], ['google-ads']);
    c().anotherForm.controls.stage.setValue('lower');
    fixture.detectChanges();
    setLists([], ['google-ads']);
    expect(q('implementation-create-another')).toBeNull();
    setLists([doc('g1', 1)], ['google-ads']);

    // What the picker DISPLAYS, whichever control renders it: a native select's chosen option or the select's label.
    const host = q('implementation-another-stage');
    const shown = host?.querySelector('select')?.selectedOptions[0]?.textContent ?? host?.querySelector('.p-select-label')?.textContent;
    expect(shown?.trim()).toBe('Lower funnel (conversion)');
    expect(c().canSubmit()).toBe(true);
  });

  it('says when campaign-service returned an existing campaign instead of creating one', () => {
    c().step.set('results');
    c().platformResults.set([{ platform: 'google-ads', ok: true, campaignId: '9', reused: true, funnelStage: 'mid' }]);
    fixture.detectChanges();

    expect(q('implementation-platform-result-reused')?.textContent?.trim()).toBe('Existing mid-funnel campaign returned; nothing new was created.');
  });
});
