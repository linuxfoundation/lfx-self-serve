// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
// package-architecture.md § Import Patterns: test fixtures are not re-exported by the production utils barrel.
import { aeoGeoEnvelopeFixture } from '@lfx-one/shared/utils/aeo-geo.fixture';
import { describe, expect, it } from 'vitest';
import { AeoGeoReportComponent } from './aeo-geo-report.component';

describe('AeoGeoReportComponent', () => {
  it.each(['project', 'domain'] as const)('renders the recorded %s report in order and leaves non-URL evidence as plain text', async (kind) => {
    await TestBed.configureTestingModule({ imports: [AeoGeoReportComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AeoGeoReportComponent);
    const report = aeoGeoEnvelopeFixture(kind).report;
    if (!report) {
      throw new Error('Recorded typed report is missing.');
    }
    report.findings[0].evidence.push('javascript:alert(1)', 'https://fixture-user@reference.example/source');
    report.sources.push({ url: 'https://fixture-user@reference.example/source', role: 'external' });
    fixture.componentRef.setInput('report', report);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('[data-testid^="mktg-aeo-typed-score-"]')).toHaveLength(6);
    expect(Array.from(element.querySelectorAll('section > h3')).map((heading) => heading.textContent)).toEqual([
      'Scorecard',
      'Findings',
      'Recommendations (priority order)',
      'Caveats & unverified items',
      'Sources',
    ]);
    expect(element.textContent).toContain(report.headline);
    expect(element.querySelector('[data-testid="mktg-aeo-typed-verdict"]')).toBeNull();
    expect(element.querySelector('[data-testid="mktg-aeo-typed-scorecard"]')?.textContent).toContain(report.scorecard[0].summary);
    expect(element.textContent).toContain(report.recommendations[0].title);
    expect(element.querySelector('[href^="javascript:"]')).toBeNull();
    expect(element.querySelector('[href*="fixture-user@"]')).toBeNull();
    expect(element.querySelector('[data-testid="mktg-aeo-typed-source-link-0"]')?.getAttribute('href')).toBe(report.sources[0].url);
    expect(element.querySelector('[data-testid^="mktg-aeo-typed-evidence-link-"]')).not.toBeNull();
    fixture.componentRef.setInput('showHeadline', false);
    fixture.detectChanges();
    expect(element.querySelector('h2')).toBeNull();
    fixture.destroy();
  });
});
