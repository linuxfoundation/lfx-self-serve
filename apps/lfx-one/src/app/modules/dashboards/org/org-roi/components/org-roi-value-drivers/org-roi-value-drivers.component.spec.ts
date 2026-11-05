// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ORG_LENS_ROI_VALUE_DRIVERS_COLORS } from '@lfx-one/shared/constants';
import type { OrgLensRoiValueDrivers } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgRoiValueDriversComponent } from './org-roi-value-drivers.component';

const REFERENCE: OrgLensRoiValueDrivers = {
  method: 'logit',
  nProjects: 12,
  rows: [
    { category: 'Direct Cost Savings', pctDeviation: -9.7 },
    { category: 'Revenue Boosters', pctDeviation: 14.2 },
    { category: 'Risk Mitigation', pctDeviation: -5.3 },
    { category: 'Strategic', pctDeviation: 6.8 },
    { category: 'Prosocial', pctDeviation: 1.9 },
  ],
};

describe('OrgRoiValueDriversComponent', () => {
  let fixture: ComponentFixture<OrgRoiValueDriversComponent>;
  let getValueDrivers: ReturnType<typeof vi.fn>;

  const render = async (response: Observable<OrgLensRoiValueDrivers>): Promise<HTMLElement> => {
    getValueDrivers.mockReturnValue(response);
    fixture = TestBed.createComponent(OrgRoiValueDriversComponent);
    fixture.componentRef.setInput('method', 'logit');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    getValueDrivers = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: OrgLensRoiService, useValue: { getValueDrivers } },
        { provide: AccountContextService, useValue: { selectedAccount: () => ({ accountId: '001410000000000AAA', accountName: 'Acme Motors' }) } },
      ],
    });
  });

  it('requests the selected organization and method', async () => {
    await render(of(REFERENCE));
    expect(getValueDrivers).toHaveBeenCalledWith('001410000000000AAA', 'logit');
  });

  it('orders bars by deviation and colors them by sign', async () => {
    await render(of(REFERENCE));
    expect(q('org-roi-value-drivers-row-0')?.textContent).toContain('Revenue Boosters');
    expect(q('org-roi-value-drivers-value-0')?.textContent?.trim()).toBe('+14.2%');
    expect(q('org-roi-value-drivers-value-4')?.textContent?.trim()).toBe('-9.7%');
    expect(q('org-roi-value-drivers-bar-0')?.style.backgroundColor).not.toBe('');
    expect(q('org-roi-value-drivers-bar-0')?.style.backgroundColor).not.toBe(q('org-roi-value-drivers-bar-4')?.style.backgroundColor);
    expect(ORG_LENS_ROI_VALUE_DRIVERS_COLORS.moreThanAverage).not.toBe(ORG_LENS_ROI_VALUE_DRIVERS_COLORS.lessThanAverage);
  });

  it('keeps the label inside the plot when a bar reaches the axis bound', async () => {
    await render(
      of({
        ...REFERENCE,
        rows: [
          { category: 'Revenue Boosters', pctDeviation: 50 },
          { category: 'Strategic', pctDeviation: 10 },
          { category: 'Direct Cost Savings', pctDeviation: -50 },
        ],
      })
    );
    const longPositive = q('org-roi-value-drivers-value-0') as HTMLElement;
    const short = q('org-roi-value-drivers-value-1') as HTMLElement;
    const longNegative = q('org-roi-value-drivers-value-2') as HTMLElement;
    expect(longPositive.style.right).not.toBe('');
    expect(longPositive.style.left).toBe('');
    expect(longNegative.style.left).not.toBe('');
    expect(longNegative.style.right).toBe('');
    expect(short.style.left).not.toBe('');
    expect(short.style.right).toBe('');
  });

  it('puts the how-to-read box above the chart and the details under a Details heading', async () => {
    await render(of(REFERENCE));
    const chart = q('org-roi-value-drivers-chart') as HTMLElement;
    const howToRead = q('org-roi-value-drivers-how-to-read') as HTMLElement;
    const heading = q('org-roi-value-drivers-details-heading') as HTMLElement;
    const summary = q('org-roi-value-drivers-summary') as HTMLElement;
    const follows = (a: HTMLElement, b: HTMLElement): boolean => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(howToRead, chart)).toBe(true);
    expect(follows(chart, heading)).toBe(true);
    expect(heading.textContent?.trim()).toBe('Details');
    expect(follows(heading, summary)).toBe(true);
  });

  it('states how many projects the figures are based on', async () => {
    await render(of(REFERENCE));
    expect(q('org-roi-value-drivers-summary')?.textContent?.trim()).toBe('Based on your 12 projects.');
  });

  it('explains what the bars mean without the term markup', async () => {
    await render(of(REFERENCE));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(q('org-roi-value-drivers-how-to-read')?.textContent).toContain('relative to the typical organization-project pair');
    expect(q('org-roi-value-drivers-typical')?.textContent).toContain('not that the driver provides no value');
    expect(q('org-roi-value-drivers-association')?.textContent).toContain('associations, not proven causes');
    expect(q('org-roi-value-drivers-directional')?.textContent).toContain(
      'Value driver decomposition can be sensitive to small portfolios. Treat these results as directional.'
    );
    expect(q('org-roi-value-drivers-coverage')).toBeNull();
    expect(text.toLowerCase()).not.toContain('markup');
    expect(text).not.toContain('8 of the 17');
  });

  it('exposes an accessible text equivalent', async () => {
    await render(of(REFERENCE));
    expect(q('org-roi-value-drivers-chart')?.getAttribute('aria-label')).toContain('Revenue Boosters +14.2%');
    expect(q('org-roi-value-drivers-table')?.querySelectorAll('tbody tr').length).toBe(5);
  });

  it('shows the empty state, not zero bars, when there are no rows', async () => {
    await render(of({ ...REFERENCE, nProjects: 0, rows: [] }));
    expect(q('org-roi-value-drivers-empty-state')).not.toBeNull();
    expect(q('org-roi-value-drivers-chart')).toBeNull();
  });

  it('shows a could-not-load state when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render(throwError(() => new HttpErrorResponse({ status: 500 })));
    expect(q('org-roi-value-drivers-empty-state')).not.toBeNull();
    expect(q('org-roi-value-drivers-chart')).toBeNull();
  });
});
