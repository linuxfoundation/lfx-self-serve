// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GOOGLE_ADS_MAX_GEO_TARGETS, GOOGLE_ADS_MAX_PROXIMITY_TARGETS } from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The Google geo chips.
 *
 * The control is a `<select>` over the supported map's own keys, so the only guards left are the
 * ones a select cannot express — the cap, and not adding a code twice.
 */
describe('ImplementationTabComponent google geo targets', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('adds a code once and refuses a duplicate or a blank', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const code = c['googleGeoOptions'][0];

    c['addGoogleGeoTarget'](code);
    c['addGoogleGeoTarget'](code);
    c['addGoogleGeoTarget']('');

    expect(c['googleGeoTargets']()).toEqual([code]);
  });

  /**
   * The cap is upstream's, on the ONE `geoTargets` list countries and postal-code ids share, so the
   * map's 30 countries alone cannot reach it — the rest of the list is postal-code ids.
   */
  it('refuses a country add once countries and postal codes together reach the cap', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const [last, ...rest] = c['googleGeoOptions'];
    for (const code of rest) c['addGoogleGeoTarget'](code);
    c['googlePostalGeoTargets'].set(Array.from({ length: GOOGLE_ADS_MAX_GEO_TARGETS - rest.length }, (_, i) => String(9031900 + i)));

    c['addGoogleGeoTarget'](last);

    expect(c['googleGeoTargets']()).toHaveLength(rest.length);
    expect(c['googleGeoTargetCount']()).toBe(GOOGLE_ADS_MAX_GEO_TARGETS);
  });

  it('removes a chip by index', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const [first, second] = c['googleGeoOptions'];
    c['addGoogleGeoTarget'](first);
    c['addGoogleGeoTarget'](second);

    c['removeGoogleGeoTarget'](0);

    expect(c['googleGeoTargets']()).toEqual([second]);
  });

  /**
   * The fallback is `[countryCode]` UNFILTERED. Filtering it to the supported list here would look
   * tidier and be worse: a country Google cannot target on this path would submit an EMPTY geo
   * list, and an empty list is not a refusal — it is a campaign with no geographic restriction.
   */
  it('falls back to the event country, trimmed and upper-cased, until a chip exists', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.countryCode.setValue('  de  ');
    fixture.detectChanges();

    expect(c['googleGeoFallbackCode']()).toBe('DE');
    expect(c['googleEffectiveGeoTargets']()).toEqual(['DE']);

    const code = c['googleGeoOptions'][0];
    c['addGoogleGeoTarget'](code);

    expect(c['googleEffectiveGeoTargets']()).toEqual([code]);
  });

  /** An empty country stays a single empty entry, so the BFF's own guard names it in the error. */
  it('does not turn an empty country into an empty geo list', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.countryCode.setValue('');
    fixture.detectChanges();

    expect(c['googleEffectiveGeoTargets']()).toEqual(['']);
  });

  it('round-trips the chips through a draft', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const code = c['googleGeoOptions'][1];
    c['addGoogleGeoTarget'](code);

    // What a save would have persisted — asserted rather than assumed, so the restore below is
    // replaying the real emitted shape and not a value this test invented.
    expect(emitted?.googleGeoTargets).toEqual([code]);

    c['googleGeoTargets'].set([]);
    restoreGoogleDraft(fixture, c, { googleGeoTargets: [code] });

    expect(c['googleGeoTargets']()).toEqual([code]);
  });

  /** The chips are COPIED out of the draft, so the parent's array cannot be mutated through them. */
  it('does not share the restored array with the draft', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const saved = [c['googleGeoOptions'][1]];

    restoreGoogleDraft(fixture, c, { googleGeoTargets: saved });
    c['addGoogleGeoTarget'](c['googleGeoOptions'][2]);

    expect(saved).toHaveLength(1);
  });

  /** A draft saved before this section shipped carries no key, and must not clear the chips. */
  it('leaves the chips alone when the draft carries no geo key', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const code = c['googleGeoOptions'][1];
    c['addGoogleGeoTarget'](code);

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleGeoTargets']()).toEqual([code]);
  });
});

/**
 * Postal-code and radius targets — the two finer halves of Google's location plan.
 *
 * Postal codes reach the wire as raw geo target constant ids in the SAME `geoTargets` list as the
 * countries, because that is the only spelling upstream's `resolveGeoList` takes; there is no lookup
 * from a postal code to its id anywhere on this road. Radius targets are `proximityTargets`, a point
 * in decimal degrees and a radius in an explicit unit, refused upstream on Demand Gen alone.
 */
