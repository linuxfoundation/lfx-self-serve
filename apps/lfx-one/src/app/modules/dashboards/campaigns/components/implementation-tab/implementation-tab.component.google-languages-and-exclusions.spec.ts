// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS, GOOGLE_ADS_MAX_LANGUAGES } from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The Google language chips.
 *
 * The control is a `<select>` over the supported table's own keys, so the guards left are the ones
 * a select cannot express — the cap, not adding a code twice — plus the CHANNEL gate, which the geo
 * sibling has no equivalent of. Every channel takes languages since campaign-service v1.0.31 (Demand
 * Gen attaches them to its ad group, #459), so the gate is open everywhere and the section and the
 * payload follow `GOOGLE_CHANNELS_WITH_LANGUAGES` if upstream fences a channel again.
 */
describe('ImplementationTabComponent google languages', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('adds a code once and refuses a duplicate or a blank', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const { code } = c['googleLanguageOptions'][0];

    c['addGoogleLanguage'](code);
    c['addGoogleLanguage'](code);
    c['addGoogleLanguage']('');

    expect(c['googleLanguages']()).toEqual([code]);
  });

  it('refuses an add at the cap', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    // The curated table holds 39 codes and the cap is 40, so the cap cannot be reached from the
    // select alone — the list is seeded past it to exercise the guard the select cannot express.
    c['googleLanguages'].set(Array.from({ length: GOOGLE_ADS_MAX_LANGUAGES }, (_, i) => `X${i}`));

    c['addGoogleLanguage'](c['googleLanguageOptions'][0].code);

    expect(c['googleLanguages']()).toHaveLength(GOOGLE_ADS_MAX_LANGUAGES);
  });

  it('removes a chip by index', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const [first, second] = c['googleLanguageOptions'];
    c['addGoogleLanguage'](first.code);
    c['addGoogleLanguage'](second.code);

    c['removeGoogleLanguage'](0);

    expect(c['googleLanguages']()).toEqual([second.code]);
  });

  /**
   * Sorted by the English NAME, because that is what the options render, under a PINNED `en`
   * collation — the endpoints are asserted by value so the order cannot quietly follow whichever
   * locale runs the suite.
   */
  it('offers the languages in name order', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const labels = c['googleLanguageOptions'].map((o: { label: string }) => o.label);

    expect(labels).toEqual([...labels].sort((a: string, b: string) => a.localeCompare(b, 'en')));
    expect(labels[0]).toBe('Arabic');
    expect(labels.at(-1)).toBe('Vietnamese');
  });

  /**
   * Chips read as the name the select offered, not the code. A restored draft is the other source
   * of a code, so an unknown one falls back to itself — including an inherited `Object.prototype`
   * key, which a plain-object index would have resolved to a function (#3504).
   */
  it.each([
    ['DE', 'German'],
    ['ZZ', 'ZZ'],
    ['constructor', 'constructor'],
  ])('names the chip for %s as %s', (code, name) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googleLanguages'].set([code]);
    fixture.detectChanges();

    expect(c['googleLanguageChips']()).toEqual([{ code, name }]);
    const remove = fixture.nativeElement.querySelector(`[data-testid="implementation-google-language-remove-${code}"]`);
    expect(remove?.getAttribute('aria-label')).toBe(`Remove ${name}`);
  });

  it.each([
    ['search', { includeSearch: true }],
    ['demand-gen', { includeDemandGen: true }],
    ['performance-max', { includePerformanceMax: true }],
    ['display', { includeDisplay: true }],
  ])('opens the section on %s, which upstream accepts campaign languages on', (channel, patch) => {
    const c = seedChannel(fixture, patch);

    expect(c['googleLanguagesChannel']()).toBe(channel);
  });

  /**
   * Video is in `GOOGLE_CHANNELS_WITH_LANGUAGES` because `validateCriteriaPlan` accepts languages
   * there, and is still unreachable from this screen: `GOOGLE_VIDEO_CREATE_SUPPORTED` is false, so
   * `selectedGoogleChannels` drops it and there is no Video create for a language to ride on. The
   * constant stays right about upstream; this asserts the narrower thing the UI can do.
   */
  it('closes the section on video, which has no create to attach a language to', () => {
    const c = seedChannel(fixture, { includeVideo: true });

    expect(c['googleLanguagesChannel']()).toBeNull();
  });

  /**
   * Demand Gen takes languages since campaign-service v1.0.31 (`validateCriteriaPlan`, #459: on the ad
   * group), so a list picked on Search survives a switch to Demand Gen and is sent there.
   */
  it('keeps sending a list picked under one channel once the selection moves to demand-gen', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleLanguage']('DE');

    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    expect(c['googleLanguagesPayload']()).toEqual({ languages: ['DE'] });
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-languages-section"]')).not.toBeNull();
  });

  /**
   * The submit path (#3568). The cases above call `googleLanguagesPayload()` directly, so deleting
   * its spread from the request in `submit()` would leave them green. These drive `submit()` and read
   * the request `CampaignService.createCampaign` was handed.
   */
  it('submits a picked language on a channel that accepts languages', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleLanguage']('DE');
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['languages']).toEqual(['DE']);
  });

  it('submits a picked language on demand-gen', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['addGoogleLanguage']('EN');
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['languages']).toEqual(['EN']);
  });

  /**
   * An absent key, not `[]`. Upstream reads an absent language list as Google's own default of
   * every language, so sending an empty array would be a narrowing nobody asked for.
   */
  it('sends nothing when no language was picked', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleLanguagesPayload']()).toEqual({});
  });

  /**
   * The legacy road. The in-process creator reads nothing on `googleAdsConfig`, so a language picked
   * there would be collected and dropped, and the campaign created serving in every language. A
   * picked list is held, not sent, and the section is not rendered; `null` (not known yet) withholds
   * the same way.
   */
  it.each([[null], [false]])('withholds the section and the payload while googleCreativeEnabled is %s', (capability) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleLanguage']('DE');
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();

    expect(c['googleLanguagesChannel']()).toBeNull();
    expect(c['googleLanguagesPayload']()).toEqual({});
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-languages-section"]')).toBeNull();
    expect(c['googleLanguages']()).toEqual(['DE']);
  });

  it('renders the section once the capability is on', () => {
    seedChannel(fixture, { includeSearch: true });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-languages-section"]')).not.toBeNull();
  });

  it('round-trips the chips through a draft', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const { code } = c['googleLanguageOptions'][1];
    c['addGoogleLanguage'](code);

    expect(emitted?.googleLanguages).toEqual([code]);

    c['googleLanguages'].set([]);
    restoreGoogleDraft(fixture, c, { googleLanguages: [code] });

    expect(c['googleLanguages']()).toEqual([code]);
  });

  /** The chips are COPIED out of the draft, so the parent's array cannot be mutated through them. */
  it('does not share the restored array with the draft', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const saved = [c['googleLanguageOptions'][1].code];

    restoreGoogleDraft(fixture, c, { googleLanguages: saved });
    c['addGoogleLanguage'](c['googleLanguageOptions'][2].code);

    expect(saved).toHaveLength(1);
  });

  /** A draft saved before this section shipped carries no key, and must not clear the chips. */
  it('leaves the chips alone when the draft carries no language key', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const { code } = c['googleLanguageOptions'][1];
    c['addGoogleLanguage'](code);

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleLanguages']()).toEqual([code]);
  });
});

