// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES,
  GOOGLE_ADS_MAX_CALLOUTS,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  SEED_KEYWORD,
  configureGoogleTab,
  restoreGoogleDraft,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * Seeding the two extension editors from the brief the Planning tab generated.
 *
 * The gate is PRESENCE, not truthiness: a brief written before extension generation shipped — or
 * one for an event whose page carried no linkable sections — has no list at all, and seeding `[]`
 * for it would clear chips the operator typed on a re-mount. `fromBriefResponse` holds up the
 * other end by restoring an absent stored list as `undefined` rather than as `[]`.
 */
describe('ImplementationTabComponent google extension seeding', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /** Re-mount the brief with `patch` merged in, driving the real `populateFromBrief` path. */
  function remountBrief(patch: Record<string, unknown>): void {
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      ...patch,
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

  it('seeds both editors from a brief that carries the generated lists', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    remountBrief({
      googleCallouts: ['Free To Attend'],
      googleSitelinks: [{ text: 'View the Agenda', finalUrl: 'https://events.example.com/agenda' }],
    });

    expect(c['googleCallouts']()).toEqual(['Free To Attend']);
    expect(c['googleSitelinks']()).toEqual([{ text: 'View the Agenda', finalUrl: 'https://events.example.com/agenda' }]);
  });

  // A re-emit of the SAME brief must not lose typed entries. The live draft is fed back as the parent
  // does (`draftChange` -> `implementationDraft`), and `applyDraft` restores both lists over the reset (#4624).
  it('keeps hand-typed entries across a re-emit of the same brief that carries no lists', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const held: { draft: CampaignImplementationDraft | null } = { draft: null };
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (held.draft = d));
    c['addGoogleCallout']('Hands-On Labs');
    c['addGoogleSitelink']({ text: 'Venue & Travel', finalUrl: 'https://events.example.com/venue' });
    fixture.componentRef.setInput('draft', held.draft);

    remountBrief({});

    expect(c['googleCallouts']()).toEqual(['Hands-On Labs']);
    expect(c['googleSitelinks']()).toEqual([{ text: 'Venue & Travel', finalUrl: 'https://events.example.com/venue' }]);
  });

  /**
   * A live brief switch (#4624): every Google field typed through its control or its add method, then
   * another event's brief, which carries no callouts or sitelinks (the conditional case). The draft,
   * the screen and the create must then match a first mount of that brief.
   */
  it('drops every typed google field when a different brief is handed over', async () => {
    const URL = 'https://events.example.com/register';
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ result: { campaigns: [], errors: [] } }) as never);
    const c = seedChannel(fixture, { includeSearch: true });
    const held: { draft: CampaignImplementationDraft | null } = { draft: null };
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (held.draft = d));
    c['campaignForm'].patchValue({
      includeDemandGen: true,
      searchBudgetPct: 55,
      googleBiddingStrategy: 'maximize-clicks',
      googleTargetCpa: '12',
      googleTargetRoas: '4',
      googleCpcBid: '3',
      googleConversionActions: '12345',
    });
    for (const channel of ['demand-gen', 'performance-max', 'display'] as const) {
      c['campaignForm'].controls[GOOGLE_CREATIVE_REQUEST_KEYS[channel]].controls[GOOGLE_CREATIVE_FIELD_SPECS[channel][0].control].setValue('Stale creative');
    }
    c['addGoogleGeoTarget']('DE');
    expect(c['addGooglePostalGeoTarget']('9031945')).toBe(true);
    c['googlePostalGeoLabels'].set({ '9031945': 'Stale label' });
    expect(c['addGoogleProximityTarget']({ latitude: '-33.8688', longitude: '151.2093', radius: '25', radiusUnit: 'KILOMETERS' })).toBe(true);
    c['addGoogleLanguage'](c['googleLanguageOptions'][0].code);
    expect(c['addGoogleAudienceSegment']('customers/1234567890/userLists/111')).toBe(true);
    expect(c['addGoogleCallout']('Hands-On Labs')).toBe(true);
    expect(c['addGoogleSitelink']({ text: 'Venue & Travel', finalUrl: 'https://events.example.com/venue' })).toBe(true);
    expect(c['addGoogleStructuredSnippet']('Brands', ['Alpha', 'Beta', 'Gamma'])).toBe(true);
    expect(c['addGoogleCallExtension']({ countryCode: 'US', phoneNumber: '+1 415 555 0100' })).toBe(true);
    expect(c['addGooglePromotion']({ ...c['emptyGooglePromotionDraft'](), promotionTarget: 'Conference passes', discount: '25', finalUrl: URL })).toBe(true);
    const row = (header: string) => ({ header, description: 'Two days', amount: '499', unit: '', finalUrl: URL });
    expect(
      c['addGooglePrice']({
        type: 'EVENTS',
        priceQualifier: '',
        languageCode: 'en',
        currencyCode: 'usd',
        offerings: [row('Standard'), row('Student'), row('Virtual')],
      })
    ).toBe(true);
    fixture.detectChanges();
    const listKeys =
      'googleGeoTargets googlePostalGeoTargets googleProximityTargets googleLanguages googleAudienceSegments googleCallouts googleSitelinks googleStructuredSnippets googleCallExtensions googlePromotions googlePrices'.split(
        ' '
      ) as (keyof CampaignImplementationDraft)[];
    for (const key of listKeys) expect(held.draft?.[key]).toHaveLength(1);
    expect(held.draft).toMatchObject({ includeDemandGen: true, searchBudgetPct: 55, googleBiddingStrategy: 'maximize-clicks', googleCpcBid: '3' });

    const next = {
      eventDetails: { name: 'Open Source Summit', slug: 'oss-na-2026', registrationUrl: 'https://example.com/oss', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
      structuredCopy: { google_search: { headlines: ['Attend OSS'], descriptions: ['Join us in Denver'] } },
    } as unknown as CampaignBriefOutput;
    fixture.componentRef.setInput('draft', null);
    fixture.componentRef.setInput('briefData', next);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(held.draft).toMatchObject({
      eventSlug: 'oss-na-2026',
      searchBudgetPct: 70,
      includeSearch: true,
      includeDemandGen: false,
      includePerformanceMax: false,
      includeDisplay: false,
      googleBiddingStrategy: '',
      googleTargetCpa: '',
      googleTargetRoas: '',
      googleCpcBid: '',
      googleConversionActions: '',
      googlePostalGeoLabels: {},
    });
    for (const key of listKeys) expect(held.draft?.[key]).toEqual([]);
    // Nothing typed for the previous brief survives. The NEXT brief's own generated Search copy prefills
    // the headlines and descriptions of the three image creatives (#4784, #1614), and every other field
    // stays empty; the Demand Gen video ad is never seeded.
    const prefilledFromNext: Record<string, string> = { headlines: 'Attend OSS', descriptions: 'Join us in Denver' };
    const seededGroups = ['performanceMaxCreative', 'demandGenCreative', 'displayCreative'];
    for (const [name, group] of Object.entries(held.draft?.googleCreatives ?? {})) {
      for (const [field, value] of Object.entries(group)) {
        const expected = seededGroups.includes(name) ? (prefilledFromNext[field] ?? '') : '';
        expect(value, `${name}.${field}`).toBe(expected);
      }
    }
    const text = fixture.nativeElement.textContent as string;
    for (const stale of ['Hands-On Labs', 'Venue & Travel', 'Conference passes', '415 555 0100', 'Alpha', 'userLists/111', '9031945', 'Stale label']) {
      expect(text).not.toContain(stale);
    }

    // A first mount of the new brief, with the same capabilities, is the baseline for the draft and the create.
    const fresh = TestBed.createComponent(tabComponentUnderTest());
    const freshHeld: { draft: CampaignImplementationDraft | null } = { draft: null };
    fresh.componentInstance.draftChange.subscribe((d: CampaignImplementationDraft) => (freshHeld.draft = d));
    for (const capability of ['demandGenEnabled', 'googleChannelsEnabled', 'googleCreativeEnabled'] as const) fresh.componentRef.setInput(capability, true);
    fresh.componentRef.setInput('briefData', next);
    fresh.detectChanges();
    await fresh.whenStable();
    // Google's own keys only: the other platforms' fields are each held by their own test.
    const google = (draft: CampaignImplementationDraft | null) =>
      Object.fromEntries(Object.entries(draft ?? {}).filter(([key]) => /^(google|include|searchBudgetPct|headlines|descriptions)/.test(key)));
    expect(google(held.draft)).toEqual(google(freshHeld.draft));

    const requestOf = (f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown> => {
      const component = f.componentInstance as unknown as Record<string, any>;
      expect(component['canSubmit']()).toBe(true);
      component['submit']();
      return createCampaign.mock.calls[createCampaign.mock.calls.length - 1][0] as unknown as Record<string, unknown>;
    };
    const request = requestOf(fixture);
    expect(request).toMatchObject({ campaignTypes: ['search'], searchBudgetPct: 70 });
    expect(request).toEqual(requestOf(fresh));
  });

  // A brief that DID carry a list is copied, not shared: editing the chips must not reach back
  // into the parent's array, which the Planning tab still holds and re-emits.
  it('does not share the seeded arrays with the brief', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const sitelinks = [{ text: 'View the Agenda', finalUrl: 'https://events.example.com/agenda' }];
    remountBrief({ googleCallouts: ['Free To Attend'], googleSitelinks: sitelinks });

    expect(c['googleSitelinks']()[0]).not.toBe(sitelinks[0]);
    expect(c['googleSitelinks']()[0]).toEqual(sitelinks[0]);
  });
});