describe('ImplementationTabComponent google postal-code and radius targets', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const SYDNEY_DRAFT = { latitude: ' -33.8688 ', longitude: '151.2093', radius: '25', radiusUnit: 'KILOMETERS' };
  const SYDNEY = { latitude: -33.8688, longitude: 151.2093, radius: 25, radiusUnit: 'KILOMETERS' };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  /** The focusable `<input>` an `lfx-input-text` renders, which is where its ARIA lands. */
  const inputOf = (testId: string): HTMLInputElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"] input`);

  /** Typed through the wrapper's own control — the form, not a signal, is the source of truth. */
  const typePostal = (c: Record<string, any>, text: string): void => {
    c['googlePostalGeoForm'].controls.postalId.setValue(text);
    fixture.detectChanges();
  };

  /** Same, for the radius sub-form. */
  const typeProximity = (c: Record<string, any>, patch: Record<string, string>): void => {
    c['googleProximityForm'].patchValue(patch);
    fixture.detectChanges();
  };

  describe('postal codes', () => {
    it('adds a canonical id, trimmed, and refuses a blank or a repeat', () => {
      const c = seedChannel(fixture, { includeSearch: true });

      expect(c['addGooglePostalGeoTarget'](' 9031945 ')).toBe(true);
      expect(c['addGooglePostalGeoTarget']('9031945')).toBe(false);
      expect(c['addGooglePostalGeoTarget']('   ')).toBe(false);

      expect(c['googlePostalGeoTargets']()).toEqual(['9031945']);
    });

    /**
     * One case per local refusal upstream's `resolveGeoEntry` makes, each named by its own line so
     * the operator is told which fix applies while the text is still in the box.
     */
    it.each([
      ['a postal code typed as itself', 'SW1A 1AA', 'implementation-google-postal-not-id', 'google-postal-not-id'],
      ['a leading zero', '02840', 'implementation-google-postal-not-canonical', 'google-postal-not-canonical'],
      ['zero', '0', 'implementation-google-postal-not-canonical', 'google-postal-not-canonical'],
      ['a run past int64', '123456789012345678901', 'implementation-google-postal-not-canonical', 'google-postal-not-canonical'],
    ])('refuses %s and names why', (_label, text, testId, errorId) => {
      const c = seedChannel(fixture, { includeSearch: true });
      typePostal(c, text);

      expect(c['addGooglePostalGeoTarget'](text)).toBe(false);
      expect(c['googlePostalGeoTargets']()).toEqual([]);
      expect(query(testId)).not.toBeNull();
      const input = inputOf('implementation-google-postal-add');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(input?.getAttribute('aria-describedby')).toBe(errorId);
    });

    it('names a repeat in the box, and points the clean box at its hint', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGooglePostalGeoTarget']('9031945');
      typePostal(c, '');
      expect(inputOf('implementation-google-postal-add')?.getAttribute('aria-describedby')).toBe('google-postal-hint');

      typePostal(c, '9031945');

      expect(query('implementation-google-postal-duplicate')).not.toBeNull();
    });

    it('keeps refused text in the box and clears it on a successful add', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      typePostal(c, '02840');

      c['onGooglePostalGeoAdd']();
      fixture.detectChanges();
      expect(inputOf('implementation-google-postal-add')?.value).toBe('02840');

      typePostal(c, '9031945');
      c['onGooglePostalGeoAdd']();
      fixture.detectChanges();
      expect(inputOf('implementation-google-postal-add')?.value).toBe('');
      expect(c['googlePostalGeoDraft']()).toBe('');
      expect(c['googlePostalGeoTargets']()).toEqual(['9031945']);
    });

    /** Enter in the wrapper's input bubbles to the host listener, as it did on the raw box. */
    it('adds on Enter in the wrapped input', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      fixture.detectChanges();
      const input = inputOf('implementation-google-postal-add') as HTMLInputElement;
      input.value = '9031945';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(c['googlePostalGeoTargets']()).toEqual(['9031945']);
    });

    it('counts against the cap the countries share, and refuses past it', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      for (const code of c['googleGeoOptions']) c['addGoogleGeoTarget'](code);
      const room = GOOGLE_ADS_MAX_GEO_TARGETS - c['googleGeoTargets']().length;
      for (let i = 0; i < room; i++) c['addGooglePostalGeoTarget'](String(9031900 + i));
      fixture.detectChanges();

      expect(c['addGooglePostalGeoTarget']('9099999')).toBe(false);
      expect(c['googleGeoTargetCount']()).toBe(GOOGLE_ADS_MAX_GEO_TARGETS);
      expect(query('implementation-google-postal-full')).not.toBeNull();
      expect(query('implementation-google-geo-full')).not.toBeNull();
    });

    it('removes a chip by index', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGooglePostalGeoTarget']('9031945');
      c['addGooglePostalGeoTarget']('9031946');

      c['removeGooglePostalGeoTarget'](0);

      expect(c['googlePostalGeoTargets']()).toEqual(['9031946']);
    });

    it('sends the ids after the countries in the one geo list', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleGeoTarget']('CA');
      c['addGooglePostalGeoTarget']('9031945');

      expect(c['googleEffectiveGeoTargets']()).toEqual(['CA', '9031945']);
    });

    /**
     * Google serves the UNION of the location criteria, so falling back to the event country beside a
     * postal code would buy the whole country. The fallback line must stop claiming it, too.
     */
    it('drops the event-country fallback once a postal code is added, and says so', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      fixture.detectChanges();
      expect(query('implementation-google-geo-default')).not.toBeNull();

      c['addGooglePostalGeoTarget']('9031945');
      fixture.detectChanges();

      expect(c['googleEffectiveGeoTargets']()).toEqual(['9031945']);
      expect(query('implementation-google-geo-default')).toBeNull();
      expect(query('implementation-google-geo-finer-only')).not.toBeNull();
    });

    /** No channel fence: `validateGeoPlan` reads `geoTargets` on Demand Gen too, at the ad group. */
    it('is offered and sent on demand-gen', () => {
      const c = seedChannel(fixture, { includeDemandGen: true });
      c['addGooglePostalGeoTarget']('9031945');
      fixture.detectChanges();

      expect(c['googlePostalGeoAvailable']()).toBe(true);
      expect(query('implementation-google-postal-section')).not.toBeNull();
      expect(c['googleEffectiveGeoTargets']()).toEqual(['9031945']);
    });

    /**
     * The legacy road resolves `geoTargets` through the 30-country map and DROPS anything else, so an
     * id sent there would vanish. Held, not sent, and the event-country fallback stands.
     */
    it.each([[null], [false]])('withholds the section and the ids while googleCreativeEnabled is %s', (capability) => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGooglePostalGeoTarget']('9031945');
      fixture.componentRef.setInput('googleCreativeEnabled', capability);
      fixture.detectChanges();

      expect(query('implementation-google-postal-section')).toBeNull();
      expect(c['googleEffectiveGeoTargets']()).toEqual(['US']);
      expect(c['googlePostalGeoTargets']()).toEqual(['9031945']);
    });

    it('submits the ids in geoTargets', async () => {
      const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleGeoTarget']('CA');
      c['addGooglePostalGeoTarget']('9031945');
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(true);

      c['submit']();
      await fixture.whenStable();

      expect(createCampaign.mock.calls[0][0].geoTargets).toEqual(['CA', '9031945']);
    });

    it('round-trips the chips through a draft, copied rather than shared', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      let emitted: CampaignImplementationDraft | undefined;
      fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
      c['addGooglePostalGeoTarget']('9031945');

      expect(emitted?.googlePostalGeoTargets).toEqual(['9031945']);

      const saved = [...(emitted?.googlePostalGeoTargets ?? [])];
      c['googlePostalGeoTargets'].set([]);
      restoreGoogleDraft(fixture, c, { googlePostalGeoTargets: saved });
      c['addGooglePostalGeoTarget']('9031946');

      expect(c['googlePostalGeoTargets']()).toEqual(['9031945', '9031946']);
      expect(saved).toEqual(['9031945']);
    });

    it('leaves the chips alone when the draft carries no postal key', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGooglePostalGeoTarget']('9031945');

      restoreGoogleDraft(fixture, c, {});

      expect(c['googlePostalGeoTargets']()).toEqual(['9031945']);
    });
  });

  describe('radius targets', () => {
    it('adds a target with its numbers parsed and its unit as picked', () => {
      const c = seedChannel(fixture, { includeSearch: true });

      expect(c['addGoogleProximityTarget'](SYDNEY_DRAFT)).toBe(true);

      expect(c['googleProximityTargets']()).toEqual([SYDNEY]);
    });

    /** One case per branch of `validateProximityTargets`, plus the unit upstream will not default. */
    it.each([
      ['a latitude past 90', { latitude: '90.5' }],
      ['a longitude past -180', { longitude: '-180.01' }],
      ['a latitude that is not a number', { latitude: 'north' }],
      ['a zero radius', { radius: '0' }],
      ['a negative radius', { radius: '-5' }],
      ['no unit', { radiusUnit: '' }],
      ['a radius over the kilometre ceiling', { radius: '800.5' }],
      ['a radius over the mile ceiling', { radius: '501', radiusUnit: 'MILES' }],
      ['a blank longitude', { longitude: ' ' }],
    ])('refuses %s', (_label, patch) => {
      const c = seedChannel(fixture, { includeSearch: true });

      expect(c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, ...patch })).toBe(false);
      expect(c['googleProximityTargets']()).toEqual([]);
    });

    /** Upstream refuses only `radius > max`, so each unit's own ceiling is a create Google takes. */
    it.each([
      ['500', 'MILES'],
      ['800', 'KILOMETERS'],
    ])('accepts exactly %s %s', (radius, radiusUnit) => {
      const c = seedChannel(fixture, { includeSearch: true });

      expect(c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, radius, radiusUnit })).toBe(true);
    });

    it('refuses an exact repeat but not the same point at another radius', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);

      expect(c['addGoogleProximityTarget'](SYDNEY_DRAFT)).toBe(false);
      expect(c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, radius: '30' })).toBe(true);
      expect(c['googleProximityTargets']()).toHaveLength(2);
    });

    it('refuses an add at the cap', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      for (let i = 0; i < GOOGLE_ADS_MAX_PROXIMITY_TARGETS; i++) c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, radius: String(i + 1) });
      fixture.detectChanges();

      expect(c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, radius: '99' })).toBe(false);
      expect(query('implementation-google-proximity-full')).not.toBeNull();
    });

    it.each([
      ['latitude', { latitude: '91' }, 'implementation-google-proximity-latitude-invalid', 'implementation-google-proximity-latitude'],
      ['longitude', { longitude: '181' }, 'implementation-google-proximity-longitude-invalid', 'implementation-google-proximity-longitude'],
      ['radius', { radius: '0' }, 'implementation-google-proximity-radius-invalid', 'implementation-google-proximity-radius'],
      ['radius ceiling', { radius: '900' }, 'implementation-google-proximity-radius-too-large', 'implementation-google-proximity-radius'],
    ])('names a bad %s while it is typed and withholds the add', (_label, patch, alertId, inputId) => {
      const c = seedChannel(fixture, { includeSearch: true });
      typeProximity(c, { ...SYDNEY_DRAFT, ...patch });

      expect(query(alertId)).not.toBeNull();
      expect(inputOf(inputId)?.getAttribute('aria-invalid')).toBe('true');
      expect(inputOf(inputId)?.getAttribute('aria-describedby')).toBe(alertId.replace('implementation-', ''));
      expect((query('implementation-google-proximity-add') as HTMLButtonElement).disabled).toBe(true);
    });

    /** The disabled add button carries the reason, as each box carries its own. */
    it('points the add button at the duplicate line', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);
      typeProximity(c, SYDNEY_DRAFT);

      expect(query('implementation-google-proximity-duplicate')?.id).toBe('google-proximity-duplicate');
      expect(query('implementation-google-proximity-add')?.getAttribute('aria-describedby')).toBe('google-proximity-duplicate');

      typeProximity(c, { radius: '30' });
      expect(query('implementation-google-proximity-add')?.getAttribute('aria-describedby')).toBeNull();
    });

    it('names the picked unit ceiling in the over-radius line', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      typeProximity(c, { ...SYDNEY_DRAFT, radius: '600', radiusUnit: 'MILES' });

      expect(query('implementation-google-proximity-radius-too-large')?.textContent).toContain('500 miles');
    });

    it('withholds the add until every box and the unit are filled, then enables it', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      typeProximity(c, { ...SYDNEY_DRAFT, radiusUnit: '' });
      expect((query('implementation-google-proximity-add') as HTMLButtonElement).disabled).toBe(true);

      typeProximity(c, { radiusUnit: 'KILOMETERS' });

      expect((query('implementation-google-proximity-add') as HTMLButtonElement).disabled).toBe(false);
    });

    it('clears the sub-form only on a successful add', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      typeProximity(c, { ...SYDNEY_DRAFT, latitude: '91' });
      c['onGoogleProximityAdd']();
      expect(c['googleProximityDraft']().latitude).toBe('91');

      typeProximity(c, { latitude: '-33.8688' });
      c['onGoogleProximityAdd']();

      expect(c['googleProximityDraft']()).toEqual({ latitude: '', longitude: '', radius: '', radiusUnit: '' });
      expect(c['googleProximityTargets']()).toEqual([SYDNEY]);
    });

    it('removes a target by index', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);
      c['addGoogleProximityTarget']({ ...SYDNEY_DRAFT, radius: '30' });

      c['removeGoogleProximityTarget'](0);

      expect(c['googleProximityTargets']()).toEqual([{ ...SYDNEY, radius: 30 }]);
    });

    it.each([
      ['search', { includeSearch: true }],
      ['performance-max', { includePerformanceMax: true }],
      ['display', { includeDisplay: true }],
    ])('opens the section on %s, which upstream accepts radius targets on', (channel, patch) => {
      const c = seedChannel(fixture, patch);
      fixture.detectChanges();

      expect(c['googleProximityChannel']()).toBe(channel);
      expect(query('implementation-google-proximity-section')).not.toBeNull();
    });

    /** `validateGeoPlan` refuses proximity on Demand Gen, so the list is held and said to be held. */
    it('withholds a list added under search once the channel moves to demand-gen, and says so', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);
      expect(c['googleProximityPayload']()).toEqual({ proximityTargets: [SYDNEY] });

      c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
      fixture.detectChanges();

      expect(c['googleProximityChannel']()).toBeNull();
      expect(c['googleProximityPayload']()).toEqual({});
      expect(c['googleProximityTargets']()).toHaveLength(1);
      expect(query('implementation-google-proximity-section')).toBeNull();
      expect(query('implementation-google-proximity-withheld')?.textContent).toContain('Demand Gen');
      // Held radii no longer suppress the country fallback, since none of them is being sent.
      expect(c['googleEffectiveGeoTargets']()).toEqual(['US']);
    });

    it.each([[null], [false]])('withholds the section and the payload while googleCreativeEnabled is %s', (capability) => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);
      fixture.componentRef.setInput('googleCreativeEnabled', capability);
      fixture.detectChanges();

      expect(c['googleProximityPayload']()).toEqual({});
      expect(query('implementation-google-proximity-section')).toBeNull();
    });

    /** A radius-only campaign sends no geo list: a country beside the radius would buy the country. */
    it('sends no geo list on a radius-only campaign rather than the event country', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);
      fixture.detectChanges();

      expect(c['googleEffectiveGeoTargets']()).toEqual([]);
      expect(query('implementation-google-geo-finer-only')).not.toBeNull();
      expect(query('implementation-google-geo-none')).toBeNull();
    });

    it('submits the radius targets as proximityTargets, beside the countries', async () => {
      const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleGeoTarget']('AU');
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);
      fixture.detectChanges();
      expect(c['canSubmit']()).toBe(true);

      c['submit']();
      await fixture.whenStable();

      const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(request['geoTargets']).toEqual(['AU']);
      expect(request['proximityTargets']).toEqual([SYDNEY]);
    });

    it('omits proximityTargets from a submit with none', async () => {
      const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
      const c = seedChannel(fixture, { includeSearch: true });

      c['submit']();
      await fixture.whenStable();

      expect(createCampaign.mock.calls[0][0]).not.toHaveProperty('proximityTargets');
    });

    it('round-trips the targets through a draft, entries copied rather than shared', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      let emitted: CampaignImplementationDraft | undefined;
      fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);

      expect(emitted?.googleProximityTargets).toEqual([SYDNEY]);

      const saved = [{ ...SYDNEY }];
      c['googleProximityTargets'].set([]);
      restoreGoogleDraft(fixture, c, { googleProximityTargets: saved });
      c['googleProximityTargets']()[0].radius = 99;

      expect(saved[0].radius).toBe(25);
    });

    it('leaves the targets alone when the draft carries no radius key', () => {
      const c = seedChannel(fixture, { includeSearch: true });
      c['addGoogleProximityTarget'](SYDNEY_DRAFT);

      restoreGoogleDraft(fixture, c, {});

      expect(c['googleProximityTargets']()).toEqual([SYDNEY]);
    });
  });
});
