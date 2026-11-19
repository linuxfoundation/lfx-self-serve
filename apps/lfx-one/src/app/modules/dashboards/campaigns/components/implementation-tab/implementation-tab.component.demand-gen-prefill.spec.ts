// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, GoogleAdsAudiencesResult, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * #1614 (F7). The Demand Gen image ad and the responsive display ad are seeded from the brief on
 * Performance Max's terms: Demand Gen copy first, Search copy filling what is left, every value held
 * to the channel's own catalogue bounds and never truncated, and the draft restore still winning.
 */
describe('ImplementationTabComponent Demand Gen and Display prefill', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  /** 39 wide: fits a Demand Gen video headline and a long headline, not the 30-wide image ad headline. */
  const wide = 'The cloud native conference of the year';

  function brief(structuredCopy: Record<string, unknown> | undefined): CampaignBriefOutput {
    return {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/kubecon', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      structuredCopy,
    } as unknown as CampaignBriefOutput;
  }

  function seed(b: CampaignBriefOutput | null, draft?: CampaignImplementationDraft): void {
    if (draft !== undefined) fixture.componentRef.setInput('draft', draft);
    fixture.componentRef.setInput('briefData', b);
    fixture.detectChanges();
  }

  function component(): Record<string, any> {
    return fixture.componentInstance as unknown as Record<string, any>;
  }

  function group(name: 'demandGenCreative' | 'displayCreative' | 'searchAssets'): Record<string, string> {
    return component()['campaignForm'].controls[name].getRawValue();
  }

  function lines(value: string): string[] {
    return value === '' ? [] : value.split('\n');
  }

  function prefilled(channel: string): boolean {
    return component()['googleCreativePrefillShown']()[channel] === true;
  }

  function show(channel: 'includeDemandGen' | 'includeDisplay'): void {
    fixture.componentRef.setInput('demandGenEnabled', true);
    fixture.componentRef.setInput('googleChannelsEnabled', true);
    fixture.componentRef.setInput('googleCreativeEnabled', true);
    component()['campaignForm'].patchValue({ includeSearch: false, [channel]: true });
    fixture.detectChanges();
  }

  function notice(channel: string): string | undefined {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="implementation-creative-prefill-notice-${channel}"]`)?.textContent ?? undefined;
  }

  const generated = {
    google_search: {
      headlines: ['Join KubeCon EU', 'Register for KubeCon'],
      descriptions: [
        'Three days of talks, workshops and the hallway track with the cloud native community.',
        'Meet the maintainers and end users of the CNCF projects you run in production.',
      ],
    },
    google_display: {
      headlines: ['KubeCon EU 2026 in Amsterdam', wide, 'Where cloud native meets'],
      descriptions: ['Register now for KubeCon EU 2026.'],
      business_name: 'CNCF',
      call_to_action: 'Register',
    },
  };

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
  });

  it('fills the Demand Gen image ad: fitting Demand Gen headlines then Search ones, descriptions and business name', () => {
    seed(brief(generated));

    // The 39-wide headline is left out, not cut to 30; the Search headlines fill the slots it leaves.
    expect(lines(group('demandGenCreative')['headlines'])).toEqual([
      'KubeCon EU 2026 in Amsterdam',
      'Where cloud native meets',
      'Join KubeCon EU',
      'Register for KubeCon',
    ]);
    expect(lines(group('demandGenCreative')['descriptions'])).toEqual([...generated.google_display.descriptions, ...generated.google_search.descriptions]);
    expect(group('demandGenCreative')['businessName']).toBe('CNCF');
    // "Register" is not on this ad's list (Google refused it live, F13), so nothing is seeded.
    expect(group('demandGenCreative')['callToActionText']).toBe('');
    expect(prefilled('demand-gen')).toBe(true);
  });

  /** campaign-service refuses two lines equal after trim and lower-casing (`validateCreativeText`). */
  it('drops lines that differ only in case or spacing, keeping the first spelling, in every seeded list (PR #5387 review)', () => {
    seed(
      brief({
        google_search: {
          headlines: ['Join KubeCon EU', 'join kubecon eu ', 'JOIN KUBECON EU', 'Register now'],
          descriptions: ['See you there.', 'see you there.'],
        },
        google_display: { headlines: ['Join KubeCon EU'], descriptions: ['SEE YOU THERE.'] },
      })
    );

    expect(lines(group('demandGenCreative')['headlines'])).toEqual(['Join KubeCon EU', 'Register now']);
    expect(lines(group('demandGenCreative')['descriptions'])).toEqual(['SEE YOU THERE.']);
    expect(lines(group('displayCreative')['headlines'])).toEqual(['Join KubeCon EU', 'Register now']);
    const pmax = component()['campaignForm'].controls['performanceMaxCreative'].getRawValue();
    expect(lines(pmax['headlines'])).toEqual(['Join KubeCon EU', 'Register now']);
    expect(lines(pmax['descriptions'])).toEqual(['See you there.']);
  });

  /** PR #5389 review: the payload trims a leading U+FEFF, so the seed must de-duplicate on what is sent. */
  it('seeds one line for two that become the same once serialized, a leading U+FEFF included', () => {
    seed(brief({ google_search: { headlines: ['Join us', '\uFEFFJoin us', 'Register now'], descriptions: [] } }));
    show('includeDemandGen');

    const payload = component()['googleCreativePayload']()['demandGenCreative'] as Record<string, unknown>;
    expect(payload['headlines']).toEqual(['Join us', 'Register now']);
  });

  /**
   * PR #5389 review: JS `trim()` keeps a trailing U+0085 that Go's `strings.TrimSpace` strips, so the
   * payload carries "Join us\u0085" and campaign-service refuses it as a repeat of "Join us".
   */
  it.each([
    ['Demand Gen', 'includeDemandGen', 'demandGenCreative'],
    ['Display', 'includeDisplay', 'displayCreative'],
  ] as const)('seeds one %s headline for two that Go trims to the same line, a trailing U+0085 included', (_label, channel, key) => {
    seed(brief({ google_search: { headlines: ['Join us', 'Join us\u0085', '\u0085join US', 'Register now'], descriptions: [] } }));
    show(channel);

    const payload = component()['googleCreativePayload']()[key] as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(payload['headlines']))).toEqual(['Join us', 'Register now']);
  });

  it('seeds one Performance Max headline for two that Go trims to the same line, a trailing U+0085 included', () => {
    seed(brief({ google_search: { headlines: ['Join us', 'Join us\u0085', 'Register now'], descriptions: [] } }));

    const pmax = component()['campaignForm'].controls['performanceMaxCreative'].getRawValue();
    expect(lines(pmax['headlines'])).toEqual(['Join us', 'Register now']);
  });

  it('skips a long headline candidate that repeats a seeded line once Go trims a U+0085', () => {
    const descriptions = ['D1', 'D2', 'D3', 'D4', 'D5', 'Join us\u0085', 'D7'];
    seed(brief({ google_search: { headlines: [], descriptions }, google_display: { headlines: ['Join us'] } }));

    expect(group('displayCreative')['longHeadline']).toBe('D7');

    // And the other way round: the seeded headline carries the U+0085, the candidate does not.
    seed(
      brief({
        google_search: { headlines: [], descriptions: ['D1', 'D2', 'D3', 'D4', 'D5', 'Join us', 'D7'] },
        google_display: { headlines: ['Join us\u0085'] },
      })
    );

    expect(group('displayCreative')['longHeadline']).toBe('D7');
  });

  it('skips a long headline candidate that repeats a seeded line in another case', () => {
    // The five descriptions take D1-D5; "join us" repeats the seeded headline "Join us" in another case.
    const descriptions = ['D1', 'D2', 'D3', 'D4', 'D5', 'join us', 'D7'];
    seed(brief({ google_search: { headlines: [], descriptions }, google_display: { headlines: ['Join us'] } }));

    expect(group('displayCreative')['longHeadline']).toBe('D7');
  });

  it('caps each Demand Gen list at its field max and drops duplicates', () => {
    const headlines = ['Headline 0', 'Headline 0', ...Array.from({ length: 6 }, (_, i) => `Headline ${i + 1}`)];
    seed(brief({ google_display: { headlines, descriptions: [] }, google_search: { headlines: ['Headline 0'] } }));

    const seeded = lines(group('demandGenCreative')['headlines']);
    expect(seeded).toEqual(['Headline 0', 'Headline 1', 'Headline 2', 'Headline 3', 'Headline 4']);
  });

  it('does not seed a business name or call to action wider than its field', () => {
    seed(brief({ google_display: { headlines: ['Join us'], business_name: 'x'.repeat(26), call_to_action: 'y'.repeat(31) } }));

    expect(group('demandGenCreative')['businessName']).toBe('');
    expect(group('demandGenCreative')['callToActionText']).toBe('');
    expect(group('displayCreative')['businessName']).toBe('');
    expect(group('displayCreative')['callToActionText']).toBe('');
    expect(group('searchAssets')['businessName']).toBe('');
    expect(prefilled('search')).toBe(false);
  });

  /**
   * #5262: the Search assets are never seeded, not even the business name the other three channels take
   * from the brief. campaign-service links them before the ad groups and returns on a refusal there,
   * leaving the campaign without its ads, so they are sent only when the operator adds them.
   */
  it('leaves the Search assets empty, with no notice, while the other channels take the business name', () => {
    seed(brief(generated));

    expect(group('searchAssets')).toEqual({ businessName: '', adImages: '', landscapeAdImages: '', businessLogoImages: '' });
    expect(prefilled('search')).toBe(false);
    expect(group('demandGenCreative')['businessName']).toBe('CNCF');
    expect(group('displayCreative')['businessName']).toBe('CNCF');
    expect(component()['campaignForm'].controls.performanceMaxCreative.getRawValue()['businessName']).toBe('CNCF');
    fixture.componentRef.setInput('demandGenEnabled', true);
    fixture.componentRef.setInput('googleChannelsEnabled', true);
    fixture.componentRef.setInput('googleCreativeEnabled', true);
    component()['campaignForm'].patchValue({ includeSearch: true });
    fixture.detectChanges();
    const sections: { channel: string }[] = component()['googleCreativeSections']();
    expect(sections.map((section) => section.channel)).toEqual(['search']);
    expect(notice('search')).toBeUndefined();
    expect(component()['googleCreativeWirePayload']()).toEqual({});
  });

  it('fills the display ad, taking as long headline the first Demand Gen headline the headlines did not take', () => {
    seed(brief(generated));

    expect(lines(group('displayCreative')['headlines'])).toEqual([
      'KubeCon EU 2026 in Amsterdam',
      'Where cloud native meets',
      'Join KubeCon EU',
      'Register for KubeCon',
    ]);
    expect(group('displayCreative')['longHeadline']).toBe(wide);
    expect(lines(group('displayCreative')['descriptions'])).toEqual([...generated.google_display.descriptions, ...generated.google_search.descriptions]);
    expect(group('displayCreative')['businessName']).toBe('CNCF');
    // "Register" is not on Google's documented list for this ad (F13), so it is not seeded.
    expect(group('displayCreative')['callToActionText']).toBe('');
    expect(prefilled('display')).toBe(true);
  });

  it("seeds a listed call to action in the list's own spelling on Display and on Demand Gen", () => {
    seed(brief({ google_display: { headlines: ['Join us'], call_to_action: 'learn more' } }));

    expect(group('displayCreative')['callToActionText']).toBe('Learn More');
    expect(group('demandGenCreative')['callToActionText']).toBe('Learn More');
  });

  it('seeds a call to action only on the ad whose list carries it', () => {
    seed(brief({ google_display: { headlines: ['Join us'], call_to_action: 'Install' } }));

    // Install was accepted on the responsive display ad and refused on the Demand Gen image ad.
    expect(group('displayCreative')['callToActionText']).toBe('Install');
    expect(group('demandGenCreative')['callToActionText']).toBe('');
  });

  it('falls back to a Search description the descriptions did not take for the long headline', () => {
    const descriptions = Array.from({ length: 6 }, (_, i) => `Search description ${i + 1}`);
    seed(brief({ google_search: { headlines: ['Join KubeCon EU'], descriptions }, google_display: { headlines: ['Short one'] } }));

    // Five descriptions are taken by the field's max, so the sixth is the first one free.
    expect(group('displayCreative')['longHeadline']).toBe('Search description 6');
  });

  it('leaves the long headline empty when every candidate is already seeded elsewhere', () => {
    seed(brief({ google_search: { headlines: [], descriptions: ['Only description'] }, google_display: { headlines: ['Only headline'] } }));

    expect(group('displayCreative')['longHeadline']).toBe('');
    expect(lines(group('displayCreative')['headlines'])).toEqual(['Only headline']);
  });

  it('leaves both creatives empty, with no notice, when the brief has no generated copy', () => {
    seed(brief(undefined));

    expect(group('demandGenCreative')['headlines']).toBe('');
    expect(group('displayCreative')['longHeadline']).toBe('');
    expect(prefilled('demand-gen')).toBe(false);
    expect(prefilled('display')).toBe(false);
  });

  it('clears both seeds when a brief without copy replaces one with it', () => {
    seed(brief(generated));
    seed(brief(undefined));

    expect(group('demandGenCreative')['headlines']).toBe('');
    expect(group('displayCreative')['headlines']).toBe('');
    expect(prefilled('demand-gen')).toBe(false);
    expect(prefilled('display')).toBe(false);
  });

  it('lets a restored draft win over both seeds', () => {
    const draft = {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://events.example.com/kubecon',
      headlines: [''],
      descriptions: [''],
      googleCreatives: {
        demandGenCreative: { headlines: 'Operator headline', descriptions: '', businessName: 'Operator Co', callToActionText: '' },
        displayCreative: { headlines: '', longHeadline: 'Operator long headline', descriptions: '', businessName: '', callToActionText: '' },
      },
    } as unknown as CampaignImplementationDraft;
    seed(brief(generated), draft);

    expect(group('demandGenCreative')['headlines']).toBe('Operator headline');
    expect(group('demandGenCreative')['callToActionText']).toBe('');
    expect(group('displayCreative')['longHeadline']).toBe('Operator long headline');
    expect(prefilled('demand-gen')).toBe(false);
    expect(prefilled('display')).toBe(false);
  });

  it('drops the Demand Gen notice once the operator rewrites the seeded copy', () => {
    seed(brief(generated));
    component()['campaignForm'].controls['demandGenCreative'].patchValue({
      headlines: 'Mine',
      descriptions: 'Mine too',
      businessName: 'Mine Co',
      callToActionText: 'Go',
    });

    expect(prefilled('demand-gen')).toBe(false);
    expect(prefilled('display')).toBe(true);
  });

  it('shows the prefill notice on the Demand Gen section for the image ad, and not over the video ad', () => {
    seed(brief(generated));
    show('includeDemandGen');

    expect(notice('demand-gen')).toContain('filled in from the brief');
    component()['campaignForm'].controls.demandGenAdFormat.setValue('video');
    fixture.detectChanges();
    expect(notice('demand-gen')).toBeUndefined();
  });

  it('hides the Demand Gen notice while the campaign is split into ad groups', () => {
    seed(brief(generated));
    show('includeDemandGen');
    component()['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    fixture.detectChanges();

    expect(notice('demand-gen')).toBeUndefined();
  });

  /** A draft holding only the given creatives, as the parent would hand one back. */
  function draftWithCreatives(googleCreatives: Record<string, Record<string, string>>): CampaignImplementationDraft {
    return {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://events.example.com/kubecon',
      headlines: [''],
      descriptions: [''],
      googleCreatives,
    } as unknown as CampaignImplementationDraft;
  }

  /** On screen, since a hidden creative group is disabled and neither validated nor sent. */
  function showGroup(groupName: string): void {
    show(groupName === 'displayCreative' ? 'includeDisplay' : 'includeDemandGen');
    if (groupName === 'demandGenVideoCreative') {
      component()['campaignForm'].controls.demandGenAdFormat.setValue('video');
      fixture.detectChanges();
    }
  }

  it.each([
    ['displayCreative', 'callToActionText', 'Register'],
    ['demandGenCreative', 'callToActionText', 'Register'],
    ['demandGenVideoCreative', 'callToAction', 'REGISTER'],
  ])('refuses a restored %s call to action outside its list, and says why without waiting for a touch', (groupName, control, value) => {
    seed(brief(undefined), draftWithCreatives({ [groupName]: { [control]: value } }));
    showGroup(groupName);

    const field = component()['campaignForm'].get([groupName, control]);
    expect(field.value).toBe(value);
    expect(field.errors?.['creativeOption']).toBeDefined();
    expect(field.touched).toBe(false);
    expect(component()['creativeControlError'](field)).toContain('does not accept');
  });

  it.each([
    ['displayCreative', 'callToActionText', 'Learn More'],
    ['demandGenVideoCreative', 'callToAction', 'SIGN_UP'],
    ['demandGenCreative', 'callToActionText', 'Donate Now'],
    ['demandGenCreative', 'callToActionText', ''],
  ])('accepts a listed %s call to action, or none', (groupName, control, value) => {
    seed(brief(undefined), draftWithCreatives({ [groupName]: { [control]: value } }));
    showGroup(groupName);

    expect(component()['campaignForm'].get([groupName, control]).errors).toBeNull();
  });

  it('renders the Display call to action as a select of the documented values with None first', () => {
    seed(brief(generated));
    show('includeDisplay');

    const sections = component()['googleCreativeSections']();
    const options = sections
      .find((section: { channel: string }) => section.channel === 'display')
      .fields.find((field: { control: string }) => field.control === 'callToActionText')
      .selectOptions.map((option: { value: string }) => option.value);
    expect(options[0]).toBe('');
    expect(options).toContain('Learn More');
    expect(options).not.toContain('Register');
  });

  it('shows the prefill notice on the Display section when the copy came from the brief', () => {
    seed(brief(generated));
    show('includeDisplay');

    expect(notice('display')).toContain('the long headline');
  });
});

/**
 * Demand Gen demographics (linuxfoundation/lfx-v2-campaign-service#498, #518): the single ad group's and
 * each named group's, built upstream into an Audience of their own. Pins what the create sends, that the
 * tab never offers an Audience and demographics together, that Create waits on the shared refusal, and
 * that retained demographics are held rather than dropped.
 */
describe('ImplementationTabComponent demand gen demographics', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const ACCOUNT = '1234567890';
  const AUDIENCE_A = `customers/${ACCOUNT}/audiences/111`;
  const AUDIENCES: GoogleAdsAudiencesResult = {
    accountId: ACCOUNT,
    audiences: [{ resourceName: AUDIENCE_A, id: '111', name: 'Example Summit - High Intent', description: null }],
    truncated: false,
  };
  const IMAGE_COMPLETE = {
    headlines: 'One headline',
    descriptions: 'A description',
    businessName: 'Acme',
    logoImages: 'https://example.com/logo.png',
    marketingImages: 'https://example.com/a.png',
  };
  const VIDEO_COMPLETE = {
    youtubeVideoIds: 'dQw4w9WgXcQ',
    headlines: 'Join us in Salt Lake City',
    longHeadlines: 'Four days of cloud native talks and labs',
    descriptions: 'Register today',
    businessName: 'Acme',
    callToAction: 'SIGN_UP',
    logoImages: 'https://example.com/logo.png',
  };
  /** The live KubeCon NA Demand Gen Audience's ages: 18-24, 55-64 and 65+ left out, Unknown kept. */
  const LIVE_AGES = { ageRanges: ['25-34', '35-44', '45-54', 'UNDETERMINED'] };

  beforeEach(async () => {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsAudiences').mockReturnValue(of(AUDIENCES) as never);
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedDemandGen(): Record<string, any> {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', true);
    fixture.detectChanges();
    return c;
  }

  function split(c: Record<string, any>, names: string[]): void {
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    for (let i = 1; i < names.length; i++) c['addDemandGenAdGroup']();
    names.forEach((name, i) => {
      const controls = c['campaignForm'].controls.demandGenAdGroups.at(i).controls;
      controls.name.setValue(name);
      controls.creative.patchValue(IMAGE_COMPLETE);
    });
    fixture.detectChanges();
  }

  async function requestOf(c: Record<string, any>): Promise<Record<string, unknown>> {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    createCampaign.mockClear();
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);
    c['submit']();
    await fixture.whenStable();
    return createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
  }

  function tick(testId: string): void {
    (query(testId)?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
  }

  it("sends the live campaign's ages for the single ad group, ticked through the boxes, with income and parental status left open", async () => {
    const c = seedDemandGen();
    expect(c['googleDemandGenDemographicsPayload']()).toEqual({});

    for (const age of ['25-34', '35-44', '45-54', 'UNDETERMINED']) tick(`implementation-demand-gen-demographics-single-ageRanges-${age}`);

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ ageRanges: ['25-34', '35-44', '45-54', 'UNDETERMINED'] });
    const request = await requestOf(c);
    expect(request['demandGenDemographics']).toEqual(LIVE_AGES);
    expect(request['demandGenDemographics']).not.toBe(c['campaignForm'].controls.demandGenDemographics.value);
  });

  it('sends them beside a video ad as beside an image ad', async () => {
    const c = seedDemandGen();
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenVideoCreative.patchValue(VIDEO_COMPLETE);
    c['onDemandGenDemographicsChange'](null, { genders: ['FEMALE'] });

    expect((await requestOf(c))['demandGenDemographics']).toEqual({ genders: ['FEMALE'] });
  });

  it('notes a dimension left out because it names every value and Unknown', () => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, { ageRanges: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'UNDETERMINED'], genders: ['MALE'] });
    fixture.detectChanges();

    expect(query('implementation-demand-gen-demographics-left-out-single')?.textContent).toContain(
      'Every age value is ticked, Unknown included, so it narrows nothing and Google Ads leaves it out of the Audience.'
    );
    expect(c['demandGenDemographicsError']()).toBeNull();
  });

  it.each([
    [{ genders: ['UNDETERMINED'] }, 'holds only Unknown'],
    [{ genders: ['MALE', 'FEMALE', 'UNDETERMINED'] }, 'restrict nobody'],
  ])('holds Create on %j with the shared refusal under the section', (demographics, message) => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, demographics);
    fixture.detectChanges();

    expect(c['demandGenDemographicsError']()).toContain(message);
    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-demand-gen-demographics-error')?.textContent).toContain(message);
    expect(query('implementation-demand-gen-demographics-error-live')?.textContent).toContain(message);
  });

  it('holds the Audience picker back while demographics are set, and the demographics back while an Audience is picked', () => {
    const c = seedDemandGen();
    expect(query('implementation-demand-gen-audience-picker-single')).not.toBeNull();

    c['onDemandGenDemographicsChange'](null, { genders: ['FEMALE'] });
    fixture.detectChanges();
    expect(query('implementation-demand-gen-audience-picker-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-held-by-demographics-single')).not.toBeNull();

    c['onDemandGenDemographicsChange'](null, { genders: [] });
    c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
    fixture.detectChanges();
    expect(query('implementation-demand-gen-demographics-targeting-single')).toBeNull();
    expect(query('implementation-demand-gen-demographics-held-by-audience-single')?.textContent).toContain('one Audience per Demand Gen ad group');
  });

  it('keeps restored demographics beside a restored Audience on show, and holds Create until one goes', () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: AUDIENCE_A, demandGenDemographics: { genders: ['FEMALE', 7] } });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ genders: ['FEMALE'] });
    expect(query('implementation-demand-gen-demographics-targeting-single')).not.toBeNull();
    expect(c['demandGenDemographicsError']()).toContain('cannot both be set');
    expect(c['canSubmit']()).toBe(false);

    c['removeDemandGenAudience'](null);
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it("sends each named group's own demographics, none for a group with an Audience, and holds the single ad group's while split", async () => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, { genders: ['MALE'] });
    split(c, ['Retargeting', 'Prospecting']);
    c['onDemandGenDemographicsChange'](0, LIVE_AGES);
    c['onDemandGenAudiencePicked'](1, AUDIENCE_A);
    fixture.detectChanges();

    expect(query('implementation-demand-gen-demographics-held')?.textContent).toContain('kept but not sent while the campaign is split');
    expect(query('implementation-demand-gen-demographics-targeting-0')).not.toBeNull();
    expect(query('implementation-demand-gen-demographics-held-by-audience-1')).not.toBeNull();
    const request = await requestOf(c);
    expect(request).not.toHaveProperty('demandGenDemographics');
    expect((request['demandGenAdGroups'] as Record<string, unknown>[]).map((group) => [group['name'], group['demographics'], group['audience']])).toEqual([
      ['Retargeting', LIVE_AGES, undefined],
      ['Prospecting', undefined, AUDIENCE_A],
    ]);
  });

  it("holds Create on a group's refusal, and names a group's demographics among what the split, turned off, keeps", () => {
    const c = seedDemandGen();
    split(c, ['Retargeting']);
    c['onDemandGenDemographicsChange'](0, { parentalStatuses: ['UNDETERMINED'] });
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toContain('the demographics of Demand Gen ad group 1 holds only Unknown');
    expect(c['canSubmit']()).toBe(false);

    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.setValue('');
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.creative.reset();
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toBeNull();
    expect(c['demandGenAdGroupsHeldMessage']()).toContain('ad group you entered is kept but not sent');
  });

  it('holds Create naming the deployment while the cutover is dark, listing the held ad group with Clear', () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenDemographics: LIVE_AGES });
    fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'brief-1', message: null, approved: true });
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleDemandGenDemographicsPayload']()).toEqual({});
    expect(c['demandGenDemographicsBlock']()?.kind).toBe('unsupported');
    expect(query('implementation-demand-gen-demographics-block-unsupported')?.textContent).toContain('not available on this deployment');
    expect(query('implementation-demand-gen-demographics-block-list')?.textContent).toContain('Single ad group');
    expect(query('implementation-demand-gen-demographics-block-live')?.textContent?.trim()).toBe(c['demandGenDemographicsBlockMessage']());
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-demographics-block-clear')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({});
    expect(c['demandGenDemographicsBlock']()).toBeNull();
  });

  it.each([
    ['pending', null, 'pending', 'brief-1'],
    ['unsaved', null, 'ready', null],
    ['failed', null, 'failed', 'brief-1'],
  ])('holds Create with the %s kind while the create path is unanswered', (kind, creative, read, briefId) => {
    const c = seedDemandGen();
    split(c, ['Retargeting']);
    c['onDemandGenDemographicsChange'](0, LIVE_AGES);
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleCreativeEnabled', creative);
    fixture.detectChanges();

    expect(c['demandGenDemographicsBlock']()?.kind).toBe(kind);
    expect(c['demandGenDemographicsRetained']()).toEqual(['Retargeting']);
    expect(c['canSubmit']()).toBe(false);
  });

  it('holds nothing once Demand Gen is no longer selected', () => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, LIVE_AGES);
    c['campaignForm'].patchValue({ includeDemandGen: false, includeDisplay: true });
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['demandGenDemographicsBlock']()).toBeNull();
  });

  it('round-trips the single and per-group demographics through a draft, and empties them for a new brief', () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, { incomeRanges: ['INCOME_RANGE_90_UP'], genders: [] });
    split(c, ['Retargeting']);
    c['onDemandGenDemographicsChange'](0, LIVE_AGES);

    expect(emitted?.demandGenDemographics).toEqual({ incomeRanges: ['INCOME_RANGE_90_UP'] });
    expect(emitted?.demandGenAdGroups?.[0].demographics).toEqual(LIVE_AGES);

    c['resetGoogleFields']();
    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({});
    restoreGoogleDraft(fixture, c, {
      demandGenDemographics: { parentalStatuses: ['PARENT'] },
      demandGenAdGroups: [{ name: 'Retargeting', format: 'image', creative: {}, videoCreative: {}, demographics: 'junk' }],
    });

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ parentalStatuses: ['PARENT'] });
    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.demographics.value).toEqual({});
  });

  /** PR #5390 review: the payload trims the Audience, so a blank one is none and holds nothing back. */
  it('reads a whitespace-only Audience as none, offering the picker and the demographics', () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: '   ' });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();

    expect(c['googleDemandGenAudiencePayload']()).toEqual({});
    expect(query('implementation-demand-gen-demographics-held-by-audience-single')).toBeNull();
    expect(query('implementation-demand-gen-demographics-targeting-single')).not.toBeNull();
    expect(query('implementation-demand-gen-audience-picked-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-picker-single')).not.toBeNull();
  });

  /** PR #5390 review: a restored value no box offers cannot be unticked, so Clear is the way out of its refusal. */
  it('clears a restored value no box offers, releasing Create, and moves focus to the first box', async () => {
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedDemandGen();
    expect(query('implementation-demand-gen-demographics-clear-single')).toBeNull();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenDemographics: { genders: ['NOPE'] } });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toContain('cannot target the gender');
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-demographics-clear-single')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({});
    expect(c['demandGenDemographicsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
    expect(query('implementation-demand-gen-demographics-clear-single')).toBeNull();
    expect(focused.at(-1)).toBe(query('implementation-demand-gen-demographics-targeting-single')?.querySelector('input'));
  });

  it("clears one named group's demographics alone, and moves focus to its Audience's Remove when one is picked", async () => {
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedDemandGen();
    split(c, ['Retargeting', 'Prospecting']);
    c['onDemandGenDemographicsChange'](0, { genders: ['NOPE'] });
    c['onDemandGenDemographicsChange'](1, { genders: ['FEMALE'] });
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.audience.setValue(AUDIENCE_A);
    fixture.detectChanges();

    (query('implementation-demand-gen-demographics-clear-0')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.demographics.value).toEqual({});
    expect(c['campaignForm'].controls.demandGenAdGroups.at(1).controls.demographics.value).toEqual({ genders: ['FEMALE'] });
    expect(query('implementation-demand-gen-demographics-held-by-audience-0')).not.toBeNull();
    expect(focused.at(-1)).toBe(fixture.nativeElement.querySelector('#demand-gen-audience-0-remove'));
  });

  /** PR #5390 review: upstream takes both spellings, but only one has a box, so a restore shows the box's. */
  it("restores each accepted spelling as its box's, single and per group, keeping an unknown value for the refusal", () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenDemographics: { ageRanges: ['AGE_RANGE_25_34', '25-34', 'NOPE'], genders: ['female'] },
      demandGenAdGroups: [
        {
          name: 'Retargeting',
          format: 'image',
          creative: {},
          videoCreative: {},
          demographics: { incomeRanges: ['INCOME_RANGE_UNDETERMINED', 'income_range_90_up'] },
        },
      ],
    });

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ ageRanges: ['25-34', 'NOPE'], genders: ['FEMALE'] });
    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.demographics.value).toEqual({ incomeRanges: ['UNDETERMINED', 'INCOME_RANGE_90_UP'] });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();
    expect((query('implementation-demand-gen-demographics-single-ageRanges-25-34')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(c['demandGenDemographicsError']()).toContain('NOPE');
  });

  it("restores Display's targeting and the demographic exclusions in their boxes' spellings too", () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, {
      googleDisplayDemographics: { ageRanges: ['AGE_RANGE_18_24'], parentalStatuses: ['not_a_parent'] },
      googleExcludedAgeRanges: ['AGE_RANGE_65_UP', '65+'],
      googleExcludedGenders: ['male'],
      googleExcludedIncomeRanges: ['INCOME_RANGE_UNDETERMINED'],
      googleExcludedParentalStatuses: ['parent', 'NOPE'],
    });

    expect(c['googleDisplayDemographics']()).toEqual({ ageRanges: ['18-24'], parentalStatuses: ['NOT_A_PARENT'] });
    expect(c['googleExcludedAgeRanges']()).toEqual(['65+']);
    expect(c['googleExcludedGenders']()).toEqual(['MALE']);
    expect(c['googleExcludedIncomeRanges']()).toEqual(['UNDETERMINED']);
    expect(c['googleExcludedParentalStatuses']()).toEqual(['PARENT', 'NOPE']);
  });

  /** The #5393 fix round's Demand Gen audience gate, for the demographics: `demandGenEnabled` null hides the checkbox. */
  describe.each([['pending'], ['failed']] as const)('with the Demand Gen capability unanswered (read %s)', (read) => {
    function holdDemographics(): Record<string, any> {
      const c = seedDemandGen();
      restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenDemographics: LIVE_AGES });
      fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'brief-1', message: null, approved: true });
      fixture.componentRef.setInput('createCapabilityRead', read);
      fixture.componentRef.setInput('googleCreativeEnabled', null);
      fixture.componentRef.setInput('demandGenEnabled', null);
      fixture.detectChanges();
      return c;
    }

    it('keeps the block with its Retry and Clear, and Create held, though selectedGoogleChannels drops Demand Gen', () => {
      const retried = vi.fn();
      fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
      const c = holdDemographics();

      expect(c['selectedGoogleChannels']()).not.toContain('demand-gen');
      expect(query('implementation-include-demand-gen')).toBeNull();
      expect(c['demandGenDemographicsBlock']()?.kind).toBe(read);
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-demand-gen-demographics-block-clear')).not.toBeNull();
      expect(query('implementation-demand-gen-demographics-block-retry') !== null).toBe(read === 'failed');
      if (read === 'failed') {
        (query('implementation-demand-gen-demographics-block-retry')?.querySelector('button') as HTMLButtonElement).click();
        expect(retried).toHaveBeenCalledTimes(1);
      }
    });

    it('falls back to the Search checkbox on Clear, the Demand Gen checkbox being hidden and Create disabled', async () => {
      const focused: HTMLElement[] = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
      const c = holdDemographics();

      (query('implementation-demand-gen-demographics-block-clear')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c['demandGenDemographicsBlock']()).toBeNull();
      expect(focused.at(-1)).toBe(query('implementation-include-search'));
    });

    it('clears the block only once the Demand Gen capability is answered no', () => {
      const c = holdDemographics();
      expect(c['demandGenDemographicsBlock']()?.kind).toBe(read);

      fixture.componentRef.setInput('demandGenEnabled', false);
      fixture.detectChanges();
      expect(c['demandGenDemographicsBlock']()).toBeNull();
    });
  });
});