/**
 * Demographic exclusions and excluded locations (#4991). The exclusions panel's edits land in three
 * tab signals; these pin what the create request carries for each channel, that Create waits on every
 * shared refusal the BFF answers with (each entry branch, the cap and the targeted-and-excluded clash),
 * and that demographics hidden by a channel switch are held and said to be held.
 */
describe('ImplementationTabComponent google exclusions', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedExclusions(patch: Record<string, unknown>, geos: string[] = ['DE']): Record<string, any> {
    const c = seedChannel(fixture, patch);
    c['onGoogleExcludedAgeRangesChange'](['18-24']);
    c['onGoogleExcludedGendersChange'](['UNDETERMINED']);
    c['onGoogleExcludedGeoTargetsChange'](geos);
    fixture.detectChanges();
    return c;
  }

  it.each([
    ['search', { includeSearch: true }, { excludedAgeRanges: ['18-24'], excludedGenders: ['UNDETERMINED'], excludedGeoTargets: ['DE'] }],
    ['display', { includeDisplay: true }, { excludedAgeRanges: ['18-24'], excludedGenders: ['UNDETERMINED'], excludedGeoTargets: ['DE'] }],
    ['performance-max', { includePerformanceMax: true }, { excludedGeoTargets: ['DE'] }],
    ['demand-gen', { includeDemandGen: true }, { excludedGeoTargets: ['DE'] }],
  ])('sends what %s accepts and holds the rest', (_channel, patch, expected) => {
    const c = seedExclusions(patch);

    expect(c['googleTargetingPayload']()).toEqual(expected);
    expect(c['googleExcludedAgeRanges']()).toEqual(['18-24']);
  });

  it('submits all three lists on Search, copied rather than shared', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedExclusions({ includeSearch: true });
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['excludedAgeRanges']).toEqual(['18-24']);
    expect(request['excludedGenders']).toEqual(['UNDETERMINED']);
    expect(request['excludedGeoTargets']).toEqual(['DE']);
    expect(request['excludedGeoTargets']).not.toBe(c['googleExcludedGeoTargets']());
  });

  it('shows both sections on Search, and on Performance Max only locations, saying the demographics are held', () => {
    seedExclusions({ includeSearch: true });
    expect(query('implementation-google-demographics')).not.toBeNull();
    expect(query('implementation-google-excluded-geos')).not.toBeNull();
    expect(query('implementation-google-targeting-withheld')).toBeNull();

    (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    fixture.detectChanges();

    expect(query('implementation-google-demographics')).toBeNull();
    expect(query('implementation-google-excluded-geos')).not.toBeNull();
    const held = 'Performance Max campaigns do not take demographic exclusions, so the 2 demographic exclusions you set will not be sent.';
    expect(query('implementation-google-targeting-withheld')?.textContent).toContain(held);
    expect(query('implementation-google-targeting-withheld-live')?.textContent).toContain(held);
    // Held, not judged: the shared fence would refuse demographics on Performance Max, but none are sent.
    expect((fixture.componentInstance as unknown as Record<string, any>)['googleDemographicExclusionsError']()).toBeNull();
  });

  it.each([
    ['an unknown age range', { ageRanges: ['17-23'] }, 'googleDemographicExclusionsError', 'cannot exclude the age range 17-23'],
    ['an unknown gender', { genders: ['OTHER'] }, 'googleDemographicExclusionsError', 'cannot exclude the gender OTHER'],
    ['a blank location', { geos: [''] }, 'googleExcludedGeoTargetsError', 'cannot include a blank entry'],
    ['a non-canonical geo id', { geos: ['01023191'] }, 'googleExcludedGeoTargetsError', 'is not the canonical spelling'],
    ['an unsupported country', { geos: ['ZZ'] }, 'googleExcludedGeoTargetsError', 'cannot exclude ZZ on this path'],
    [
      'too many locations',
      { geos: Array.from({ length: GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS + 1 }, (_, i) => String(1000 + i)) },
      'googleExcludedGeoTargetsError',
      `accepts at most ${GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS} excluded locations`,
    ],
  ])('holds Create on %s and shows the shared refusal under its section', (_case, lists, signalName, message) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googleGeoTargets'].set(['GB']);
    c['onGoogleExcludedAgeRangesChange']((lists as Record<string, string[]>)['ageRanges'] ?? []);
    c['onGoogleExcludedGendersChange']((lists as Record<string, string[]>)['genders'] ?? []);
    c['onGoogleExcludedGeoTargetsChange']((lists as Record<string, string[]>)['geos'] ?? []);
    fixture.detectChanges();

    expect(c[signalName]()).toContain(message);
    expect(c['canSubmit']()).toBe(false);
    const errorId =
      signalName === 'googleDemographicExclusionsError' ? 'implementation-google-demographics-error' : 'implementation-google-excluded-geos-error';
    expect(query(errorId)?.textContent).toContain(message);
  });

  it('refuses excluding a targeted place however it is spelled, and the event country the request falls back to', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googleGeoTargets'].set(['US']);
    c['onGoogleExcludedGeoTargetsChange'](['2840']);
    fixture.detectChanges();
    expect(c['googleExcludedGeoTargetsError']()).toContain('cannot both target and exclude US');
    expect(c['canSubmit']()).toBe(false);

    // No country picked: the request targets the event country (US), so excluding it clashes too.
    c['googleGeoTargets'].set([]);
    c['onGoogleExcludedGeoTargetsChange'](['US']);
    fixture.detectChanges();
    expect(c['googleEffectiveGeoTargets']()).toEqual(['US']);
    expect(c['googleExcludedGeoTargetsError']()).toContain('cannot both target and exclude US');

    c['onGoogleExcludedGeoTargetsChange'](['CA']);
    expect(c['googleExcludedGeoTargetsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('withholds the panel and every key off the campaign-service road', () => {
    const c = seedExclusions({ includeSearch: true }, ['ZZ']);
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleTargetingPayload']()).toEqual({});
    expect(c['googleExcludedGeoTargetsError']()).toBeNull();
    expect(query('implementation-google-exclusions-panel')).toBeNull();
  });

  it('round-trips the three lists through a draft and empties them for a new brief', () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedExclusions({ includeSearch: true });

    expect(emitted?.googleExcludedAgeRanges).toEqual(['18-24']);
    expect(emitted?.googleExcludedGenders).toEqual(['UNDETERMINED']);
    expect(emitted?.googleExcludedGeoTargets).toEqual(['DE']);

    c['resetGoogleFields']();
    expect(c['googleExcludedAgeRanges']()).toEqual([]);
    expect(c['googleExcludedGenders']()).toEqual([]);
    expect(c['googleExcludedGeoTargets']()).toEqual([]);
    restoreGoogleDraft(fixture, c, { googleExcludedAgeRanges: ['65+'], googleExcludedGenders: ['MALE'], googleExcludedGeoTargets: ['DE', '1023191'] });

    expect(c['googleExcludedAgeRanges']()).toEqual(['65+']);
    expect(c['googleExcludedGenders']()).toEqual(['MALE']);
    expect(c['googleExcludedGeoTargets']()).toEqual(['DE', '1023191']);
  });
});