/**
 * The Google callout chips.
 *
 * Free text rather than a select, so every one of upstream's `validateCallouts` branches has to be
 * mirrored on the add path — and each test below is one of those branches, plus the accept-cases
 * that keep the guards from refusing what upstream takes.
 */
describe('ImplementationTabComponent google callouts', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('trims an added callout and refuses a blank', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleCallout']('  Free shipping  ')).toBe(true);
    expect(c['addGoogleCallout']('   ')).toBe(false);

    expect(c['googleCallouts']()).toEqual(['Free shipping']);
  });

  /**
   * Case-folded, because upstream keys its duplicate check on `strings.ToLower(text)` and REFUSES
   * the whole create rather than de-duplicating. Two chips differing only in case would be one
   * callout upstream and a campaign that never gets created.
   */
  it('refuses a callout that repeats an existing one in a different case', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free Shipping');

    expect(c['addGoogleCallout']('free shipping')).toBe(false);
    expect(c['googleCallouts']()).toEqual(['Free Shipping']);
  });

  it('refuses an add at the cap', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    for (let i = 0; i < GOOGLE_ADS_MAX_CALLOUTS; i++) c['addGoogleCallout'](`Callout ${i + 1}`);

    expect(c['addGoogleCallout']('One more')).toBe(false);
    expect(c['googleCallouts']()).toHaveLength(GOOGLE_ADS_MAX_CALLOUTS);
  });

  /**
   * Runes, not UTF-16 units. `utf8.RuneCountInString` counts code points, so 25 astral-plane
   * characters are a callout upstream accepts — counted with `.length` they would be 50 and this
   * add would be refused for no reason, which is the over-refusal these mirrors exist to avoid.
   */
  it('accepts a 25-emoji callout and refuses a 26-character one', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleCallout']('🎉'.repeat(GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES))).toBe(true);
    expect(c['addGoogleCallout']('A'.repeat(GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES + 1))).toBe(false);

    expect(c['googleCallouts']()).toEqual(['🎉'.repeat(GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES)]);
  });

  /** The live warnings describe what is IN THE BOX, which is why the draft text is a signal. */
  it('warns on the in-progress text by rune count and by case-folded repeat', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free Shipping');

    c['googleCalloutDraft'].set('🎉'.repeat(GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES + 1));
    expect(c['googleCalloutDraftLength']()).toBe(GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES + 1);
    expect(c['googleCalloutDraftTooLong']()).toBe(true);

    c['googleCalloutDraft'].set('  free shipping ');
    expect(c['googleCalloutDraftTooLong']()).toBe(false);
    expect(c['googleCalloutDraftDuplicate']()).toBe(true);
  });

  /**
   * `aria-invalid` says the box is wrong; only `aria-describedby` says why, and it is the half that
   * survives focus returning to the field later — `role="alert"` fires once, as the line appears.
   * The id is asserted against the message element actually rendered, so a renamed id on either
   * side breaks the test rather than silently pointing `aria-describedby` at nothing.
   */
  it('points the callout box at whichever message is rendered, and at nothing when clean', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free Shipping');
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    expect(c['googleCalloutDraftErrorId']()).toBeNull();

    c['googleCalloutDraft'].set('A'.repeat(GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES + 1));
    fixture.detectChanges();
    expect(find('implementation-google-callout-add')?.getAttribute('aria-describedby')).toBe(find('implementation-google-callout-too-long')?.id);

    c['googleCalloutDraft'].set('free shipping');
    fixture.detectChanges();
    expect(find('implementation-google-callout-add')?.getAttribute('aria-describedby')).toBe(find('implementation-google-callout-duplicate')?.id);

    c['googleCalloutDraft'].set('Fast delivery');
    fixture.detectChanges();
    expect(find('implementation-google-callout-add')?.getAttribute('aria-describedby')).toBeNull();
  });

  it('removes a chip by index', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('First');
    c['addGoogleCallout']('Second');

    c['removeGoogleCallout'](0);

    expect(c['googleCallouts']()).toEqual(['Second']);
  });

  /**
   * SEARCH ONLY, and withheld rather than refused elsewhere: `validateAssetPlan` refuses the whole
   * extension set on any other channel at preflight, before the budget mutate, so forwarding a
   * list typed under Search and then abandoned would cost the operator the entire campaign.
   */
  it('offers callouts on Search and withholds them on a non-Search channel', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    expect(c['googleCalloutsAvailable']()).toBe(true);
    c['addGoogleCallout']('Free shipping');
    expect(c['googleCalloutsPayload']()).toEqual({ callouts: ['Free shipping'] });

    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    expect(c['googleCalloutsAvailable']()).toBe(false);
    expect(c['googleCalloutsPayload']()).toEqual({});
    // Held, not discarded — the chips are still there if Search is re-ticked.
    expect(c['googleCallouts']()).toEqual(['Free shipping']);
  });

  /** Omitted rather than sent empty, so the upstream default is reached by the absent-key route. */
  it('omits the callouts key when nothing was added', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleCalloutsPayload']()).toEqual({});
  });

  it('round-trips the chips through a draft', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    c['addGoogleCallout']('Free shipping');

    expect(emitted?.googleCallouts).toEqual(['Free shipping']);

    c['googleCallouts'].set([]);
    restoreGoogleDraft(fixture, c, { googleCallouts: ['Free shipping'] });

    expect(c['googleCallouts']()).toEqual(['Free shipping']);
  });

  /** COPIED out of the draft, so the parent's array cannot be mutated through the chips. */
  it('does not share the restored array with the draft', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const saved = ['Free shipping'];

    restoreGoogleDraft(fixture, c, { googleCallouts: saved });
    c['addGoogleCallout']('Next day delivery');

    expect(saved).toHaveLength(1);
  });

  /**
   * Go's string rules, not JS's: upstream trims with `strings.TrimSpace` (which strips U+0085 and
   * keeps U+FEFF) and keys repeats on `strings.ToLower` (no final-sigma rule). A chip JS calls new
   * but Go calls a repeat would cost the whole create.
   */
  it.each([
    ['a trailing U+0085', 'Free shipping', 'free shipping\u0085'],
    ['final sigma', 'ΟΔΟΣ', 'οδοσ'],
  ])('refuses a repeat hidden by %s, on the add and in the live warning', STATE_ONLY, (_label, first, repeat) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout'](first);

    c['googleCalloutDraft'].set(repeat);
    expect(c['googleCalloutDraftDuplicate']()).toBe(true);
    expect(c['addGoogleCallout'](repeat)).toBe(false);
    expect(c['googleCallouts']()).toEqual([first]);
  });

  it('says out loud that callouts are withheld after a switch away from Search, in the notice and its live region', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    // The region exists, empty, BEFORE there is anything to say: an aria-live element inserted
    // with its text already present is not reliably announced.
    expect(find('implementation-google-callouts-withheld-live')?.textContent?.trim()).toBe('');

    c['addGoogleCallout']('Free shipping');
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    const notice = find('implementation-google-callouts-withheld')?.textContent ?? '';
    expect(notice).toContain('Demand Gen campaigns do not take callouts');
    expect(notice).toContain('the 1 you added');
    expect(find('implementation-google-callouts-withheld-live')?.textContent?.trim()).toBe(c['googleCalloutsWithheldWarning']());
    // The visible copy carries no role, or the sentence would be announced twice.
    expect(find('implementation-google-callouts-withheld')?.getAttribute('role')).toBeNull();
  });

  it('shows no withheld notice when no callouts were added', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });

    expect(c['googleCalloutsWithheldWarning']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-callouts-withheld"]')).toBeNull();
  });

  /**
   * The channel reason does not depend on the capability answer, so the sentence must not wait for
   * one. It used to: the warning read `googleBiddingChannel`, which is null while the capability is
   * unanswered, so a stalled capability read left a Demand Gen operator with callouts that would
   * never be sent and nothing on screen saying so — the capability block stays silent here too,
   * because retrying the check could not rescue the list.
   */
  it('still names the channel while the capability answer has not come back', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free shipping');
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();

    expect(c['googleCalloutsWithheldWarning']()).toContain('Demand Gen campaigns do not take callouts');
    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
  });

  /**
   * The other half of that gate, and the reason it tests the channel rather than
   * `googleCalloutsAvailable`: that signal is false for EITHER reason, so on Search with the
   * capability unanswered it would put "Search campaigns do not take callouts" on screen — a
   * sentence about Search that is simply untrue. The capability block owns this state.
   */
  it('never tells Search it takes no callouts while the capability is unanswered', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free shipping');
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();

    expect(c['googleCalloutsWithheldWarning']()).toBeNull();
    expect(c['googleExtensionsCapabilityBlock']()).not.toBeNull();
  });

  /**
   * Through `submit()`, not the payload helper: deleting the payload spread would leave every
   * helper-level test above green while every callout an operator adds is dropped.
   */
  it.each([
    ['Search', { includeSearch: true }, ['Free shipping']],
    ['Demand Gen, after a switch from Search', { includeDemandGen: true }, undefined],
  ])('sends the callouts on a submitted %s create only when the channel takes them', STATE_ONLY, async (_label, channel, expected) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free shipping');
    c['campaignForm'].patchValue({ includeSearch: false, ...channel });
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['callouts']).toEqual(expected);
  });

  /** A draft saved before this section shipped carries no key, and must not clear the chips. */
  it('leaves the chips alone when the draft carries no callouts key', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Free shipping');

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleCallouts']()).toEqual(['Free shipping']);
  });
});

