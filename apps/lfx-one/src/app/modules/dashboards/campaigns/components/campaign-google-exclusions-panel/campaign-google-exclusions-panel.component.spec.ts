// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS } from '@lfx-one/shared/constants';
import type { GoogleAdsAgeRange, GoogleAdsGender } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignGoogleExclusionsPanelComponent } from './campaign-google-exclusions-panel.component';

describe('CampaignGoogleExclusionsPanelComponent', () => {
  let fixture: ComponentFixture<CampaignGoogleExclusionsPanelComponent>;
  let ageRanges: GoogleAdsAgeRange[][];
  let genders: GoogleAdsGender[][];
  let geos: string[][];

  function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  }

  /** Clicks the real checkbox inside one `lfx-ui-checkbox`. */
  function tick(testId: string): void {
    (query(testId)?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
  }

  /** Opens the countries `lfx-ui-multi-select` and toggles the row with this label. */
  async function toggleCountry(code: string): Promise<void> {
    (query('implementation-google-excluded-geo-countries')?.querySelector('[data-testid="ui-multi-select-trigger"]') as HTMLElement).click();
    await settle();
    const content = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option-content"]')).find((row) => row.textContent?.trim() === code);
    (content as HTMLElement).click();
    await settle();
  }

  async function typeId(text: string): Promise<void> {
    const box = query('implementation-google-excluded-geo-id')?.querySelector('input') as HTMLInputElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    await settle();
  }

  function clickExclude(): void {
    (query('implementation-google-excluded-geo-add')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function render(inputs: {
    ageRanges?: GoogleAdsAgeRange[];
    genders?: GoogleAdsGender[];
    geos?: string[];
    demographicsError?: string | null;
    geosError?: string | null;
    showDemographics?: boolean;
    showExcludedGeos?: boolean;
  }): void {
    fixture.componentRef.setInput('showDemographics', inputs.showDemographics ?? true);
    fixture.componentRef.setInput('showExcludedGeos', inputs.showExcludedGeos ?? true);
    fixture.componentRef.setInput('excludedAgeRanges', inputs.ageRanges ?? []);
    fixture.componentRef.setInput('excludedGenders', inputs.genders ?? []);
    fixture.componentRef.setInput('excludedGeoTargets', inputs.geos ?? []);
    fixture.componentRef.setInput('demographicsError', inputs.demographicsError ?? null);
    fixture.componentRef.setInput('excludedGeosError', inputs.geosError ?? null);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CampaignGoogleExclusionsPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(CampaignGoogleExclusionsPanelComponent);
    document.body.appendChild(fixture.nativeElement);
    ageRanges = [];
    genders = [];
    geos = [];
    fixture.componentInstance.excludedAgeRanges.subscribe((list) => ageRanges.push(list));
    fixture.componentInstance.excludedGenders.subscribe((list) => genders.push(list));
    fixture.componentInstance.excludedGeoTargets.subscribe((list) => geos.push(list));
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('offers every friendly age range and gender as a labelled checkbox, ticked from the lists it is given', () => {
    render({ ageRanges: ['65+'], genders: ['UNDETERMINED'] });

    const ageLabels = Array.from(query('implementation-google-age-ranges')?.querySelectorAll('[data-testid="ui-checkbox-text"]') ?? []).map(
      (l) => l.textContent
    );
    expect(ageLabels).toEqual(['18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 or more', 'Unknown']);
    expect((query('implementation-google-age-range-65+')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect((query('implementation-google-age-range-18-24')?.querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect((query('implementation-google-gender-UNDETERMINED')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(query('implementation-google-gender-MALE')?.textContent).toContain('Male');
  });

  it('writes a ticked and an unticked box back through the lists', () => {
    render({ ageRanges: ['18-24'] });

    tick('implementation-google-age-range-25-34');
    expect(ageRanges.at(-1)).toEqual(['18-24', '25-34']);
    tick('implementation-google-age-range-18-24');
    expect(ageRanges.at(-1)).toEqual(['25-34']);
    tick('implementation-google-gender-FEMALE');
    expect(genders.at(-1)).toEqual(['FEMALE']);
  });

  it('picks countries through the real multi-select, keeping countries first and geo ids after them', async () => {
    render({ geos: ['1023191'] });

    await toggleCountry('DE');
    expect(geos.at(-1)).toEqual(['DE', '1023191']);
  });

  it('adds a typed geo target id trimmed and upper-cased, once, and empties the box', async () => {
    render({ geos: ['DE'] });
    expect((query('implementation-google-excluded-geo-add')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    await typeId('  1023191 ');
    clickExclude();
    expect(geos.at(-1)).toEqual(['DE', '1023191']);
    expect((query('implementation-google-excluded-geo-id')?.querySelector('input') as HTMLInputElement).value).toBe('');

    // A repeat is not added again; text that is not an id is added, for the shared refusal to name.
    fixture.componentRef.setInput('excludedGeoTargets', ['DE', '1023191']);
    await typeId('1023191');
    clickExclude();
    expect(geos.at(-1)).toEqual(['DE', '1023191']);
    await typeId('zz');
    clickExclude();
    expect(geos.at(-1)).toEqual(['DE', '1023191', 'ZZ']);
  });

  it('lists every excluded entry as a chip whose × removes it', () => {
    render({ geos: ['DE', '1023191'] });

    expect(query('implementation-google-excluded-geos')?.querySelector('legend')?.textContent).toContain(
      `Excluded locations (2/${GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS})`
    );
    (query('implementation-google-excluded-geo-chip-DE')?.querySelector('[data-testid="ui-chip-dismiss"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(geos.at(-1)).toEqual(['1023191']);
  });

  it('moves focus to the geo target id box when the last chip is removed by keyboard, though the chip row unmounts', async () => {
    render({ geos: ['DE'] });
    const dismiss = query('implementation-google-excluded-geo-chip-DE')?.querySelector('[data-testid="ui-chip-dismiss"]') as HTMLButtonElement;
    dismiss.focus();
    dismiss.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    dismiss.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(geos.at(-1)).toEqual([]);
    expect(query('implementation-google-excluded-geo-chips')).toBeNull();
    expect(document.activeElement).toBe(query('implementation-google-excluded-geo-id')?.querySelector('input'));
  });

  it('shows each error under its section and links it with aria-describedby', () => {
    render({});
    expect(query('implementation-google-demographics')?.getAttribute('aria-describedby')).toBe('google-demographics-hint');
    expect(query('implementation-google-excluded-geos')?.getAttribute('aria-describedby')).toBe('google-excluded-geos-hint');
    expect(query('implementation-google-demographics-error')).toBeNull();

    render({ demographicsError: 'Age refused.', geosError: 'Clash refused.' });

    expect(query('implementation-google-demographics')?.getAttribute('aria-describedby')).toBe('google-demographics-hint google-demographics-error');
    expect(query('implementation-google-excluded-geos')?.getAttribute('aria-describedby')).toBe('google-excluded-geos-hint google-excluded-geos-error');
    expect(query('implementation-google-demographics-error')?.textContent).toContain('Age refused.');
    expect(query('implementation-google-excluded-geos-error')?.textContent).toContain('Clash refused.');
    expect(query('implementation-google-exclusions-live')?.textContent).toContain('Age refused.');
    expect(query('implementation-google-exclusions-live')?.textContent).toContain('Clash refused.');
  });

  it('renders only the sections it is told to', () => {
    render({ showDemographics: false });
    expect(query('implementation-google-demographics')).toBeNull();
    expect(query('implementation-google-excluded-geos')).not.toBeNull();

    render({ showExcludedGeos: false });
    expect(query('implementation-google-demographics')).not.toBeNull();
    expect(query('implementation-google-excluded-geos')).toBeNull();
  });
});
