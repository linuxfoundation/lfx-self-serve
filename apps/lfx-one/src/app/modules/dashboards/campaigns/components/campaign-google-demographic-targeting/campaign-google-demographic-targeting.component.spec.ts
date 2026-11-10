// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GoogleDisplayDemographics } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignGoogleDemographicTargetingComponent } from './campaign-google-demographic-targeting.component';

describe('CampaignGoogleDemographicTargetingComponent', () => {
  let fixture: ComponentFixture<CampaignGoogleDemographicTargetingComponent>;
  let written: GoogleDisplayDemographics[];

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function render(targeting: GoogleDisplayDemographics): void {
    fixture.componentRef.setInput('legend', 'Demographics');
    fixture.componentRef.setInput('testId', 'targeting');
    fixture.componentRef.setInput('optionTestIdPrefix', 'target-');
    fixture.componentRef.setInput('describedBy', 'hint');
    fixture.componentRef.setInput('targeting', targeting);
    fixture.detectChanges();
  }

  function tick(testId: string): void {
    (query(testId)?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CampaignGoogleDemographicTargetingComponent] }).compileComponents();
    fixture = TestBed.createComponent(CampaignGoogleDemographicTargetingComponent);
    written = [];
    fixture.componentInstance.targeting.subscribe((value) => written.push(value));
  });

  it('renders the four groups under its legend, each value ticked as the object holds it', () => {
    render({ genders: ['FEMALE'] });

    expect(query('targeting')?.querySelector('legend')?.textContent).toContain('Demographics');
    expect(query('targeting')?.getAttribute('aria-describedby')).toBe('hint');
    for (const key of ['ageRanges', 'genders', 'incomeRanges', 'parentalStatuses']) expect(query(`target-${key}`)).not.toBeNull();
    expect((query('target-genders-FEMALE')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect((query('target-genders-MALE')?.querySelector('input') as HTMLInputElement).checked).toBe(false);
  });

  it('writes each tick back into its own list, keeping the others, and unticks', () => {
    render({ genders: ['FEMALE'] });

    tick('target-ageRanges-25-34');
    expect(written.at(-1)).toEqual({ genders: ['FEMALE'], ageRanges: ['25-34'] });

    tick('target-genders-FEMALE');
    expect(written.at(-1)).toEqual({ genders: [], ageRanges: ['25-34'] });
  });
});
