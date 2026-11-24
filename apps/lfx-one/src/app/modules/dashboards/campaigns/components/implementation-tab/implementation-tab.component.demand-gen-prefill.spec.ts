// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

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
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('fills the Demand Gen image ad: fitting Demand Gen headlines then Search ones, descriptions and business name', STATE_ONLY, () => {
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
  it('drops lines that differ only in case or spacing, keeping the first spelling, in every seeded list (PR #5387 review)', STATE_ONLY, () => {
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
  it('seeds one line for two that become the same once serialized, a leading U+FEFF included', STATE_ONLY, () => {
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

  it('skips a long headline candidate that repeats a seeded line once Go trims a U+0085', STATE_ONLY, () => {
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

  it('skips a long headline candidate that repeats a seeded line in another case', STATE_ONLY, () => {
    // The five descriptions take D1-D5; "join us" repeats the seeded headline "Join us" in another case.
    const descriptions = ['D1', 'D2', 'D3', 'D4', 'D5', 'join us', 'D7'];
    seed(brief({ google_search: { headlines: [], descriptions }, google_display: { headlines: ['Join us'] } }));

    expect(group('displayCreative')['longHeadline']).toBe('D7');
  });

  it('caps each Demand Gen list at its field max and drops duplicates', STATE_ONLY, () => {
    const headlines = ['Headline 0', 'Headline 0', ...Array.from({ length: 6 }, (_, i) => `Headline ${i + 1}`)];
    seed(brief({ google_display: { headlines, descriptions: [] }, google_search: { headlines: ['Headline 0'] } }));

    const seeded = lines(group('demandGenCreative')['headlines']);
    expect(seeded).toEqual(['Headline 0', 'Headline 1', 'Headline 2', 'Headline 3', 'Headline 4']);
  });

  it('does not seed a business name or call to action wider than its field', STATE_ONLY, () => {
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

  it('fills the display ad, taking as long headline the first Demand Gen headline the headlines did not take', STATE_ONLY, () => {
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

  it("seeds a listed call to action in the list's own spelling on Display and on Demand Gen", STATE_ONLY, () => {
    seed(brief({ google_display: { headlines: ['Join us'], call_to_action: 'learn more' } }));

    expect(group('displayCreative')['callToActionText']).toBe('Learn More');
    expect(group('demandGenCreative')['callToActionText']).toBe('Learn More');
  });

  it('seeds a call to action only on the ad whose list carries it', STATE_ONLY, () => {
    seed(brief({ google_display: { headlines: ['Join us'], call_to_action: 'Install' } }));

    // Install was accepted on the responsive display ad and refused on the Demand Gen image ad.
    expect(group('displayCreative')['callToActionText']).toBe('Install');
    expect(group('demandGenCreative')['callToActionText']).toBe('');
  });

  it('falls back to a Search description the descriptions did not take for the long headline', STATE_ONLY, () => {
    const descriptions = Array.from({ length: 6 }, (_, i) => `Search description ${i + 1}`);
    seed(brief({ google_search: { headlines: ['Join KubeCon EU'], descriptions }, google_display: { headlines: ['Short one'] } }));

    // Five descriptions are taken by the field's max, so the sixth is the first one free.
    expect(group('displayCreative')['longHeadline']).toBe('Search description 6');
  });

  it('leaves the long headline empty when every candidate is already seeded elsewhere', STATE_ONLY, () => {
    seed(brief({ google_search: { headlines: [], descriptions: ['Only description'] }, google_display: { headlines: ['Only headline'] } }));

    expect(group('displayCreative')['longHeadline']).toBe('');
    expect(lines(group('displayCreative')['headlines'])).toEqual(['Only headline']);
  });

  it('leaves both creatives empty, with no notice, when the brief has no generated copy', STATE_ONLY, () => {
    seed(brief(undefined));

    expect(group('demandGenCreative')['headlines']).toBe('');
    expect(group('displayCreative')['longHeadline']).toBe('');
    expect(prefilled('demand-gen')).toBe(false);
    expect(prefilled('display')).toBe(false);
  });

  it('clears both seeds when a brief without copy replaces one with it', STATE_ONLY, () => {
    seed(brief(generated));
    seed(brief(undefined));

    expect(group('demandGenCreative')['headlines']).toBe('');
    expect(group('displayCreative')['headlines']).toBe('');
    expect(prefilled('demand-gen')).toBe(false);
    expect(prefilled('display')).toBe(false);
  });

  it('lets a restored draft win over both seeds', STATE_ONLY, () => {
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

  it('drops the Demand Gen notice once the operator rewrites the seeded copy', STATE_ONLY, () => {
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
  ])('refuses a restored %s call to action outside its list, and says why without waiting for a touch', STATE_ONLY, (groupName, control, value) => {
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
  ])('accepts a listed %s call to action, or none', STATE_ONLY, (groupName, control, value) => {
    seed(brief(undefined), draftWithCreatives({ [groupName]: { [control]: value } }));
    showGroup(groupName);

    expect(component()['campaignForm'].get([groupName, control]).errors).toBeNull();
  });

  it('renders the Display call to action as a select of the documented values with None first', STATE_ONLY, () => {
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
