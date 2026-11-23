// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GOOGLE_CREATIVE_EITHER_OR_RULES,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_SECTION_TITLES,
  GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_REFUSAL,
  GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_SHORTFALL,
} from '@lfx-one/shared/constants';
import type { GoogleCreativeChannel, GoogleCreativeFieldSpec } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  DISPLAY_COMPLETE,
  configureGoogleTab,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/** One catalogue entry by name, widened off the `as const` literal so its bounds are readable. */
function creativeSpec(channel: GoogleCreativeChannel, control: string): GoogleCreativeFieldSpec {
  const specs: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
  const found = specs.find((field) => field.control === control);
  if (!found) throw new Error(`no ${control} field catalogued for ${channel}`);
  return found;
}

/**
 * The two creative messages beneath the creative sections, and the line between them.
 *
 * They split exactly where campaign-service splits. Each of the three creative validators opens
 * with an `empty()` gate that ACCEPTS the creative and only then enforces its minimums
 * (`demandgen_creative.go`, `pmax_creative.go`, `display_creative.go`) — so a wholly empty
 * creative is a create upstream MAKES, and blocking it here would be the over-refusal this whole
 * feature forbids; it gets a non-blocking warning. A started creative below a minimum is a create
 * upstream REFUSES, and saying so before the round trip can never refuse more than upstream would.
 */