/**
 * The OTHER reason callouts and sitelinks are withheld: the create capability is not an explicit
 * yes.
 *
 * The two channel warnings above cannot cover this state — both open on `googleBiddingChannel()`,
 * which is itself null whenever the capability is unanswered — so without this block the create
 * succeeds, ships no extensions, and says nothing. Each branch of
 * `googleExtensionsCapabilityBlock` gets its own test, plus the three ways it must stay silent and
 * the one thing it deliberately does NOT do: block Create.
 */
describe('ImplementationTabComponent google extensions capability block', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /** Search, one callout and one sitelink generated, then the capability answer taken away. */
  function seedWithheld(capability: boolean | null, read: 'unknown' | 'pending' | 'ready' | 'failed', briefId: string | null): Record<string, any> {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Hands-On Labs');
    c['addGoogleSitelink']({ text: 'Register', finalUrl: 'https://events.example.org/register' });
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();
    return c;
  }

  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('names the deployment when the capability answered no, counting both lists', () => {
    const c = seedWithheld(false, 'ready', 'brief-1');

    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('unsupported');
    const block = find('implementation-google-extensions-capability-unsupported')?.textContent ?? '';
    expect(block).toContain('not available on this deployment');
    expect(block).toContain('1 callout and 1 sitelink');
    expect(find('implementation-google-extensions-capability-live')?.textContent?.trim()).toBe(c['googleExtensionsCapabilityMessage']());
    // Nothing to retry: a `false` answer is the deployment's, not a failed read.
    expect(find('implementation-google-extensions-capability-retry')).toBeNull();
  });

  /**
   * The pending sentence carries the counts for a reason the other three do not need: this block
   * does not gate Create, so a create started mid-check is allowed and ships no extensions. A bare
   * "checking…" would be the one message in this set that lets the lists go without saying so.
   */
  it('says it is still checking while the read is in flight, and what creating now would cost', () => {
    const c = seedWithheld(null, 'pending', 'brief-1');

    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('pending');
    const block = find('implementation-google-extensions-capability-pending')?.textContent ?? '';
    expect(block).toContain('Checking whether Google ad extensions can be sent');
    expect(block).toContain('Creating the campaign before the check finishes');
    expect(block).toContain('1 callout and 1 sitelink');
    // Create is deliberately not blocked here — the sentence is the whole mitigation.
    expect(c['canSubmit']()).toBe(true);
    expect(find('implementation-google-extensions-capability-retry')).toBeNull();
  });

  it('asks for the brief to be saved when there is no brief to check against', () => {
    const c = seedWithheld(null, 'unknown', null);

    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('unsaved');
    expect(find('implementation-google-extensions-capability-unsaved')?.textContent).toContain('Save the brief to send them');
  });

  /**
   * `unknown` is treated like a failure, not like `pending` — no read is out and nothing else will
   * start one, so a spinner would spin forever. Retry is the way out, and it reaches the parent.
   */
  it.each([['failed'], ['unknown']])('offers a Retry that asks the parent to re-read when the read is %s', (read) => {
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = seedWithheld(null, read as 'failed' | 'unknown', 'brief-1');

    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('failed');
    expect(find('implementation-google-extensions-capability-failed')?.textContent).toContain('Could not confirm');
    (find('implementation-google-extensions-capability-retry')?.querySelector('button') as HTMLButtonElement).click();

    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('says nothing once the capability answers yes — the channel warnings own it from there', () => {
    const c = seedWithheld(null, 'failed', 'brief-1');
    expect(c['googleExtensionsCapabilityBlock']()).not.toBeNull();

    fixture.componentRef.setInput('googleCreativeEnabled', true);
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
    expect(c['googleExtensionsCapabilityMessage']()).toBe('');
    expect(find('implementation-google-extensions-capability-live')?.textContent?.trim()).toBe('');
  });

  it('says nothing when there are no extensions to withhold', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
  });

  /**
   * The message promises the lists go out once the check passes. On a channel that takes no
   * extensions that promise cannot be kept — the lists are withheld whatever the capability says —
   * so the block holds its tongue. Silent, but not silence: the channel warning is already telling
   * the true reason, which is asserted here so the pair can never both go quiet.
   */
  it.each([['includeDisplay']])('says nothing on %s, where the answer would change nothing', STATE_ONLY, (channel) => {
    const c = seedWithheld(null, 'failed', 'brief-1');
    c['campaignForm'].patchValue({ includeSearch: false, [channel]: true });
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
    expect(c['googleCalloutsWithheldWarning']()).toContain('do not take callouts');
    expect(c['googleSitelinksWithheldWarning']()).toContain('do not take sitelinks');
  });

  /**
   * Demand Gen splits the two reasons by kind: the sitelinks would go out once the check passes, so
   * the block counts them; the callout would not, so the block leaves it to the callout warning.
   */
  it('counts only the sitelinks on Demand Gen, and leaves the callout to its channel warning', STATE_ONLY, () => {
    const c = seedWithheld(null, 'failed', 'brief-1');
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    const message = c['googleExtensionsCapabilityBlock']()?.message ?? '';
    expect(message).toContain('the 1 sitelink on this brief');
    expect(message).not.toContain('callout');
    expect(c['googleCalloutsWithheldWarning']()).toContain('Demand Gen campaigns do not take callouts');
    expect(c['googleSitelinksWithheldWarning']()).toBeNull();
  });

  /** Performance Max takes sitelinks and callouts (#5262), so the block counts both there. */
  it('counts the sitelinks and the callout on Performance Max, where the answer would send them', STATE_ONLY, () => {
    const c = seedWithheld(null, 'failed', 'brief-1');
    c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()?.message).toContain('1 callout and 1 sitelink');
    expect(c['googleCalloutsWithheldWarning']()).toBeNull();
    expect(c['googleSitelinksWithheldWarning']()).toBeNull();
  });

  it('says nothing while no Google channel is ticked', STATE_ONLY, () => {
    const c = seedWithheld(null, 'failed', 'brief-1');
    c['campaignForm'].patchValue({ includeSearch: false });
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
  });

  it('says nothing when Google is not one of the selected platforms', STATE_ONLY, () => {
    const c = seedWithheld(null, 'failed', 'brief-1');
    c['selectedPlatforms'].set([]);
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
  });

  /**
   * The deliberate difference from `biddingCapabilityBlock`, which DOES block Create. A withheld
   * manual bid changes what the campaign does; withheld extensions cost only the extensions, so the
   * create goes ahead and the block says what was left out.
   */
  it('does not block Create', STATE_ONLY, () => {
    const c = seedWithheld(null, 'failed', 'brief-1');

    expect(c['googleExtensionsCapabilityBlock']()).not.toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });
});

