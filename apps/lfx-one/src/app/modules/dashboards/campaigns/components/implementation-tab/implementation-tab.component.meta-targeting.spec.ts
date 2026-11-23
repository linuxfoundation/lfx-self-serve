// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The Meta geo chips (LFXV2-3227).
 *
 * These render in the same pill styling as LinkedIn's editable chips but used to carry no remove
 * button and no way to add one — a control that LOOKS interactive and is not. Every test here
 * drives the real DOM (a click on the rendered button, a `change` on the rendered input) rather
 * than calling the handlers, because a handler that works while its binding is missing is exactly
 * the defect being fixed.
 */
describe('ImplementationTabComponent Meta geo targets', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function metaGeoTargets(): string[] {
    return (fixture.componentInstance as unknown as { metaGeoTargets(): string[] }).metaGeoTargets();
  }

  async function setMetaGeoTargets(values: string[]): Promise<void> {
    (fixture.componentInstance as unknown as { metaGeoTargets: { set(v: string[]): void } }).metaGeoTargets.set(values);
    await fixture.whenStable();
  }

  /** Meta's section only renders when the platform is selected. */
  async function selectMeta(): Promise<void> {
    (fixture.componentInstance as unknown as { selectedPlatforms: { set(v: string[]): void } }).selectedPlatforms.set(['meta-ads']);
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /**
   * Read the geo add input, asserting it rendered first.
   *
   * The bare `query(...) as HTMLInputElement` this replaces turned a missing element into a
   * silent `null.value = …` TypeError, which reads as an unrelated crash rather than "the DOM
   * had not flushed". Failing on the expectation names the real cause.
   */
  function geoAddInput(): HTMLInputElement {
    const input = query('implementation-meta-geo-add');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
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

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await selectMeta();
  });

  it('removes a geo target when its chip remove button is clicked', async () => {
    await setMetaGeoTargets(['US', 'JP', 'DE']);

    const removeJp = query('implementation-meta-geo-remove-JP');
    expect(removeJp).not.toBeNull();

    removeJp!.click();
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'DE']);
  });

  /** Every chip needs its own working button — a single wired chip would pass a one-chip test. */
  it('renders a remove button for every chip', async () => {
    await setMetaGeoTargets(['US', 'JP']);

    expect(query('implementation-meta-geo-remove-US')).not.toBeNull();
    expect(query('implementation-meta-geo-remove-JP')).not.toBeNull();
  });

  it('adds a geo target typed into the add input', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'JP';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  /**
   * Enter must add the code. The input previously listened only for `(change)`, so a user who
   * typed a code and pressed Enter — the reflex for a chip input — saw nothing happen, and the
   * code was silently dropped if they then clicked away to a non-blurring target.
   */
  it('adds a geo target when Enter is pressed in the add input', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'JP';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  /**
   * Enter clears the box, so the `change` event that fires on the subsequent blur carries an empty
   * value. Were the handler not clearing — or normalisation not deduping — the same code would land
   * twice from a single entry.
   */
  it('does not double-add when Enter is followed by a change event', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'JP';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  /**
   * `maxlength="2"` used to sit on this input, and it defeated half of `normalizeGeoTargets`.
   * The normaliser trims BEFORE it validates, precisely so a padded paste survives — but the
   * browser applies maxlength to the RAW keystrokes, clipping " jp " to " j" before the change
   * handler ever runs. The ISO-2 pattern then rejects it and the code is silently dropped.
   *
   * This asserts the ATTRIBUTE is absent rather than typing a padded value, deliberately: jsdom
   * does not enforce maxlength on a programmatic `.value` assignment, so a value-setting test
   * would pass with the cap still on the element and prove nothing about a real browser.
   */
  it('puts no maxlength on the add input, so padded input reaches the normaliser', async () => {
    await setMetaGeoTargets([]);

    expect(geoAddInput().hasAttribute('maxlength')).toBe(false);
  });

  it('clears the add input after a successful add', async () => {
    await setMetaGeoTargets([]);

    const input = geoAddInput();
    input.value = 'DE';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(input.value).toBe('');
  });

  /**
   * The block used to be wrapped in `@if (metaGeoTargets().length > 0)`, so a brief recommending
   * no geos hid the whole control — the user could neither see that Meta would fall back to the
   * country code nor change it. Rendering unconditionally is what makes the fallback visible.
   */
  it('renders the add control even when there are no geo targets', async () => {
    await setMetaGeoTargets([]);

    expect(query('implementation-meta-geo-add')).not.toBeNull();
  });

  /**
   * The seed path is the OTHER door into `metaGeoTargets`, and it used to bypass normalisation
   * entirely: `populateFromBrief` assigned `recommended_geos` raw. A stored `us` then survived as
   * a lowercase chip, so the add path's `includes` check could not see it as a duplicate of a
   * typed `US`, and BOTH reached the wire — the server uppercased without de-duping.
   */
  async function seedFromBrief(geos: string[], shape: 'structured' | 'typed'): Promise<void> {
    const brief: Record<string, any> = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://events.example.com/k' },
      totalBudget: 500,
      keywords: [],
      hsUtm: '',
      driveFolderUrl: '',
    };
    if (shape === 'structured') {
      brief['structuredCopy'] = { meta_ads: { variants: [], recommended_geos: geos } };
    } else {
      brief['metaCopy'] = { variants: [], recommendedGeos: geos };
    }
    (fixture.componentInstance as unknown as { populateFromBrief(b: unknown): void }).populateFromBrief(brief);
    await fixture.whenStable();
  }

  /** The defect as reported: a stored lowercase code plus a typed uppercase one made two chips. */
  it('treats a typed code as a duplicate of a lowercase code seeded from the brief', async () => {
    await seedFromBrief(['us'], 'structured');
    await selectMeta();

    const input = geoAddInput();
    input.value = 'US';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US']);
  });

  it('can add a geo target back after removing the last one', async () => {
    await setMetaGeoTargets(['US']);

    query('implementation-meta-geo-remove-US')!.click();
    await fixture.whenStable();
    expect(metaGeoTargets()).toEqual([]);

    const input = geoAddInput();
    input.value = 'FR';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['FR']);
  });
});

