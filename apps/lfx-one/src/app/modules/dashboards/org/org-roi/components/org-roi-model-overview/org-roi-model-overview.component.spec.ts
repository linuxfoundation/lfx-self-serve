// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ORG_LENS_ROI_DOCS_URL, ORG_LENS_ROI_GLOBAL_ASSUMPTIONS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgRoiModelOverviewComponent } from './org-roi-model-overview.component';

describe('OrgRoiModelOverviewComponent', () => {
  let fixture: ComponentFixture<OrgRoiModelOverviewComponent>;

  const text = (testId: string): string => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrgRoiModelOverviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(OrgRoiModelOverviewComponent);
    fixture.detectChanges();
  });

  it('states the privacy commitment the page makes about investment', () => {
    const investment = text('org-roi-model-overview-investment');
    expect(investment).toContain('same for every company');
    expect(investment).toContain('No salary, payroll, or invoice data is used.');
  });

  it('explains that value is inferred from behavior, and links the research it is calibrated against', () => {
    expect(text('org-roi-model-overview-markup')).toContain('markup');

    const survey: HTMLAnchorElement | null = fixture.nativeElement.querySelector('[data-testid="org-roi-model-overview-survey-link"]');
    expect(survey?.getAttribute('href')).toContain('linuxfoundation.org/research/contribution-roi');
    expect(survey?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the cost rates as stated values rather than as inputs', () => {
    const rates = fixture.nativeElement.querySelector('[data-testid="org-roi-model-overview-rates"]');
    expect(rates.textContent).toContain(`$${ORG_LENS_ROI_GLOBAL_ASSUMPTIONS.codeSalaryUsd.toLocaleString('en-US')}`);
    expect(rates.textContent).toContain(`$${ORG_LENS_ROI_GLOBAL_ASSUMPTIONS.communitySalaryUsd.toLocaleString('en-US')}`);
    expect(rates.querySelectorAll('input')).toHaveLength(0);
  });

  /**
   * The documentation is unpublished, so the constant is empty and the band must offer no link at
   * all. A link rendered against an empty href would navigate to the current page.
   */
  it('omits the documentation link while no documentation URL is configured', () => {
    expect(ORG_LENS_ROI_DOCS_URL).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="org-roi-model-overview-docs-link"]')).toBeNull();
  });
});
