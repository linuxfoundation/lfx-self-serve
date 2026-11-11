// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GoogleAdsIncomeRange, GoogleAdsObservedDemographic, GoogleAdsParentalStatus, GoogleDisplayDemographics } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignGoogleDemographicsPanelComponent } from './campaign-google-demographics-panel.component';

describe('CampaignGoogleDemographicsPanelComponent', () => {
  let fixture: ComponentFixture<CampaignGoogleDemographicsPanelComponent>;
  let incomes: GoogleAdsIncomeRange[][];
  let parents: GoogleAdsParentalStatus[][];
  let observed: GoogleAdsObservedDemographic[][];
  let targeting: GoogleDisplayDemographics[];

  function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function tick(testId: string): void {
    (query(testId)?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
  }

  function render(inputs: {
    show?: Partial<Record<'showIncomeExclusions' | 'showParentalExclusions' | 'showObserved' | 'showTargeting', boolean>>;
    incomes?: GoogleAdsIncomeRange[];
    parents?: GoogleAdsParentalStatus[];
    observed?: GoogleAdsObservedDemographic[];
    targeting?: GoogleDisplayDemographics;
    error?: string | null;
  }): void {
    for (const key of ['showIncomeExclusions', 'showParentalExclusions', 'showObserved', 'showTargeting'] as const) {
      fixture.componentRef.setInput(key, inputs.show?.[key] ?? true);
    }
    fixture.componentRef.setInput('excludedIncomeRanges', inputs.incomes ?? []);
    fixture.componentRef.setInput('excludedParentalStatuses', inputs.parents ?? []);
    fixture.componentRef.setInput('observedDemographics', inputs.observed ?? []);
    fixture.componentRef.setInput('displayDemographics', inputs.targeting ?? {});
    fixture.componentRef.setInput('error', inputs.error ?? null);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CampaignGoogleDemographicsPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(CampaignGoogleDemographicsPanelComponent);
    incomes = [];
    parents = [];
    observed = [];
    targeting = [];
    fixture.componentInstance.excludedIncomeRanges.subscribe((list) => incomes.push(list));
    fixture.componentInstance.excludedParentalStatuses.subscribe((list) => parents.push(list));
    fixture.componentInstance.observedDemographics.subscribe((list) => observed.push(list));
    fixture.componentInstance.displayDemographics.subscribe((value) => targeting.push(value));
  });

  it('renders only the sections it is told to', () => {
    render({ show: { showParentalExclusions: false, showTargeting: false } });

    expect(query('implementation-google-observed-demographics')).not.toBeNull();
    expect(query('implementation-google-income-exclusions')).not.toBeNull();
    expect(query('implementation-google-parental-exclusions')).toBeNull();
    expect(query('implementation-google-demographic-targeting')).toBeNull();
  });

  it('renders no fieldset when no section is on show, but keeps the live region', () => {
    render({ show: { showIncomeExclusions: false, showParentalExclusions: false, showObserved: false, showTargeting: false } });

    expect(query('implementation-google-ad-group-demographics')).toBeNull();
    expect(query('implementation-google-ad-group-demographics-live')).not.toBeNull();
  });

  it('writes each exclusion and observed dimension tick back, and unticks', () => {
    render({ incomes: ['INCOME_RANGE_0_50'] });

    tick('implementation-google-income-INCOME_RANGE_90_UP');
    tick('implementation-google-parental-PARENT');
    tick('implementation-google-observed-GENDER');
    tick('implementation-google-income-INCOME_RANGE_0_50');

    expect(incomes).toEqual([['INCOME_RANGE_0_50', 'INCOME_RANGE_90_UP'], ['INCOME_RANGE_90_UP']]);
    expect(parents).toEqual([['PARENT']]);
    expect(observed).toEqual([['GENDER']]);
  });

  it('writes a targeting tick into its own list, keeping the others', () => {
    render({ targeting: { genders: ['FEMALE'] } });

    tick('implementation-google-target-ageRanges-25-34');
    tick('implementation-google-target-genders-FEMALE');

    expect(targeting).toEqual([
      { genders: ['FEMALE'], ageRanges: ['25-34'] },
      { genders: [], ageRanges: ['25-34'] },
    ]);
  });

  it('labels values in Google Ads words and shows ticks from its inputs', () => {
    render({ incomes: ['INCOME_RANGE_90_UP'], targeting: { parentalStatuses: ['NOT_A_PARENT'] } });

    expect(query('implementation-google-income-INCOME_RANGE_90_UP')?.textContent).toContain('Top 10%');
    expect(query<HTMLInputElement>('implementation-google-income-INCOME_RANGE_90_UP')?.querySelector('input')?.checked).toBe(true);
    expect(query('implementation-google-target-parentalStatuses-NOT_A_PARENT')?.textContent).toContain('Not a parent');
    expect(query('implementation-google-target-parentalStatuses-NOT_A_PARENT')?.querySelector('input')?.checked).toBe(true);
  });

  it('shows the error under the panel, describes the fieldset with it and announces it', () => {
    render({ error: 'Every gender is excluded, so there is nothing left to observe.' });

    expect(query('implementation-google-ad-group-demographics-error')?.textContent).toContain('Every gender is excluded');
    expect(query('implementation-google-ad-group-demographics')?.getAttribute('aria-describedby')).toBe(
      'google-ad-group-demographics-hint google-ad-group-demographics-error'
    );
    expect(query('implementation-google-ad-group-demographics-live')?.textContent).toContain('Every gender is excluded');
  });
});