/**
 * The Meta ad image: one image, set on every variant. A pasted URL is offered on an explicit yes
 * from `metaCreativeEnabled`; an upload on an explicit yes from `metaAssetUploadEnabled` as well,
 * sent as `imageAssetId` in place of `imageUrl`. With neither, the variants go out as before.
 */
describe('ImplementationTabComponent meta ad image', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const ASSET_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  let createCampaign: ReturnType<typeof vi.fn>;
  let uploadCreativeAsset: ReturnType<typeof vi.fn>;
  let resumeCreativeAssetUpload: ReturnType<typeof vi.fn>;
  let cancelCreativeAssetUpload: ReturnType<typeof vi.fn>;

  interface Internals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    selectedPlatforms: { set(v: string[]): void };
    metaImageAssetId: () => string;
    metaImageUploadStatus: () => string;
    metaImageUploadError: () => string;
    canSubmit: () => boolean;
    submit(): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;
  const q = (f: ComponentFixture<ImplementationTabComponent>, id: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads'],
      metaCopy: {
        variants: [
          { primaryText: 'First primary', headline: 'First headline' },
          { primaryText: 'Second primary', headline: 'Second headline', description: 'Second description' },
        ],
        recommendedGeos: ['US'],
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  async function mount(
    creative: boolean | null,
    upload: boolean | null,
    draft: CampaignImplementationDraft | null = null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('metaCreativeEnabled', creative);
    f.componentRef.setInput('metaAssetUploadEnabled', upload);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: BRIEF_ID, message: null, approved: true });
    f.componentRef.setInput('briefData', brief());
    at(f).selectedPlatforms.set(['meta-ads']);
    f.detectChanges();
    await f.whenStable();
    return { fixture: f, latest: () => captured };
  }

  function choose(f: ComponentFixture<ImplementationTabComponent>, file: File): void {
    const input = q(f, 'implementation-meta-image-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  const png = (size = 16): File => new File([new Uint8Array(size)], 'promo.png', { type: 'image/png' });

  function typeImageUrl(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const input = q(f, 'implementation-meta-image-url') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  /** The draft a real upload leaves behind, as a tab switch hands it to the next mount. */
  async function uploadedDraft(): Promise<CampaignImplementationDraft> {
    const first = await mount(true, true);
    choose(first.fixture, png());
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
    f.detectChanges();
  }

  function submitVariants(f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown>[] {
    fillForm(f);
    at(f).submit();
    expect(createCampaign).toHaveBeenCalled();
    return (createCampaign.mock.calls[0][0]['metaConfig'] as { variants: Record<string, unknown>[] }).variants;
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

  // Unanswered (`null`) is the stricter wiring case; the full null/false/true matrix is `metaImageCapabilities` in the helper spec.
  it('renders no image controls while the Meta creative capability is unanswered, and sends the variants unchanged', async () => {
    const f = (await mount(null, true)).fixture;

    expect(q(f, 'implementation-meta-image-url')).toBeNull();
    expect(q(f, 'implementation-meta-image-file')).toBeNull();
    expect(submitVariants(f)).toEqual([
      { primaryText: 'First primary', headline: 'First headline' },
      { primaryText: 'Second primary', headline: 'Second headline', description: 'Second description' },
    ]);
  });

  it('offers the image URL but no upload while the upload capability is unanswered', async () => {
    const f = (await mount(true, null)).fixture;

    expect(q(f, 'implementation-meta-image-url')).not.toBeNull();
    expect(q(f, 'implementation-meta-image-file')).toBeNull();
  });

  it('sends a pasted image URL on every variant and names it in the preview', async () => {
    const f = (await mount(true, false)).fixture;
    typeImageUrl(f, 'https://cdn.example.org/promo.png');

    expect(q(f, 'implementation-meta-variant-image-0')?.textContent).toContain('https://cdn.example.org/promo.png');
    expect(q(f, 'implementation-meta-variant-image-1')?.textContent).toContain('https://cdn.example.org/promo.png');
    const variants = submitVariants(f);
    expect(variants.map((v) => v['imageUrl'])).toEqual(['https://cdn.example.org/promo.png', 'https://cdn.example.org/promo.png']);
    expect(variants.some((v) => 'imageAssetId' in v)).toBe(false);
  });

  it('uploads the chosen image for the saved brief and sends its asset id on every variant in place of the URL', async () => {
    const f = (await mount(true, true)).fixture;
    typeImageUrl(f, 'https://cdn.example.org/promo.png');
    const file = png();
    choose(f, file);

    expect(uploadCreativeAsset).toHaveBeenCalledWith(file, 'tlf', BRIEF_ID, 'meta');
    expect(at(f).metaImageAssetId()).toBe(ASSET_ID);
    expect(q(f, 'implementation-meta-image-status')?.textContent).toContain('Uploaded: promo.png');
    expect(q(f, 'implementation-meta-variant-image-0')?.textContent).toContain('promo.png');
    const variants = submitVariants(f);
    expect(variants.map((v) => v['imageAssetId'])).toEqual([ASSET_ID, ASSET_ID]);
    expect(variants.some((v) => 'imageUrl' in v)).toBe(false);
  });

  it('refuses a file that is not a PNG or JPEG before any upload', async () => {
    const f = (await mount(true, true)).fixture;
    choose(f, new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' }));

    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    expect(at(f).metaImageUploadStatus()).toBe('error');
    expect(q(f, 'implementation-meta-image-error')).not.toBeNull();
  });

  it('holds Create while the upload is in flight, and Cancel aborts the Meta upload only', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const f = (await mount(true, true)).fixture;
    fillForm(f);
    expect(at(f).canSubmit()).toBe(true);

    choose(f, png());
    expect(at(f).metaImageUploadStatus()).toBe('uploading');
    expect(at(f).canSubmit()).toBe(false);

    (q(f, 'implementation-meta-image-cancel') as HTMLButtonElement).click();
    f.detectChanges();
    expect(cancelCreativeAssetUpload).toHaveBeenCalledWith('meta');
    expect(at(f).metaImageUploadStatus()).toBe('idle');
    expect(at(f).canSubmit()).toBe(true);
  });

  it('carries the upload in the draft, and a remount resumes an upload still in flight', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true, true);
    choose(first.fixture, png());
    const draft = first.latest() as CampaignImplementationDraft;
    expect(draft.metaImageUploadPendingName).toBe('promo.png');
    expect(draft.metaImageUploadPendingBriefId).toBe(BRIEF_ID);
    first.fixture.destroy();

    resumeCreativeAssetUpload.mockReturnValue(pending);
    const second = await mount(true, true, draft);
    expect(resumeCreativeAssetUpload).toHaveBeenCalledWith('meta', BRIEF_ID);
    pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
    second.fixture.detectChanges();
    expect(at(second.fixture).metaImageAssetId()).toBe(ASSET_ID);
    expect(second.latest()?.metaImageAssetId).toBe(ASSET_ID);
  });

  it('blocks Create for a restored upload the deployment cannot send, until it is removed', async () => {
    const draft = await uploadedDraft();
    const f = (await mount(true, false, draft)).fixture;
    fillForm(f);

    expect(q(f, 'implementation-meta-image-asset-block-unsupported')).not.toBeNull();
    expect(at(f).canSubmit()).toBe(false);

    (q(f, 'implementation-meta-image-asset-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(q(f, 'implementation-meta-image-asset-block-unsupported')).toBeNull();
    expect(at(f).canSubmit()).toBe(true);
    expect(submitVariants(f).some((v) => 'imageAssetId' in v)).toBe(false);
  });

  it('keeps Create blocked after a failed upload with both capabilities on, until the operator removes it', async () => {
    uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'the image is truncated' } })));
    const f = (await mount(true, true)).fixture;
    typeImageUrl(f, 'https://cdn.example.org/promo.png');
    fillForm(f);
    choose(f, png());

    expect(at(f).metaImageUploadStatus()).toBe('error');
    expect(q(f, 'implementation-meta-image-asset-block-uploadFailed')).not.toBeNull();
    expect(at(f).canSubmit()).toBe(false);

    (q(f, 'implementation-meta-image-asset-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(q(f, 'implementation-meta-image-asset-block-uploadFailed')).toBeNull();
    expect(at(f).canSubmit()).toBe(true);
    // Removing the failed upload leaves the pasted URL, which the request can still carry.
    expect(submitVariants(f).map((v) => v['imageUrl'])).toEqual(['https://cdn.example.org/promo.png', 'https://cdn.example.org/promo.png']);
  });

  // Wiring for the withheld URL on an unanswered capability; the `unsupported`, `pending` and `unsaved` kinds are rows in `metaImageAssetBlock`'s helper table.
  it('blocks Create for a restored image URL while the image capability is unanswered and its read failed, rather than dropping it', async () => {
    const first = await mount(true, false);
    typeImageUrl(first.fixture, 'https://cdn.example.org/promo.png');
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
    first.fixture.destroy();

    const f = (await mount(null, false, draft)).fixture;
    f.componentRef.setInput('createCapabilityRead', 'failed');
    fillForm(f);

    expect(q(f, 'implementation-meta-image-url')).toBeNull();
    expect(q(f, 'implementation-meta-image-asset-block-failed')).not.toBeNull();
    expect(at(f).canSubmit()).toBe(false);

    (q(f, 'implementation-meta-image-asset-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(at(f).canSubmit()).toBe(true);
    expect(submitVariants(f).some((v) => 'imageUrl' in v)).toBe(false);
  });
});

/**
 * Meta Instagram account id and EU DSA disclosures, behind `metaInstagramDsaEnabled`
 * (`LFX_CUTOVER_CAMPAIGN_SERVICE_META_INSTAGRAM_DSA`, linuxfoundation/lfx-v2-campaign-service#414).
 *
 * Off: no inputs, no keys, Create unchanged. On: the Instagram id is required (and sent) for an
 * Instagram placement, both disclosures are required for an EU geo and sent only as a pair, and a
 * missing or malformed one blocks Create. All three survive a tab switch through the draft.
 */
describe('ImplementationTabComponent meta instagram and dsa', () => {
  let createCampaign: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['meta-ads'],
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

  async function mount(enabled: boolean | null | undefined, draft?: Record<string, unknown>): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    if (enabled !== undefined) f.componentRef.setInput('metaInstagramDsaEnabled', enabled);
    if (draft) f.componentRef.setInput('draft', { eventSlug: 'kubecon-eu-2026', headlines: [''], descriptions: [''], ...draft });
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    const c = component(f);
    c['selectedPlatforms'].set(['meta-ads']);
    c['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c['campaignForm'].controls['registrationUrl'].setValue('https://example.com/kubecon');
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    await f.whenStable();
    return f;
  }

  async function type(values: Partial<Record<'instagramUserId' | 'dsaBeneficiary' | 'dsaPayor', string>>, f = fixture): Promise<void> {
    component(f)['metaInstagramDsaForm'].patchValue(values);
    f.detectChanges();
    await f.whenStable();
  }

  async function setGeos(geos: string[], f = fixture): Promise<void> {
    component(f)['metaGeoTargets'].set(geos);
    f.detectChanges();
    await f.whenStable();
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

  // === A live brief switch (#4624) ===

  /** The next brief: another event. `withMetaCopy: false` drops the copy the geos and variants are seeded from. */
  const otherBrief = (withMetaCopy = true): CampaignBriefOutput => {
    const next = { ...brief(), eventDetails: { ...brief().eventDetails, name: 'Open Source Summit', slug: 'oss-na-2026' } } as unknown as Record<
      string,
      unknown
    >;
    if (!withMetaCopy) delete next['metaCopy'];
    return next as unknown as CampaignBriefOutput;
  };

  /** Mount `briefData` with both Meta capabilities on, and capture every draft it emits. */
  async function mountLive(
    briefData: CampaignBriefOutput
  ): Promise<{ f: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('metaInstagramDsaEnabled', true);
    f.componentRef.setInput('metaCreativeEnabled', true);
    f.componentRef.setInput('briefData', briefData);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, latest: () => captured };
  }

  /** Hand `next` to the SAME fixture as the parent does on a brief switch: the draft cleared first. */
  async function switchBrief(f: ComponentFixture<ImplementationTabComponent>, next: CampaignBriefOutput): Promise<void> {
    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', next);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  }

  /** The DSA disclosures and the pixel matter most: another brief's must never reach a live create. */
  it('drops every typed meta field, the dsa disclosures and pixel included, when a different brief is handed over', async () => {
    const { f, latest } = await mountLive(brief());
    const el = <T extends HTMLElement>(testId: string): T => query(`implementation-meta-${testId}`, f) as T;
    const fire = async (target: HTMLInputElement | HTMLSelectElement, value: string, event: 'input' | 'change'): Promise<void> => {
      target.value = value;
      target.dispatchEvent(new Event(event));
      f.detectChanges();
      await f.whenStable();
    };
    await fire(el<HTMLInputElement>('budget'), '800', 'input');
    const lifetime = el('budget').closest('.grid')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    lifetime.checked = true;
    lifetime.dispatchEvent(new Event('change'));
    await fire(el<HTMLSelectElement>('objective'), 'conversions', 'change');
    await fire(el<HTMLInputElement>('pixel-id'), '123456789', 'input');
    const reels = el<HTMLInputElement>('placement-reels');
    reels.checked = true;
    reels.dispatchEvent(new Event('change'));
    await fire(el<HTMLInputElement>('geo-add'), 'DE', 'change');
    await fire(el<HTMLInputElement>('image-url'), 'https://cdn.example.org/meta.png', 'input');
    await type({ instagramUserId: '17841400000000001', dsaBeneficiary: 'Stale Beneficiary', dsaPayor: 'Stale Payor' }, f);
    expect(latest()).toMatchObject({
      metaBudgetUsd: 800,
      metaLifetimeBudget: true,
      metaObjective: 'conversions',
      metaPixelId: '123456789',
      metaPlacements: { reels: true },
      metaGeoTargets: ['US', 'DE'],
      metaImageUrl: 'https://cdn.example.org/meta.png',
      metaInstagramUserId: '17841400000000001',
      metaDsaBeneficiary: 'Stale Beneficiary',
      metaDsaPayor: 'Stale Payor',
    });

    await switchBrief(f, otherBrief());

    expect(latest()).toMatchObject({
      eventSlug: 'oss-na-2026',
      metaBudgetUsd: 500,
      metaLifetimeBudget: false,
      metaObjective: 'traffic',
      metaPixelId: '',
      metaPlacements: { facebookFeed: true, instagramFeed: true, stories: false, reels: false, audienceNetwork: false, messengerInbox: false },
      metaGeoTargets: ['US'],
      metaImageUrl: '',
      metaInstagramUserId: '',
      metaDsaBeneficiary: '',
      metaDsaPayor: '',
    });
    expect(el<HTMLInputElement>('budget').value).toBe('500');
    expect((el('budget').closest('.grid')?.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect(el<HTMLSelectElement>('objective').value).toBe('traffic');
    expect(el('pixel-id')).toBeNull();
    expect(el<HTMLInputElement>('placement-reels').checked).toBe(false);
    expect(el<HTMLInputElement>('image-url').value).toBe('');
    for (const id of ['meta-instagram-user-id', 'meta-dsa-beneficiary', 'meta-dsa-payor']) {
      expect((f.nativeElement.querySelector(`#${id}`) as HTMLInputElement).value).toBe('');
    }

    // The fresh mount's draft is the baseline: nothing but defaults and what the brief seeds.
    const fresh = await mountLive(otherBrief());
    expect(latest()).toEqual(fresh.latest());

    // Instagram Feed is a default placement, so Create needs an account id: typed alike on both sides.
    await type({ instagramUserId: '17841400000000002' }, f);
    const config = (await submitted(f))['metaConfig'];
    expect(config).toMatchObject({
      budgetUsd: 500,
      lifetimeBudget: false,
      objective: 'traffic',
      placements: {},
      geoTargets: ['US'],
      instagramUserId: '17841400000000002',
    });
    for (const key of ['pixelId', 'dsaBeneficiary', 'dsaPayor']) expect(key in config).toBe(false);
    for (const variant of config['variants'] as Record<string, unknown>[]) expect('imageUrl' in variant).toBe(false);
    await type({ instagramUserId: '17841400000000002' }, fresh.f);
    expect(config).toEqual((await submitted(fresh.f))['metaConfig']);
  });

  /** The geos and variants are seeded only from Meta copy, so a brief without any opens on none. */
  it('clears the meta geos and variants when the next brief carries no meta copy', async () => {
    const { f, latest } = await mountLive(brief());
    component(f)['addMetaGeoTarget']('DE');
    expect(latest()?.metaGeoTargets).toEqual(['US', 'DE']);
    expect(component(f)['metaVariants']()).toHaveLength(1);

    await switchBrief(f, otherBrief(false));

    expect(latest()?.metaGeoTargets).toEqual([]);
    expect(component(f)['metaVariants']()).toEqual([]);
  });

  describe.each([
    ['unanswered', undefined],
    ['null', null],
    ['false', false],
  ])('while the capability is %s', (_label, enabled) => {
    it('shows no inputs and sends none of the keys, even for an EU geo', async () => {
      fixture = await mount(enabled);
      await setGeos(['DE']);

      expect(query('implementation-meta-instagram-dsa')).toBeNull();
      const request = await submitted();
      expect(Object.keys(request['metaConfig'])).not.toContain('instagramUserId');
      expect(Object.keys(request['metaConfig'])).not.toContain('dsaBeneficiary');
      expect(Object.keys(request['metaConfig'])).not.toContain('dsaPayor');
    });

    it('ignores a value restored from a draft rather than sending it', async () => {
      fixture = await mount(enabled, { metaInstagramUserId: '123', metaDsaBeneficiary: 'CNCF', metaDsaPayor: 'LF' });

      const request = await submitted();
      expect(Object.keys(request['metaConfig'])).not.toContain('instagramUserId');
      expect(Object.keys(request['metaConfig'])).not.toContain('dsaBeneficiary');
    });
  });

  describe('while the capability is an explicit yes', () => {
    it('renders the three inputs on the LFX wrapper', async () => {
      fixture = await mount(true);

      expect(query('implementation-meta-instagram-dsa')).not.toBeNull();
      for (const id of ['meta-instagram-user-id', 'meta-dsa-beneficiary', 'meta-dsa-payor']) {
        expect(fixture.nativeElement.querySelector(`lfx-input-text #${id}`)).not.toBeNull();
      }
    });

    it('blocks Create until an Instagram id is entered for the default Instagram Feed placement', async () => {
      fixture = await mount(true);

      expect(component()['metaUsesInstagram']()).toBe(true);
      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-meta-instagram-user-id-error')?.textContent).toContain('An Instagram account ID is required');

      await type({ instagramUserId: ' 17841400000000000 ' });
      const request = await submitted();
      expect(request['metaConfig']['instagramUserId']).toBe('17841400000000000');
    });

    it('neither requires nor sends the Instagram id when every Instagram placement is off', async () => {
      fixture = await mount(true);
      component()['metaPlacements'].update((p: Record<string, boolean>) => ({ ...p, instagramFeed: false, stories: false, reels: false }));
      await type({ instagramUserId: '17841400000000000' });

      expect(component()['metaInstagramUserIdError']()).toBeNull();
      const request = await submitted();
      expect(Object.keys(request['metaConfig'])).not.toContain('instagramUserId');
    });

    it('requires both disclosures for an EU geo, naming the countries, and sends them trimmed', async () => {
      fixture = await mount(true);
      await type({ instagramUserId: '17841400000000000' });
      await setGeos(['US', 'DE', 'FR']);

      expect(component()['metaDsaCountries']()).toEqual(['DE', 'FR']);
      expect(component()['canSubmit']()).toBe(false);
      expect(query('implementation-meta-dsa-beneficiary-error')?.textContent).toContain('Required when targeting the EU/EEA (DE, FR).');
      expect(query('implementation-meta-dsa-payor-error')?.textContent).toContain('Required when targeting the EU/EEA (DE, FR).');

      await type({ dsaBeneficiary: '  CNCF ', dsaPayor: ' The Linux Foundation ' });
      const request = await submitted();
      expect(request['metaConfig']['dsaBeneficiary']).toBe('CNCF');
      expect(request['metaConfig']['dsaPayor']).toBe('The Linux Foundation');
    });

    it('refuses a one-sided pair even without an EU geo', async () => {
      fixture = await mount(true);
      await type({ instagramUserId: '17841400000000000', dsaBeneficiary: 'CNCF' });

      expect(component()['metaDsaPayorError']()).toBe('Enter both the beneficiary and the payor, or neither.');
      expect(component()['metaDsaBeneficiaryError']()).toBeNull();
      expect(component()['canSubmit']()).toBe(false);
    });

    it('caps a disclosure at 256 code points, counting an astral-plane character once', async () => {
      fixture = await mount(true);
      await type({ instagramUserId: '17841400000000000', dsaBeneficiary: 'a'.repeat(257), dsaPayor: 'LF' });

      expect(component()['metaDsaBeneficiaryError']()).toBe('Enter at most 256 characters.');
      expect(component()['canSubmit']()).toBe(false);

      // 256 characters of 2 UTF-16 units each: `.length` would be 512, but it is within the cap.
      await type({ dsaBeneficiary: '\u{20000}'.repeat(256) });
      expect(component()['metaDsaBeneficiaryError']()).toBeNull();
      expect(component()['canSubmit']()).toBe(true);
      expect(fixture.nativeElement.querySelector('#meta-dsa-beneficiary')?.getAttribute('maxlength')).toBeNull();
    });

    it('persists the three values in the draft as typed, and restores them on remount', async () => {
      fixture = await mount(true);
      let draft: Record<string, unknown> | undefined;
      component()['draftChange'].subscribe((d: Record<string, unknown>) => (draft = d));
      await type({ instagramUserId: '17841400000000000', dsaBeneficiary: 'CNCF ', dsaPayor: 'LF' });

      expect(draft?.['metaInstagramUserId']).toBe('17841400000000000');
      expect(draft?.['metaDsaBeneficiary']).toBe('CNCF ');
      expect(draft?.['metaDsaPayor']).toBe('LF');

      const restored = await mount(true, { ...draft, metaGeoTargets: ['DE'] });
      let restoredDraft: Record<string, unknown> | undefined;
      component(restored)['draftChange'].subscribe((d: Record<string, unknown>) => (restoredDraft = d));
      expect(component(restored)['metaInstagramDsaForm'].getRawValue()).toEqual({
        instagramUserId: '17841400000000000',
        dsaBeneficiary: 'CNCF ',
        dsaPayor: 'LF',
      });
      // What the checks and the request read, not just what the inputs show (PR #4483 review): a
      // restored id and pair satisfy an Instagram placement and an EU geo, and are sent.
      expect(component(restored)['metaDsaCountries']()).toEqual(['DE']);
      expect(component(restored)['metaInstagramUserIdError']()).toBeNull();
      expect(component(restored)['metaDsaBeneficiaryError']()).toBeNull();
      const request = await submitted(restored);
      expect(request['metaConfig']['instagramUserId']).toBe('17841400000000000');
      expect(request['metaConfig']['dsaBeneficiary']).toBe('CNCF');
      expect(request['metaConfig']['dsaPayor']).toBe('LF');
      // A later edit elsewhere re-emits the restored values, not blanks.
      component(restored)['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026 (edited)');
      expect(restoredDraft?.['metaInstagramUserId']).toBe('17841400000000000');
      expect(restoredDraft?.['metaDsaPayor']).toBe('LF');
    });
  });
});
