// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgMeetingsSpendSegment } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgSpendBarComponent } from './org-spend-bar.component';

describe('OrgSpendBarComponent', () => {
  let fixture: ComponentFixture<OrgSpendBarComponent>;

  /** Renders the card and returns the attendance total it displays, or null when the card hides it. */
  function renderTotal(segments: OrgMeetingsSpendSegment[]): string | null {
    fixture.componentRef.setInput('segments', segments);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="org-spend-bar-top-projects-total"]')?.textContent?.trim() ?? null;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrgSpendBarComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgSpendBarComponent);
    fixture.componentRef.setInput('title', 'Top Projects');
    fixture.componentRef.setInput('icon', 'fa-light fa-diagram-project');
    fixture.componentRef.setInput('segments', []);
  });

  it('sums the attendance counts across the named rows', () => {
    expect(
      renderTotal([
        { label: 'Project A', pct: 60, count: 120 },
        { label: 'Project B', pct: 40, count: 80 },
      ])
    ).toBe('200 attendances');
  });

  // The others bucket carries its own share of the denominator; leaving it out would show a total the
  // displayed percentages do not divide by.
  it('includes the others bucket in the denominator', () => {
    expect(
      renderTotal([
        { label: 'Project A', pct: 60, count: 120 },
        { label: 'Others', pct: 40, count: 80, others: [{ label: 'Project C', pct: 25 }] },
      ])
    ).toBe('200 attendances');
  });

  // The BFF may omit `count` on a segment; the card must not render `NaN attendances`.
  it('treats a segment with no count as zero', () => {
    expect(
      renderTotal([
        { label: 'Project A', pct: 60, count: 120 },
        { label: 'Project B', pct: 40 },
      ])
    ).toBe('120 attendances');
  });

  it('hides the total when no segment carries a count', () => {
    expect(
      renderTotal([
        { label: 'Project A', pct: 60 },
        { label: 'Project B', pct: 40 },
      ])
    ).toBeNull();
  });

  it('hides the total when there are no segments at all', () => {
    expect(renderTotal([])).toBeNull();
  });
});