/**
 * Ad-group demographics (linuxfoundation/lfx-v2-campaign-service#473, #497, #499): income and
 * parental-status exclusions, Search's observed dimensions and Display's positive targeting. Pins what
 * each channel sends, that Create waits on the shared refusal, and that a channel switch holds the rest.
 */
describe('ImplementationTabComponent google ad-group demographics', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedDemographics(patch: Record<string, unknown>): Record<string, any> {
    const c = seedChannel(fixture, patch);
    c['onGoogleExcludedIncomeRangesChange'](['INCOME_RANGE_0_50']);
    c['onGoogleExcludedParentalStatusesChange'](['NOT_A_PARENT']);
    c['onGoogleObservedDemographicsChange'](['AGE_RANGE', 'INCOME_RANGE']);
    c['onGoogleDisplayDemographicsChange']({ ageRanges: ['25-34'], genders: [] });
    fixture.detectChanges();
    return c;
  }

  it.each([
    ['search', { includeSearch: true }, { excludedIncomeRanges: ['INCOME_RANGE_0_50'], observedDemographics: ['AGE_RANGE', 'INCOME_RANGE'] }],
    [
      'display',
      { includeDisplay: true },
      { excludedIncomeRanges: ['INCOME_RANGE_0_50'], excludedParentalStatuses: ['NOT_A_PARENT'], displayDemographics: { ageRanges: ['25-34'] } },
    ],
    ['demand-gen', { includeDemandGen: true }, {}],
    ['performance-max', { includePerformanceMax: true }, {}],
  ])('sends what %s accepts and holds the rest', (_channel, patch, expected) => {
    const c = seedDemographics(patch);

    expect(c['googleAdGroupDemographicsPayload']()).toEqual(expected);
    expect(c['googleAdGroupDemographicsError']()).toBeNull();
  });

  it('submits the Display lists, copied rather than shared', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedDemographics({ includeDisplay: true });
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['excludedParentalStatuses']).toEqual(['NOT_A_PARENT']);
    expect(request['displayDemographics']).toEqual({ ageRanges: ['25-34'] });
    expect(request).not.toHaveProperty('observedDemographics');
    expect(request['excludedIncomeRanges']).not.toBe(c['googleExcludedIncomeRanges']());
  });

  it('shows the Search sections on Search and the Display ones on Display, and says what Demand Gen holds', () => {
    seedDemographics({ includeSearch: true });
    expect(query('implementation-google-observed-demographics')).not.toBeNull();
    expect(query('implementation-google-income-exclusions')).not.toBeNull();
    expect(query('implementation-google-parental-exclusions')).toBeNull();
    expect(query('implementation-google-demographic-targeting')).toBeNull();
    // Only what Search does not take is held: the parental exclusion and the targeted value, not the income exclusion it sends.
    expect(query('implementation-google-targeting-withheld')?.textContent).toContain(
      'Search campaigns do not take parental-status exclusions or demographic targeting, so the 1 parental-status exclusion and 1 targeted demographic you set will not be sent.'
    );

    const form = (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'];
    form.patchValue({ includeSearch: false, includeDisplay: true });
    fixture.detectChanges();
    expect(query('implementation-google-observed-demographics')).toBeNull();
    expect(query('implementation-google-parental-exclusions')).not.toBeNull();
    expect(query('implementation-google-demographic-targeting')).not.toBeNull();
    expect(query('implementation-google-targeting-withheld')?.textContent).toContain('2 observed demographics');

    form.patchValue({ includeDisplay: false, includeDemandGen: true });
    fixture.detectChanges();
    expect(query('implementation-google-ad-group-demographics')).toBeNull();
    expect(query('implementation-google-targeting-withheld')?.textContent).toContain(
      'Demand Gen campaigns do not take income exclusions or parental-status exclusions or observed demographics or demographic targeting, so the 1 income exclusion and 1 parental-status exclusion and 2 observed demographics and 1 targeted demographic you set will not be sent.'
    );
  });

  function expectHeld(c: Record<string, any>, message: string): void {
    fixture.detectChanges();
    expect(c['googleAdGroupDemographicsError']()).toContain(message);
    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-google-ad-group-demographics-error')?.textContent).toContain(message);
  }

  it('holds Create on Search when every value of an observed dimension is excluded', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['onGoogleExcludedGendersChange'](['MALE', 'FEMALE', 'UNDETERMINED']);
    c['onGoogleObservedDemographicsChange'](['GENDER']);
    expectHeld(c, 'Every gender is excluded');
  });

  it('holds Create on Display when a value is both targeted and excluded', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['onGoogleExcludedAgeRangesChange'](['25-34']);
    c['onGoogleDisplayDemographicsChange']({ ageRanges: ['25-34'] });
    expectHeld(c, 'both target and exclude the age range 25-34');
  });

  it('withholds the panel and every key off the campaign-service road', () => {
    const c = seedDemographics({ includeDisplay: true });
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleAdGroupDemographicsPayload']()).toEqual({});
    expect(query('implementation-google-ad-group-demographics')).toBeNull();
  });

  it('round-trips the four fields through a draft and empties them for a new brief', () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedDemographics({ includeDisplay: true });

    expect(emitted?.googleExcludedIncomeRanges).toEqual(['INCOME_RANGE_0_50']);
    expect(emitted?.googleExcludedParentalStatuses).toEqual(['NOT_A_PARENT']);
    expect(emitted?.googleObservedDemographics).toEqual(['AGE_RANGE', 'INCOME_RANGE']);
    expect(emitted?.googleDisplayDemographics).toEqual({ ageRanges: ['25-34'] });

    c['resetGoogleFields']();
    expect(c['googleExcludedIncomeRanges']()).toEqual([]);
    expect(c['googleDisplayDemographics']()).toEqual({});
    restoreGoogleDraft(fixture, c, {
      googleExcludedIncomeRanges: ['UNDETERMINED'],
      googleExcludedParentalStatuses: ['PARENT'],
      googleObservedDemographics: ['GENDER'],
      googleDisplayDemographics: { genders: ['FEMALE'] },
    });

    expect(c['googleExcludedIncomeRanges']()).toEqual(['UNDETERMINED']);
    expect(c['googleExcludedParentalStatuses']()).toEqual(['PARENT']);
    expect(c['googleObservedDemographics']()).toEqual(['GENDER']);
    expect(c['googleDisplayDemographics']()).toEqual({ genders: ['FEMALE'] });
  });
});

