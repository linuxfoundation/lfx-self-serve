// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_REQUIRED_NOTICE,
  GOOGLE_CREATIVE_SECTION_TITLES,
  GOOGLE_SEARCH_ASSETS_NOTICE,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  configureGoogleTab,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The Search-copy gate.
 *
 * Headlines and descriptions are required for the two channels whose ad IS that copy, and for no
 * others — a Performance Max or Display campaign carries its copy in its own creative object, and
 * an unconditional `Validators.required` here once made those campaigns unsubmittable.
 *
 * `demand-gen` is in the gate alongside `search` because the LEGACY in-process creator builds a
 * DEMAND GEN campaign for an unknown type, so that pair reaches the same ad-copy requirement.
 */
describe('ImplementationTabComponent google search-copy gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it.each([['includeSearch'], ['includeDemandGen']])('asks for the ad copy on %s', STATE_ONLY, (control) => {
    const c = seedChannel(fixture, { [control]: true });

    expect(c['searchCopyApplies']()).toBe(true);

    c['campaignForm'].controls.headlines.at(0).setValue('');

    expect(c['campaignForm'].controls.headlines.invalid).toBe(true);
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The other direction, which is the regression this gate exists for. The same empty copy must
   * leave a Display campaign submittable — its ad lives in `displayCreative`.
   */
  it.each([['includePerformanceMax'], ['includeDisplay']])('does not ask for the ad copy on %s', STATE_ONLY, (control) => {
    const c = seedChannel(fixture, { [control]: true });
    c['campaignForm'].controls.headlines.at(0).setValue('');
    c['campaignForm'].controls.descriptions.at(0).setValue('');

    expect(c['searchCopyApplies']()).toBe(false);
    expect(c['campaignForm'].controls.headlines.valid).toBe(true);
    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * Nothing re-runs a validator when a SIBLING control changes, so the gate is inert without the
   * constructor effect that revalidates both arrays when the gate's answer moves. Reading the
   * arrays' validity BEFORE and AFTER the tick is what holds that effect in place.
   *
   * The `detectChanges` is load-bearing: an effect settles on the next flush, where the
   * `valueChanges` subscription this replaced ran synchronously on the tick.
   */
  it('revalidates the copy arrays when the channel changes under them', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.headlines.at(0).setValue('');
    expect(c['campaignForm'].controls.headlines.valid).toBe(true);

    c['campaignForm'].controls.includeDisplay.setValue(false);
    c['campaignForm'].controls.includeSearch.setValue(true);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.headlines.invalid).toBe(true);
  });

  /**
   * The checkboxes are not the only thing that moves the gate. `showGoogleSection()` reads
   * `selectedPlatforms`, a signal input — dropping Google in the parent makes the copy stop being
   * required without either checkbox emitting, which the `valueChanges` pair this replaced missed.
   */
  it('revalidates the copy arrays when google leaves the selected platforms', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.headlines.at(0).setValue('');
    expect(c['campaignForm'].controls.headlines.invalid).toBe(true);

    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['linkedin-ads'],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    expect(c['searchCopyApplies']()).toBe(false);
    expect(c['campaignForm'].controls.headlines.valid).toBe(true);
  });
});

/**
 * The per-channel creative sections.
 *
 * Everything here is driven off `GOOGLE_CREATIVE_FIELD_SPECS`, and the assertions name the
 * catalogue rather than repeating its numbers — a bound that moves upstream should move these
 * tests' expectations with it, not leave them green against a stale literal.
 */