/**
 * Ad extensions on Performance Max (#5262): campaign-service v1.0.31's `validateAssetPlan` takes
 * sitelinks, callouts and structured snippets there (linuxfoundation/lfx-v2-campaign-service#461), linked to the campaign, and still refuses
 * call extensions, promotions and prices.
 */
describe('ImplementationTabComponent google extensions on performance max', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const SITELINK = { text: 'Register', description1: '', description2: '', finalUrl: 'https://events.example.org/register' };
  const PMAX_COMPLETE = {
    headlines: 'One headline\nTwo headline\nThree headline',
    longHeadlines: 'A long headline',
    descriptions: 'A short description\nAnother short description',
    businessName: 'Acme',
    marketingImages: 'https://example.com/a.png',
    squareMarketingImages: 'https://example.com/square.png',
    logoImages: 'https://example.com/logo.png',
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  /** Every extension kind entered under Search, where all six are taken. */
  const seedAllOnSearch = (): Record<string, any> => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallout']('Hands-On Labs');
    c['addGoogleSitelink'](SITELINK);
    c['addGoogleStructuredSnippet']('Types', ['Talks', 'Labs', 'Demos']);
    c['addGoogleCallExtension']({ countryCode: 'US', phoneNumber: '+1 (415) 555-0100' });
    fixture.detectChanges();
    return c;
  };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows the sitelink, callout and snippet controls on Performance Max and none of the other three', () => {
    seedChannel(fixture, { includePerformanceMax: true });

    for (const id of ['sitelinks', 'callouts', 'structured-snippets']) {
      expect(find(`implementation-google-${id}-section`)).not.toBeNull();
    }
    for (const id of ['call-extensions', 'promotions', 'prices']) {
      expect(find(`implementation-google-${id}-section`)).toBeNull();
    }
  });

  it('still shows all six on Search, and only sitelinks on Demand Gen', () => {
    seedChannel(fixture, { includeSearch: true });
    for (const id of ['sitelinks', 'callouts', 'structured-snippets', 'call-extensions', 'promotions', 'prices']) {
      expect(find(`implementation-google-${id}-section`)).not.toBeNull();
    }

    seedChannel(fixture, { includeDemandGen: true });
    expect(find('implementation-google-sitelinks-section')).not.toBeNull();
    for (const id of ['callouts', 'structured-snippets', 'call-extensions', 'promotions', 'prices']) {
      expect(find(`implementation-google-${id}-section`)).toBeNull();
    }
  });

  it('sends the sitelinks, callouts and snippets after a switch to Performance Max, and holds the call extension with a notice', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedAllOnSearch();
    c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.detectChanges();

    expect(c['googleCalloutsWithheldWarning']()).toBeNull();
    expect(c['googleSitelinksWithheldWarning']()).toBeNull();
    expect(c['googleStructuredSnippetsWithheldWarning']()).toBeNull();
    const notice = find('implementation-google-call-extensions-withheld')?.textContent ?? '';
    expect(notice).toContain('Performance Max campaigns do not take call extensions');
    expect(notice).toContain('Switch back to Search to keep them');
    expect(find('implementation-google-call-extensions-withheld-live')?.textContent?.trim()).toBe(c['googleCallExtensionsWithheldWarning']());

    c['submit']();
    await fixture.whenStable();
    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['callouts']).toEqual(['Hands-On Labs']);
    expect(request['sitelinks']).toEqual([{ text: 'Register', finalUrl: 'https://events.example.org/register' }]);
    expect(request['structuredSnippets']).toEqual([{ header: 'Types', values: ['Talks', 'Labs', 'Demos'] }]);
    expect(request['callExtensions']).toBeUndefined();
    // Held, not discarded.
    expect(c['googleCallExtensions']()).toHaveLength(1);
  });

  it.each([
    ['Demand Gen', { includeDemandGen: true }],
    ['Display', { includeDisplay: true }],
  ])('names Search and Performance Max as the way back for callouts and snippets held on %s', (label, channel) => {
    const c = seedAllOnSearch();
    c['campaignForm'].patchValue({ includeSearch: false, ...channel });
    fixture.detectChanges();

    for (const [testId, noun] of [
      ['callouts', 'callouts'],
      ['structured-snippets', 'structured snippets'],
    ]) {
      const notice = find(`implementation-google-${testId}-withheld`)?.textContent ?? '';
      expect(notice).toContain(`${label} campaigns do not take ${noun}`);
      expect(notice).toContain('Switch to Search or Performance Max to keep them');
    }
    expect(c['googleCalloutsPayload']()).toEqual({});
    expect(c['googleStructuredSnippetsPayload']()).toEqual({});
  });

  /** A Performance Max create with no extension entered is byte-identical to one built before they reached it. */
  it('builds a byte-identical Performance Max request when no extension is entered, with a call extension held', STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includePerformanceMax: true });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    fixture.detectChanges();
    c['submit']();
    await fixture.whenStable();
    const before = JSON.stringify(createCampaign.mock.calls[0][0]);
    for (const key of ['sitelinks', 'callouts', 'structuredSnippets', 'callExtensions', 'promotions', 'prices']) expect(before).not.toContain(`"${key}"`);

    c['googleCallExtensions'].set([{ countryCode: 'US', phoneNumber: '+1 (415) 555-0100' }]);
    fixture.detectChanges();
    c['submit']();
    await fixture.whenStable();
    expect(JSON.stringify(createCampaign.mock.calls[1][0])).toBe(before);
  });
});