/** Display placement exclusions (campaign-service v1.0.31, #462). */
describe('ImplementationTabComponent display placement exclusions', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedPlacements(text: string, patch: Record<string, unknown> = { includeDisplay: true }): Record<string, any> {
    const c = seedChannel(fixture, patch);
    c['campaignForm'].controls.googleExcludedPlacements.setValue(text);
    fixture.detectChanges();
    return c;
  }

  it('shows the box on Display alone and sends each non-blank line, trimmed', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedPlacements(' spam.example \n\nnews.example.org\n');
    expect(query('implementation-google-excluded-placements-section')).not.toBeNull();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['excludedPlacements']).toEqual(['spam.example', 'news.example.org']);
  });

  it.each([
    ['search', { includeSearch: true }],
    ['demand-gen', { includeDemandGen: true }],
    ['performance-max', { includePerformanceMax: true }],
  ])('hides the box on %s, holds what was typed and says so', (_channel, patch) => {
    const c = seedPlacements('spam.example\nhttps://bad.example', { includeDisplay: true });
    c['campaignForm'].patchValue({ includeDisplay: false, ...patch });
    fixture.detectChanges();

    expect(query('implementation-google-excluded-placements-section')).toBeNull();
    expect(c['googleTargetingPayload']()).not.toHaveProperty('excludedPlacements');
    // Held, not judged: the scheme would be refused on Display, but nothing is sent.
    expect(c['googleExcludedPlacementsError']()).toBeNull();
    const held = 'do not take placement exclusions, so the 2 you entered will not be sent. Switch the channel back to Display to send them.';
    expect(query('implementation-google-excluded-placements-held')?.textContent).toContain(held);
    expect(query('implementation-google-excluded-placements-held-live')?.textContent).toContain(held);
    expect(c['campaignForm'].controls.googleExcludedPlacements.value).toContain('spam.example');
  });

  it('says nothing held when the box is empty off Display', () => {
    seedPlacements('  \n', { includeSearch: true });
    expect(query('implementation-google-excluded-placements-held')).toBeNull();
    expect(query('implementation-google-excluded-placements-held-live')?.textContent.trim()).toBe('');
  });

  it.each([
    ['a scheme', 'https://spam.example', 'starts with a scheme'],
    ['a path', 'spam.example/news', 'must be a bare domain'],
    ['a port', 'spam.example:8080', 'must be a bare domain'],
    ['a non-ASCII name', 'bücher.example', 'is not plain ASCII'],
    ['a single label', 'localhost', 'is not a domain name'],
    ['an IPv4 literal', '192.168.0.1', 'is not a domain name'],
    ['501 entries', Array.from({ length: 501 }, (_v, i) => `site${i}.example`).join('\n'), 'at most 500 placement exclusions'],
  ])('holds Create on %s, with the reason under the box and in the live region', (_label, text, fragment) => {
    const c = seedPlacements(`ok.example\n${text}`);

    expect(c['googleExcludedPlacementsError']()).toContain(fragment);
    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-google-excluded-placements-error')?.textContent).toContain(fragment);
    expect(query('implementation-google-excluded-placements-error-live')?.textContent).toContain(fragment);
  });

  it('accepts exactly 500 entries', () => {
    const c = seedPlacements(Array.from({ length: 500 }, (_v, i) => `site${i}.example`).join('\n'));
    expect(c['googleExcludedPlacementsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('sends the same request with the box empty as with text held off Display', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const requestFrom = async (f: ComponentFixture<ImplementationTabComponent>, patch: Record<string, unknown>, text: string | null): Promise<string> => {
      const c = seedChannel(f, patch);
      if (text !== null) c['campaignForm'].controls.googleExcludedPlacements.setValue(text);
      f.detectChanges();
      createCampaign.mockClear();
      c['submit']();
      await f.whenStable();
      return JSON.stringify(createCampaign.mock.calls[0][0]);
    };
    for (const [patch, text] of [
      [{ includeDisplay: true }, '  \n '],
      [{ includeSearch: true }, 'spam.example'],
    ] as const) {
      const before = await requestFrom(fixture, patch, null);
      const other = TestBed.createComponent(ImplementationTabComponent);
      other.detectChanges();
      await other.whenStable();
      const after = await requestFrom(other, patch, text);
      expect(after).toBe(before);
      expect(after).not.toContain('excludedPlacements');
    }
  });

  it('round-trips the box through a draft, restores only a string, and empties it for a new brief', () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedPlacements('spam.example\n');
    c['emitDraft']();
    expect(emitted?.googleExcludedPlacements).toBe('spam.example\n');

    c['resetGoogleFields']();
    expect(c['campaignForm'].controls.googleExcludedPlacements.value).toBe('');
    restoreGoogleDraft(fixture, c, { googleExcludedPlacements: 'news.example.org' });
    expect(c['campaignForm'].controls.googleExcludedPlacements.value).toBe('news.example.org');
    restoreGoogleDraft(fixture, c, { googleExcludedPlacements: ['bad'] as unknown as string });
    expect(c['campaignForm'].controls.googleExcludedPlacements.value).toBe('news.example.org');
  });

  it('re-judges a restored box: a refused entry from the draft holds Create', () => {
    const c = seedPlacements('spam.example\n');
    expect(c['googleExcludedPlacementsError']()).toBeNull();
    restoreGoogleDraft(fixture, c, { includeDisplay: true, googleExcludedPlacements: 'https://spam.example/page' });
    expect(c['googleExcludedPlacementsError']()).not.toBeNull();
    expect(c['canSubmit']()).toBe(false);
  });

  it('ignores a line that holds only whitespace Go trims, as the shared judge does', () => {
    const c = seedPlacements('spam.example\n\u0085\n');
    expect(c['googleExcludedPlacementsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });
});