describe('ImplementationTabComponent google creative minimums', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /**
   * The regression test this guard exists to not become. Every creative-bearing channel rendered
   * and nothing typed into any of them is the adoption shape campaign-service accepts — a campaign
   * an operator finishes in the Google Ads UI, and the only shape every Demand Gen campaign
   * created before this feature existed had. Blocking it would refuse a create the platform makes.
   */
  it.each([['includeDemandGen'], ['includePerformanceMax'], ['includeDisplay'], ['includeSearch']])(
    'blocks nothing when the %s creative is wholly empty',
    STATE_ONLY,
    (control) => {
      const c = seedChannel(fixture, { [control]: true });

      expect(c['googleCreativePayload']()).toEqual({});
      expect(c['googleCreativeError']()).toBeNull();
      expect(c['canSubmit']()).toBe(true);
    }
  );

  /** A list below its catalogued floor, named with the count the operator actually gave. */
  it('names a list field short of its minimum', () => {
    const c = seedChannel(fixture, { includePerformanceMax: true });
    c['campaignForm'].controls.performanceMaxCreative.patchValue({ headlines: 'Just the one' });
    const spec = creativeSpec('performance-max', 'headlines');

    expect(c['googleCreativeError']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES['performance-max']} creative needs at least ${spec.min} entries in ${spec.label} — 1 given.`
    );
    expect(c['canSubmit']()).toBe(false);
  });

  /** Singular where the floor is one — a message that says "1 entries" reads as a bug. */
  it('says entry, not entries, for a floor of one', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ businessName: 'Acme' });
    const spec = creativeSpec('display', 'headlines');

    expect(spec.min).toBe(1);
    expect(c['googleCreativeError']()).toBe(`${GOOGLE_CREATIVE_SECTION_TITLES.display} creative needs at least 1 entry in ${spec.label} — 0 given.`);
  });

  /**
   * The scalar rule. `requiredOnce` is the catalogue's machine-readable record of a field Google
   * marks required once a creative is supplied, and the only reason it is not a control validator
   * is that a validator cannot see the empty-creative case it must let through.
   */
  it.each([
    ['longHeadline', { headlines: 'One headline' }],
    ['businessName', { headlines: 'One headline', longHeadline: 'A long headline', descriptions: 'A description' }],
  ])('names the missing %s once a creative is started', (control, patch) => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue(patch);
    const spec = creativeSpec('display', control);

    expect(spec.requiredOnce).toBe(true);
    expect(c['googleCreativeError']()).toBe(`${GOOGLE_CREATIVE_SECTION_TITLES.display} creative needs a ${spec.label.toLowerCase()}.`);
  });

  /**
   * Display requires BOTH marketing shapes (#4848): Google's `ResponsiveDisplayAdInfo` refuses an ad
   * with only one, after the budget and the campaign exist. Each missing shape is named on its own.
   */
  it.each([
    { missing: 'marketingImages', present: 'squareMarketingImages' },
    { missing: 'squareMarketingImages', present: 'marketingImages' },
  ] as const)('refuses a display creative without $missing, even with $present', ({ missing }) => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ ...DISPLAY_COMPLETE, [missing]: '' });
    const spec = creativeSpec('display', missing);

    expect(c['googleCreativeError']()).toBe(`${GOOGLE_CREATIVE_SECTION_TITLES.display} creative needs at least 1 entry in ${spec.label} — 0 given.`);
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * Performance Max's short description (#5219). campaign-service refuses a started creative unless
   * one description has a display width of 60 or less, before the budget, and the job reports it only
   * as "platform campaign creation failed" — and a generated brief's descriptions often are all longer.
   */
  describe('performance max short description', () => {
    const PMAX_COMPLETE = {
      headlines: 'One headline\nTwo headline\nThree headline',
      longHeadlines: 'A long headline',
      businessName: 'Acme',
      marketingImages: 'https://example.com/a.png',
      squareMarketingImages: 'https://example.com/square.png',
      logoImages: 'https://example.com/logo.png',
    };
    const wide = (n: number): string => `Join us in Barcelona ${'x'.repeat(n - 21)}`;

    it('holds Create and names the rule beneath the creative and under Descriptions when every description is wider than 60', () => {
      const c = seedChannel(fixture, { includePerformanceMax: true });
      c['campaignForm'].controls.performanceMaxCreative.patchValue({ ...PMAX_COMPLETE, descriptions: `${wide(61)}\n${wide(90)}` });
      fixture.detectChanges();

      expect(c['googleCreativeError']()).toBe(
        `${GOOGLE_CREATIVE_SECTION_TITLES['performance-max']} creative ${GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_SHORTFALL}`
      );
      expect(c['googleCreativeError']()).toBe(GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_REFUSAL);
      expect(c['canSubmit']()).toBe(false);
      const el = fixture.nativeElement as HTMLElement;
      const error = el.querySelector('[data-testid="implementation-creative-error-performance-max-descriptions"]');
      expect(error?.textContent?.trim()).toBe(GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_REFUSAL);
      const field = el.querySelector('[data-testid="implementation-creative-performance-max-descriptions"]');
      expect(field?.getAttribute('aria-describedby')).toBe(error?.id);
      expect(error?.id).toBe('performance-max-descriptions-error');
    });

    it('releases Create once one description is 60 or less, counting CJK double', () => {
      const c = seedChannel(fixture, { includePerformanceMax: true });
      const group = c['campaignForm'].controls.performanceMaxCreative;

      // 31 ideographs are 31 characters but a display width of 62, so this one is still too wide.
      group.patchValue({ ...PMAX_COMPLETE, descriptions: `${wide(90)}\n${'会'.repeat(31)}` });
      expect(c['googleCreativeError']()).toBe(GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_REFUSAL);

      group.patchValue({ descriptions: `${wide(90)}\n${wide(60)}` });
      fixture.detectChanges();
      expect(c['googleCreativeError']()).toBeNull();
      expect(c['creativeFieldErrors']()['performanceMaxCreative.descriptions']).toBeUndefined();
      expect(c['canSubmit']()).toBe(true);
      const field = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-creative-performance-max-descriptions"]');
      expect(field?.getAttribute('aria-describedby')).toBeNull();
    });

    /** The rule is Performance Max's alone: Demand Gen and Display take long descriptions as they are. */
    it('does not hold demand gen or display on long descriptions', STATE_ONLY, () => {
      const dg = seedChannel(fixture, { includeDemandGen: true });
      dg['campaignForm'].controls.demandGenCreative.patchValue({
        headlines: 'One headline',
        descriptions: wide(90),
        businessName: 'Acme',
        logoImages: 'https://example.com/logo.png',
        marketingImages: 'https://example.com/a.png',
      });
      expect(dg['googleCreativeError']()).toBeNull();

      const display = seedChannel(fixture, { includeDemandGen: false, includeDisplay: true });
      display['campaignForm'].controls.displayCreative.patchValue({ ...DISPLAY_COMPLETE, descriptions: wide(90) });
      expect(display['googleCreativeError']()).toBeNull();
    });
  });

  /** Demand Gen's pair stays reciprocal: either shape alone satisfies it. */
  it('accepts a demand gen creative with either marketing shape', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    const group = c['campaignForm'].controls.demandGenCreative;
    const base = { headlines: 'One headline', descriptions: 'A description', businessName: 'Acme', logoImages: 'https://example.com/logo.png' };

    group.patchValue({ ...base, marketingImages: 'https://example.com/a.png', squareMarketingImages: '' });
    expect(c['googleCreativeError']()).toBeNull();

    group.patchValue({ marketingImages: '', squareMarketingImages: 'https://example.com/square.png' });
    expect(c['googleCreativeError']()).toBeNull();

    group.patchValue({ squareMarketingImages: '' });
    expect(c['googleCreativeError']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES['demand-gen']} creative ${GOOGLE_CREATIVE_EITHER_OR_RULES['demand-gen'][0].message}`
    );
  });

  /**
   * A ceiling shared across fields (#4848): three landscape and three square logos each sit under
   * their own cap of five, and together sit over the five upstream allows across both.
   */
  it('refuses display logos over the cap the two logo fields share', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const group = c['campaignForm'].controls.displayCreative;
    const urls = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${prefix}${i}.png`).join('\n');
    group.patchValue({ ...DISPLAY_COMPLETE, logoImages: urls('logo', 3), squareLogoImages: urls('square-logo', 3) });

    expect(c['googleCreativeError']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES.display} creative has 6 logo images across its fields (pasted URLs and stored images together) — 1 over the shared cap of 5.`
    );
    expect(c['canSubmit']()).toBe(false);

    group.patchValue({ squareLogoImages: urls('square-logo', 2) });
    expect(c['googleCreativeError']()).toBeNull();
  });

  /** The same check on Demand Gen's four marketing shapes, which share twenty between them. */
  it('refuses demand gen marketing images over the cap the four shapes share', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    const urls = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${prefix}${i}.png`).join('\n');
    c['campaignForm'].controls.demandGenCreative.patchValue({
      headlines: 'One headline',
      descriptions: 'A description',
      businessName: 'Acme',
      logoImages: 'https://example.com/logo.png',
      marketingImages: urls('m', 6),
      squareMarketingImages: urls('s', 5),
      portraitImages: urls('p', 5),
      tallPortraitImages: urls('t', 5),
    });

    expect(c['googleCreativeError']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES['demand-gen']} creative has 21 marketing images across its fields (pasted URLs and stored images together) — 1 over the shared cap of 20.`
    );
  });

  /**
   * #5262: Google takes twenty Search ad images, square and landscape together, and refuses the
   * twenty-first whatever the mix (`maxSearchAdImages`, #538). Each list sits under its own cap here.
   */
  it('refuses Search ad images over the twenty the square and landscape fields share', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const urls = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${prefix}${i}.png`).join('\n');
    const group = c['campaignForm'].controls.searchAssets;
    group.patchValue({ adImages: urls('s', 12), landscapeAdImages: urls('l', 9) });

    expect(c['googleCreativeError']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES.search} creative has 21 ad images across its fields (pasted URLs and stored images together) — 1 over the shared cap of 20.`
    );
    expect(c['canSubmit']()).toBe(false);

    group.patchValue({ landscapeAdImages: urls('l', 8) });
    expect(c['googleCreativeError']()).toBeNull();
  });

  /** One business logo: Google refused a second with RESOURCE_LIMIT (#538). */
  it('refuses a second Search business logo', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.searchAssets.patchValue({ businessLogoImages: 'https://example.com/a.png\nhttps://example.com/b.png' });

    expect(c['googleCreativeError']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES.search} creative has 2 entries in Business logo (1:1) (pasted URLs and stored images together) — 1 over the cap of 1.`
    );
  });

  /** Each Search asset stands alone (`validateSearchAssets`): a business name with no image is a complete request. */
  it('holds nothing for a Search business name with no image', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.searchAssets.patchValue({ businessName: 'Example Foundation' });

    expect(c['googleCreativePayload']()).toEqual({ searchAssets: { businessName: 'Example Foundation' } });
    expect(c['googleCreativeError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  /** An empty Search section is not a shell: the campaign serves on its ads, so it is never named in the warning. */
  it('never names an empty Search section in the empty-creative warning', STATE_ONLY, () => {
    const search = seedChannel(fixture, { includeSearch: true });
    expect(search['googleCreativeEmptyWarning']()).toBeNull();

    const both = seedChannel(fixture, { includeSearch: true, includeDisplay: true });
    expect(both['googleCreativeEmptyWarning']()).toContain(`${GOOGLE_CREATIVE_SECTION_TITLES.display} has no creative.`);
    expect(both['googleCreativeEmptyWarning']()).not.toContain(GOOGLE_CREATIVE_SECTION_TITLES.search);
  });

  /** Performance Max states its two marketing requirements separately, so it carries no rule. */
  it('states no either-or for performance max', STATE_ONLY, () => {
    expect(GOOGLE_CREATIVE_EITHER_OR_RULES['performance-max']).toEqual([]);
  });

  /** A complete creative blocks nothing, which is what keeps the guard from blocking everything. */
  it('clears once the creative meets every minimum', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue(DISPLAY_COMPLETE);

    expect(c['googleCreativeError']()).toBeNull();
    expect(c['googleCreativeEmptyWarning']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * The computed walks only the sections currently rendered, for the reason the bidding guard
   * records: a stale value left in a channel the operator since unticked must never block a create
   * for a channel that is not being made.
   */
  it('ignores a short creative left behind by an unticked channel', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ businessName: 'Acme' });
    expect(c['googleCreativeError']()).not.toBeNull();

    c['campaignForm'].patchValue({ includeDisplay: false, includeSearch: true });
    fixture.detectChanges();

    expect(c['googleCreativeError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  /** Nothing about this belongs to Google's half of the form when Google is not selected. */
  it('does not gate a non-Google campaign', STATE_ONLY, () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['googleCreativeError']()).toBeNull();
    expect(c['googleCreativeEmptyWarning']()).toBeNull();
  });

  /**
   * The warning, and the fact that it is a warning. Upstream accepts this create, so the button
   * must stay live — but the campaign and its budget are made and nothing else ever tells the
   * operator that what they just made cannot serve.
   */
  it('warns about an empty channel without blocking the create', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });

    expect(c['googleCreativeEmptyWarning']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES.display} has no creative. The campaign and its budget are still created, but it cannot serve until the assets are added AND the campaign is enabled in Google Ads. ` +
        'Activating it from LFX stays refused even after that, so launch it in Google Ads.'
    );
    expect(c['canSubmit']()).toBe(true);
  });

  /** Two empty channels are one sentence, with the verb agreeing with the list it follows. */
  it('names every empty channel in one sentence', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true, includeDisplay: true });

    expect(c['googleCreativeEmptyWarning']()).toBe(
      `${GOOGLE_CREATIVE_SECTION_TITLES['demand-gen']} and ${GOOGLE_CREATIVE_SECTION_TITLES.display} have no creative. ` +
        'The campaign and its budget are still created, but it cannot serve until the assets are added AND the campaign is enabled in Google Ads. ' +
        'Activating it from LFX stays refused even after that, so launch it in Google Ads.'
    );
  });

  /**
   * The activation clause is a claim about code EVERY one of the three channels has, which is why
   * it is unconditional. An empty creative leaves `AdID` blank (`demandgen.go:326`,
   * `display.go:298`), `googleAdsToggleTargets` then yields no targets, and the activation gate
   * returns `ErrCampaignNotProvisioned` (`internal/dispatch/googleads.go:2561`, `:2687`).
   * Performance Max arrives at the same refusal through `ToggleStatus`'s own asset-group check
   * (`internal/platform/googleads/pmax.go`). Claiming it for Performance Max alone — as this
   * sentence once did — understated what happens to the other two.
   *
   * The clause also has to say the refusal never LIFTS. Both gate inputs come from the persisted
   * `Result` blob (`internal/dispatch/googleads.go:2687`, `:2614`, call site `:2083-2089`), so an
   * ad added by hand upstream is never discovered and activation from LFX stays refused. An
   * earlier wording — "refused until the ad ... exists" — read as a precondition the operator
   * could satisfy, and this assertion pinned it by value, which is what kept it green.
   */
  it('claims the activation refusal for every empty channel', STATE_ONLY, () => {
    const activation = 'Activating it from LFX stays refused even after that, so launch it in Google Ads.';

    const c = seedChannel(fixture, { includeDisplay: true });
    expect(c['googleCreativeEmptyWarning']()).toContain(activation);

    c['campaignForm'].patchValue({ includeDemandGen: true });
    fixture.detectChanges();
    expect(c['googleCreativeEmptyWarning']()).toContain(activation);

    c['campaignForm'].patchValue({ includePerformanceMax: true });
    fixture.detectChanges();
    expect(c['googleCreativeEmptyWarning']()).toContain(activation);
  });

  /**
   * The two messages are judged on the same payload, which is what makes them mutually exclusive
   * per channel: a channel is either absent from it (empty, warned about) or present in it
   * (started, and measured against the minimums). Both can speak at once about DIFFERENT channels.
   *
   * No `canSubmit` assertion here, deliberately: a two-channel Google selection is already refused
   * outright once the cutover owns the create, so a false there would prove nothing about this.
   */
  it('splits two channels between the warning and the error', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includePerformanceMax: true, includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ businessName: 'Acme' });

    expect(c['googleCreativeError']()).toContain(GOOGLE_CREATIVE_SECTION_TITLES.display);
    expect(c['googleCreativeError']()).not.toContain(GOOGLE_CREATIVE_SECTION_TITLES['performance-max']);
    expect(c['googleCreativeEmptyWarning']()).toContain(GOOGLE_CREATIVE_SECTION_TITLES['performance-max']);
    expect(c['googleCreativeEmptyWarning']()).not.toContain(GOOGLE_CREATIVE_SECTION_TITLES.display);
  });

  /**
   * How the warning reaches a screen reader, which is not the same question as what it says.
   *
   * It is announced through a region that is ALWAYS in the DOM, never through a role on the `<p>`
   * — the distinction this template already records above `implementation-brief-status-live` and
   * already paid for once, when `role="status"` sat on banners that `@switch` destroyed and
   * recreated and both messages could be missed. A live region inserted with its text already in
   * it is not reliably announced; the region has to exist first and then have its CONTENTS change.
   * The visible warning's guard IS the warning text, so anything inside it is created by the same
   * change that gives it the sentence — there is no placement in there that announces reliably.
   *
   * Each assertion fails against a different wrong fix. The region being present while there is
   * nothing to say is what rules out wrapping it in an `@if`; the text pins that it carries the
   * message rather than an empty shell; the bare `<p>` rules out the two-attribute patch, which
   * would announce the same sentence twice; and `role="alert"` on the sibling pins the asymmetry
   * as deliberate rather than an oversight to be harmonised away later — assertive for the
   * refusal that takes the submit button out, polite for the notice that leaves it live.
   */
  it('announces the empty-creative warning politely, from a region that outlives it', () => {
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    fixture.detectChanges();

    const live = find('implementation-google-creative-empty-live');
    expect(live).not.toBeNull();
    expect(live?.textContent?.trim()).toBe('');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    // Pinned so the attribute cannot be dropped silently. This pair because both are in view
    // here; the template's third live region, `implementation-reddit-no-ad-live`, is pinned the
    // same way in the Reddit no-ad section rather than restated here.
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(find('implementation-brief-status-live')?.getAttribute('aria-atomic')).toBe('true');

    const c = seedChannel(fixture, { includeDisplay: true });
    expect(find('implementation-google-creative-empty-live')).toBe(live);
    expect(live?.textContent?.trim()).toBe(c['googleCreativeEmptyWarning']());

    const visible = find('implementation-google-creative-empty-warning');
    expect(visible?.textContent?.trim()).toBe(c['googleCreativeEmptyWarning']());
    expect(visible?.getAttribute('role')).toBeNull();
    expect(visible?.getAttribute('aria-live')).toBeNull();

    c['campaignForm'].controls.displayCreative.patchValue({ businessName: 'Acme' });
    fixture.detectChanges();
    expect(find('implementation-google-creative-error')?.getAttribute('role')).toBe('alert');
  });
});