describe('ImplementationTabComponent google creative sections', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it.each([
    ['includeDemandGen', 'demand-gen'],
    ['includePerformanceMax', 'performance-max'],
    ['includeDisplay', 'display'],
    ['includeSearch', 'search'],
  ])('renders the %s section', STATE_ONLY, (control, channel) => {
    const c = seedChannel(fixture, { [control]: true });
    const sections = c['googleCreativeSections']();

    expect(sections).toHaveLength(1);
    expect(sections[0].channel).toBe(channel);
    expect(sections[0].label).toBe(GOOGLE_CREATIVE_SECTION_TITLES[channel as keyof typeof GOOGLE_CREATIVE_SECTION_TITLES]);
    expect(sections[0].groupName).toBe(GOOGLE_CREATIVE_REQUEST_KEYS[channel as keyof typeof GOOGLE_CREATIVE_REQUEST_KEYS]);
  });

  /**
   * #5262: Search's section collects its campaign assets, not its copy (the two shared arrays), and is
   * sent as `searchAssets` with each list split one per line, as every creative is.
   */
  it('sends the Search assets under searchAssets, one entry per line', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.searchAssets.patchValue({
      businessName: ' Example Foundation ',
      adImages: 'https://cdn.example.org/a.png\n\nhttps://cdn.example.org/b.png',
      landscapeAdImages: 'https://cdn.example.org/wide.png',
      businessLogoImages: '',
    });

    expect(c['googleCreativeWirePayload']()).toEqual({
      searchAssets: {
        businessName: 'Example Foundation',
        adImages: ['https://cdn.example.org/a.png', 'https://cdn.example.org/b.png'],
        landscapeAdImages: ['https://cdn.example.org/wide.png'],
      },
    });
  });

  /** A Search campaign serves on its ads alone, so its section says its assets are optional rather than warning of an empty shell. */
  it('shows the optional-assets line on the Search section and the empty-shell line on the others', () => {
    seedChannel(fixture, { includeSearch: true, includeDisplay: true });
    const notice = (channel: string): string | undefined =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="implementation-creative-notice-${channel}"]`)?.textContent?.trim();

    expect(notice('search')).toBe(GOOGLE_SEARCH_ASSETS_NOTICE);
    expect(notice('display')).toBe(GOOGLE_CREATIVE_REQUIRED_NOTICE);
  });

  it('renders no section when Google is not a selected platform', STATE_ONLY, () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['googleCreativeSections']()).toEqual([]);
  });

  /**
   * The creative capability is withheld until the cutover owns the create, because the legacy
   * in-process creator sends no creative object at all — rendering the fields there would collect
   * copy the create then silently drops. `null` is the "not known yet" state and withholds too.
   */
  it.each([[null], [false]])('renders no section while googleCreativeEnabled is %s', STATE_ONLY, (capability) => {
    const c = seedChannel(fixture, { includeDisplay: true });
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();

    expect(c['googleCreativeSections']()).toEqual([]);
  });

  /**
   * Search and Demand Gen are one campaign on the wire: `buildGoogleAdsConfig`'s Search branch
   * sends no `googleCreative` at all. Leaving the Demand Gen section up alongside Search would
   * collect creative the request then drops, so Search takes the section down.
   */
  it('drops the demand gen section when search is ticked alongside it', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true, includeDemandGen: true, includeDisplay: true });

    expect(c['googleCreativeSections']().map((section: { channel: string }) => section.channel)).toEqual(['display', 'search']);
  });

  /**
   * The hazard the section rules open, and the effect that closes it: a withheld section leaves a
   * `FormGroup` nobody can reach, and an enabled invalid group holds `campaignForm.invalid` true
   * with no control on screen to fix. Only the rendered groups stay enabled.
   */
  it('enables only the creative groups it renders', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });

    expect(c['campaignForm'].controls.displayCreative.enabled).toBe(true);
    expect(c['campaignForm'].controls.demandGenCreative.enabled).toBe(false);
    expect(c['campaignForm'].controls.performanceMaxCreative.enabled).toBe(false);

    c['campaignForm'].controls.includeDisplay.setValue(false);
    c['campaignForm'].controls.includePerformanceMax.setValue(true);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.displayCreative.enabled).toBe(false);
    expect(c['campaignForm'].controls.performanceMaxCreative.enabled).toBe(true);
  });

  /**
   * Disabling a group must not change what the payload, the snapshot or a restore can see.
   * `getRawValue()` reports disabled controls, which is why none of those three needed a change.
   */
  it('still reads a disabled creative group through getRawValue', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.controls.longHeadline.setValue('Still here');

    c['campaignForm'].controls.includeDisplay.setValue(false);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.displayCreative.enabled).toBe(false);
    expect(c['campaignForm'].getRawValue().displayCreative.longHeadline).toBe('Still here');
  });

  /**
   * The line split that turns a textarea into the array the wire carries. Both newline
   * conventions, trimmed, empties dropped — a trailing newline must not become an entry that
   * counts against the cap or reaches Google as an empty image URL.
   */
  it('splits a list field on either newline convention, trimming and dropping empties', STATE_ONLY, () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['splitCreativeLines']('one\r\n  two  \n\n\nthree\n')).toEqual(['one', 'two', 'three']);
    expect(c['splitCreativeLines']('')).toEqual([]);
    expect(c['splitCreativeLines'](null)).toEqual([]);
    expect(c['splitCreativeLines'](undefined)).toEqual([]);
  });

  /**
   * The list bound is PER LINE, which `Validators.maxLength` cannot express: the control holds one
   * multi-line string, so bounding its own length would refuse five short headlines for being long
   * together. Both assertions are needed — the first alone passes against a `maxLength` on the raw
   * control.
   */
  it('bounds a list field per entry, not on the whole control', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const headlines = c['campaignForm'].controls.displayCreative.controls.headlines;
    const spec = GOOGLE_CREATIVE_FIELD_SPECS.display[0];

    headlines.setValue(Array.from({ length: spec.max }, () => 'a'.repeat(spec.width)).join('\n'));
    expect(headlines.valid).toBe(true);

    headlines.setValue('a'.repeat(spec.width + 1));
    expect(headlines.errors?.['creativeListWidth']).toEqual({ label: spec.label, width: spec.width });

    headlines.setValue(Array.from({ length: spec.max + 1 }, () => 'ok').join('\n'));
    expect(headlines.errors?.['creativeListMax']).toEqual({ label: spec.label, max: spec.max, actual: spec.max + 1 });
  });

  /**
   * The scalar bound is measured on the TRIMMED value, matching both the list bound beside it
   * (`splitCreativeLines` trims every entry) and the payload builder, which trims before it sends.
   *
   * `Validators.maxLength` measured the raw control, so a value at exactly the width plus a
   * trailing space was refused here while the string that would actually have gone upstream was
   * inside the bound — a client refusing a create campaign-service would have accepted, which is
   * the one thing no guard on this road may do. The second assertion is what keeps this from
   * being a bound that no longer bounds anything.
   */
  it('bounds a text field on its trimmed value, not the raw control', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const spec = GOOGLE_CREATIVE_FIELD_SPECS.display[1];
    const longHeadline = c['campaignForm'].controls.displayCreative.controls.longHeadline;

    longHeadline.setValue(`  ${'a'.repeat(spec.width)}  `);
    expect(longHeadline.valid).toBe(true);
    // The value the wire would have carried, which is what the bound was applied to.
    expect((c['googleCreativePayload']()['displayCreative'] as Record<string, unknown>)['longHeadline']).toBe('a'.repeat(spec.width));

    longHeadline.setValue(`  ${'a'.repeat(spec.width + 1)}  `);
    expect(longHeadline.errors?.['maxlength']).toEqual({ requiredLength: spec.width, actualLength: spec.width + 1 });
  });

  /**
   * The rune-counting fix, pinned at the boundary on BOTH call sites — `creativeTextBounds` and
   * `creativeListBounds` each measure with `googleCreativeFieldWidth`, which charges an emoji 1 as
   * campaign-service's `textWeight` does, and each would silently regress to the old over-refusal if
   * someone swapped in `String.length`.
   *
   * ASCII cannot catch that: `'a'.repeat(n)` is `n` units and `n` runes, so the test above stays
   * green under either implementation. A non-BMP character is where the two measures diverge — an
   * emoji is 2 UTF-16 units and 1 rune — so a value at exactly the width is 2× the width in units
   * and MUST still be accepted. That is the whole point: campaign-service counts these as runes
   * and accepts them, and a client that refused them would be refusing a create upstream makes.
   * The Microsoft keyword box pins the same hazard the same way.
   *
   * The over-the-bound half keeps this from being a test that no longer tests anything, and
   * `actualLength` proves the error reports runes too, not units.
   */
  it('bounds text and list fields in code points, not UTF-16 units', STATE_ONLY, () => {
    const emoji = '\u{1F600}';
    const c = seedChannel(fixture, { includeDemandGen: true, includeDisplay: true });

    const scalar = GOOGLE_CREATIVE_FIELD_SPECS.display[1];
    const longHeadline = c['campaignForm'].controls.displayCreative.controls.longHeadline;

    longHeadline.setValue(emoji.repeat(scalar.width));
    // Twice the bound in UTF-16 units — what `String.length` would have refused on.
    expect(longHeadline.value.length).toBe(scalar.width * 2);
    expect(longHeadline.valid).toBe(true);

    longHeadline.setValue(emoji.repeat(scalar.width + 1));
    expect(longHeadline.errors?.['maxlength']).toEqual({ requiredLength: scalar.width, actualLength: scalar.width + 1 });

    const list = GOOGLE_CREATIVE_FIELD_SPECS['demand-gen'][0];
    const headlines = c['campaignForm'].controls.demandGenCreative.controls.headlines;

    headlines.setValue(emoji.repeat(list.width));
    expect(headlines.valid).toBe(true);

    headlines.setValue(emoji.repeat(list.width + 1));
    expect(headlines.errors?.['creativeListWidth']).toEqual({ label: list.label, width: list.width });
  });

  /**
   * Display width, as campaign-service judges headlines, long headlines, descriptions and business
   * names (`validateCreativeText`, `textWeight`): a CJK ideograph counts 2. Each value below is
   * within the field's width in code points and over it in display width, so a code-point bound
   * (what this tab measured before #5219's review) accepts it and upstream refuses it after the
   * budget. Both list call sites and the scalar one are pinned.
   */
  it('bounds headlines, descriptions and business names by display width, CJK counting double', STATE_ONLY, () => {
    const cjk = '会';
    const c = seedChannel(fixture, { includeDemandGen: true, includeDisplay: true, includePerformanceMax: true });

    const pmaxDescriptions = c['campaignForm'].controls.performanceMaxCreative.controls.descriptions;
    pmaxDescriptions.setValue(cjk.repeat(45));
    expect(pmaxDescriptions.valid).toBe(true);
    pmaxDescriptions.setValue(cjk.repeat(46));
    expect(pmaxDescriptions.errors?.['creativeListWidth']).toEqual({ label: 'Descriptions', width: 90 });

    const dgHeadlines = c['campaignForm'].controls.demandGenCreative.controls.headlines;
    dgHeadlines.setValue(cjk.repeat(15));
    expect(dgHeadlines.valid).toBe(true);
    dgHeadlines.setValue(cjk.repeat(16));
    expect(dgHeadlines.errors?.['creativeListWidth']).toEqual({ label: 'Headlines', width: 30 });

    const businessName = c['campaignForm'].controls.displayCreative.controls.businessName;
    businessName.setValue(cjk.repeat(12));
    expect(businessName.valid).toBe(true);
    businessName.setValue(cjk.repeat(13));
    expect(businessName.errors?.['maxlength']).toEqual({ requiredLength: 25, actualLength: 26 });
  });

  /**
   * The call to action is a closed list since #1614 (F13): Google refuses text outside the documented
   * list after the campaign exists. The rune-count bound campaign-service applies
   * (`maxDisplayCallToActionRunes`) still stands beside it, so text past 30 runes carries both.
   */
  it('holds the call to action to its list, beside the rune-count bound campaign-service applies', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const cta = c['campaignForm'].controls.displayCreative.controls.callToActionText;

    cta.setValue('Learn More');
    expect(cta.valid).toBe(true);
    cta.setValue('会'.repeat(30));
    expect(cta.errors?.['creativeOption']).toBeDefined();
    expect(cta.errors?.['maxlength']).toBeUndefined();
    cta.setValue('会'.repeat(31));
    expect(cta.errors?.['maxlength']).toEqual({ requiredLength: 30, actualLength: 31 });
  });

  /**
   * `assetGroupName`'s width is the one bound this change ADDS to the catalogue, and nothing else
   * in the suite touches it: the scalar boundary tests above both drive Display's `longHeadline`,
   * so deleting `width: 256` from the catalogue entry left every test green. That is the exact
   * shape of regression this feature exists to prevent — an unbounded field reaching
   * campaign-service and coming back refused, one round trip later.
   *
   * Both halves are pinned because either alone can rot independently: the catalogue can lose the
   * number while the validator wiring stands, and the wiring can stop reading `width` while the
   * number sits there unused. 256 is `maxAssetGroupNameRunes` upstream, counted on the trimmed
   * value, which is why the over-the-bound case uses a trailing space.
   */
  it('bounds the asset group name at the width the catalogue carries', STATE_ONLY, () => {
    const spec = GOOGLE_CREATIVE_FIELD_SPECS['performance-max'].find((field) => field.control === 'assetGroupName');
    expect(spec?.width).toBe(256);

    const width = spec?.width ?? 0;
    const c = seedChannel(fixture, { includePerformanceMax: true });
    const assetGroupName = c['campaignForm'].controls.performanceMaxCreative.controls.assetGroupName;

    assetGroupName.setValue(`  ${'a'.repeat(width)}  `);
    expect(assetGroupName.valid).toBe(true);

    assetGroupName.setValue(`  ${'a'.repeat(width + 1)}  `);
    expect(assetGroupName.errors?.['maxlength']).toEqual({ requiredLength: width, actualLength: width + 1 });
  });

  /**
   * No CONTROL VALIDATOR carries `min`, and that is not an oversight. A validator sees one control
   * and never the group, so it cannot tell a half-filled creative from an empty one — and a
   * channel with no creative at all is a create campaign-service makes. The floor is enforced at
   * submit instead, where the whole creative is in view; `googleCreativeError` below is that half.
   */
  it('does not enforce a list field minimum on the control', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includePerformanceMax: true });
    const headlines = c['campaignForm'].controls.performanceMaxCreative.controls.headlines;

    headlines.setValue('just the one');

    expect(GOOGLE_CREATIVE_FIELD_SPECS['performance-max'][0].min).toBeGreaterThan(1);
    expect(headlines.valid).toBe(true);
    expect(c['campaignForm'].controls.performanceMaxCreative.valid).toBe(true);
  });

  /** All four bound combinations a guidance sentence is assembled from, plus the catalogue's own note. */
  it('states a field’s bounds in its guidance', STATE_ONLY, () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list', min: 1, max: 5, width: 30 })).toBe(
      '1–5 entries, one per line. Up to 30 characters each.'
    );
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list', max: 5 })).toBe('Up to 5 entries, one per line.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list', min: 2 })).toBe('At least 2 entries, one per line.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list' })).toBe('One entry per line.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'text', width: 25 })).toBe('Up to 25 characters.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'text' })).toBe('');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'text', width: 25, hint: 'Required.' })).toBe('Up to 25 characters. Required.');
  });

  /**
   * The template reads `field.guidance`, not a method — the sentence is assembled once when the
   * section resolves instead of on every change-detection pass. This pins the two together.
   */
  it('carries each field’s guidance on the resolved section', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const section = c['googleCreativeSections']().find((entry: { groupName: string }) => entry.groupName === 'displayCreative');

    expect(section.fields).toHaveLength(GOOGLE_CREATIVE_FIELD_SPECS.display.length);
    section.fields.forEach((field: Record<string, any>, index: number) => {
      expect(field['guidance']).toBe(c['creativeFieldGuidance'](GOOGLE_CREATIVE_FIELD_SPECS.display[index]));
    });
  });

  /**
   * The error line stays silent until the field is touched — every one of these controls starts
   * empty and valid, and an untouched field has nothing to report.
   */
  it('reports a field error only once the field is touched', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const spec = GOOGLE_CREATIVE_FIELD_SPECS.display[0];
    const headlines = c['campaignForm'].controls.displayCreative.controls.headlines;
    headlines.setValue(Array.from({ length: spec.max + 1 }, () => 'ok').join('\n'));

    expect(c['creativeFieldErrors']()[`displayCreative.${spec.control}`]).toBeUndefined();

    // Blur emits on neither `valueChanges` nor `statusChanges`, so the touched state reaches the
    // error map over its own `AbstractControl.events` stream. This is the assertion that pins it.
    headlines.markAsTouched();

    expect(c['creativeFieldErrors']()[`displayCreative.${spec.control}`]).toBe(`At most ${spec.max} entries — ${spec.max + 1} given.`);
  });

  it('reports the width and maxlength errors in the field’s own words', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const listSpec = GOOGLE_CREATIVE_FIELD_SPECS.display[0];
    const textSpec = GOOGLE_CREATIVE_FIELD_SPECS.display[1];
    const group = c['campaignForm'].controls.displayCreative.controls;

    group.headlines.setValue('a'.repeat(listSpec.width + 1));
    group.headlines.markAsTouched();
    expect(c['creativeFieldErrors']()[`displayCreative.${listSpec.control}`]).toBe(`Each entry must be ${listSpec.width} characters or fewer.`);

    group.longHeadline.setValue('a'.repeat(textSpec.width + 1));
    group.longHeadline.markAsTouched();
    expect(c['creativeFieldErrors']()[`displayCreative.${textSpec.control}`]).toBe(`Must be ${textSpec.width} characters or fewer.`);
  });

  /**
   * Shape-never-content, matching the BFF normalizer this feeds: a field that trims to nothing is
   * OMITTED rather than sent as `''` or `[]`, and a channel whose whole creative is empty emits no
   * key at all — an empty array is a positive statement ("no images") where absence means "none
   * asked for", and upstream treats the two differently on the reciprocal image fields.
   */
  it('omits empty creative fields and empty creatives entirely', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });

    expect(c['googleCreativePayload']()).toEqual({});

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: '  \n \n', businessName: '   ' });
    expect(c['googleCreativePayload']()).toEqual({});

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One\nTwo\n', businessName: '  Acme  ' });
    expect(c['googleCreativePayload']()).toEqual({ displayCreative: { headlines: ['One', 'Two'], businessName: 'Acme' } });
  });

  /**
   * A creative is only sent for a channel whose section is actually rendered.
   *
   * The payload reads `googleCreativeSections()` — the same signal the template renders — rather
   * than a second reading of the ticked channels, so the rule is proved by changing what is
   * SELECTED, not by what the caller passes. A filled-in creative left behind by a since-unticked
   * channel must not reach the wire.
   */
  it('sends no creative for an unselected channel', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One' });
    expect(c['googleCreativePayload']()).toEqual({ displayCreative: { headlines: ['One'] } });

    c['campaignForm'].patchValue({ includeDisplay: false });
    fixture.detectChanges();

    expect(c['googleCreativePayload']()).toEqual({});
  });

  /**
   * The draft round-trip, including a key the catalogue no longer has. The draft is persisted
   * JSON, and Angular throws on a `patchValue` naming a control that is not there — so one stale
   * key must not take the whole restore down with it.
   */
  it('round-trips the creative text through a draft, skipping a stale key', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One\nTwo', businessName: 'Acme' });

    const snapshot = c['googleCreativeSnapshot']();
    expect(snapshot['displayCreative']).toMatchObject({ headlines: 'One\nTwo', businessName: 'Acme' });

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: '', businessName: '' });
    c['restoreGoogleCreatives']({ ...snapshot, displayCreative: { ...snapshot['displayCreative'], retiredField: 'x' }, retiredGroup: { headlines: 'y' } });

    expect(c['campaignForm'].controls.displayCreative.getRawValue()).toMatchObject({ headlines: 'One\nTwo', businessName: 'Acme' });
  });

  /** The snapshot is a copy, not a live view of a form this component is about to destroy. */
  it('snapshots the creative groups by value', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One' });

    const snapshot = c['googleCreativeSnapshot']();
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'Changed' });

    expect(snapshot['displayCreative'].headlines).toBe('One');
  });
});
