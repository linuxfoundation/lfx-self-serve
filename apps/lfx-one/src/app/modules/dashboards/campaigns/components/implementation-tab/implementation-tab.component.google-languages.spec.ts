// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GOOGLE_ADS_MAX_LANGUAGES } from '@lfx-one/shared/constants';
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
