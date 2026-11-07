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

describe('AeoGeoReportComponent print and Markdown details', () => {
  it('renders the details through the restricted Markdown renderer, keeps headings and blocks whole across pages, and spaces the source role', async () => {
    await TestBed.configureTestingModule({ imports: [AeoGeoReportComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AeoGeoReportComponent);
    const report = aeoGeoEnvelopeFixture().report;
    if (!report) {
      throw new Error('Recorded typed report is missing.');
    }
    // The live agent quotes evidence in Markdown code spans; a single newline is a line break, as the plain text's was.
    report.findings[0].detail = 'robots.txt contains `User-agent: *` and an empty `Disallow:` line.\nIt names no crawler.';
    report.recommendations[0].detail = 'Replace the `{"@graph":[]}` placeholder with an Organization node.';
    // A caveat with plumbing (a field name, a slug) prints as its reader sentences; the raw text reaches neither the screen nor the PDF.
    report.caveats[0] =
      "The LFX record could not be read by the form's project_uid (access error). A name search returned an entitled record (slug example-project). No LFX metrics were queried.";
    fixture.componentRef.setInput('report', report);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const findingDetail = element.querySelector<HTMLElement>('[data-testid="mktg-aeo-typed-finding-detail-0"]');
    expect(findingDetail?.tagName.toLowerCase()).toBe('lfx-markdown-renderer');
    expect(Array.from(findingDetail?.querySelectorAll('code') ?? [], (code) => code.textContent)).toEqual(['User-agent: *', 'Disallow:']);
    expect(findingDetail?.textContent).not.toContain('`');
    expect(findingDetail?.querySelector('br')).not.toBeNull();
    expect(findingDetail?.textContent).toContain('It names no crawler.');
    expect(element.querySelector('[data-testid="mktg-aeo-typed-recommendation-detail-0"] code')?.textContent).toBe('{"@graph":[]}');
    expect(element.querySelector('[data-testid="mktg-aeo-typed-findings"] p.whitespace-pre-line')).toBeNull();
    const caveats = Array.from(element.querySelectorAll('[data-testid="mktg-aeo-typed-caveats"] li'), (item) => item.textContent?.trim());
    expect(caveats[0]).toBe('The LFX project record could not be read directly. A name search returned an entitled record. No LFX metrics were queried.');
    expect(caveats).toHaveLength(report.caveats.length);
    expect(element.textContent).not.toMatch(/project_uid|slug |access error/);
    // No caveats: no Caveats section at all (no heading over an empty list), while the sections around it still render.
    fixture.componentRef.setInput('report', { ...report, caveats: [] });
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="mktg-aeo-typed-caveats"]')).toBeNull();
    expect(element.querySelector('[data-testid="mktg-aeo-typed-sources"]')).not.toBeNull();
    fixture.componentRef.setInput('report', report);
    fixture.detectChanges();
    // Every detail renders restricted: no raw HTML, no image, from the agent's text.
    report.findings[1].detail = 'Unsafe <img src="https://tracker.example/pixel.gif"> <b>markup</b>.';
    fixture.componentRef.setInput('report', { ...report });
    fixture.detectChanges();
    const unsafe = element.querySelector<HTMLElement>('[data-testid="mktg-aeo-typed-finding-detail-1"]');
    expect(unsafe?.querySelector('img, b')).toBeNull();
    expect(unsafe?.textContent).toContain('markup');
    // "https://site.example/ (audited)": a real space between the link and the role, on screen and in copied text.
    const source = element.querySelector('[data-testid="mktg-aeo-typed-source-link-0"]')?.parentElement;
    expect(source?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`${report.sources[0].url} (${report.sources[0].role})`);
    expect(element.querySelector('[data-testid="mktg-aeo-typed-source-role-0"]')?.textContent).toBe(` (${report.sources[0].role})`);
    // Pagination (computed in jsdom from the component stylesheet): a heading keeps with its block; a scorecard row, a finding,
    // a recommendation and a list item never split; the sections and lists flow, except a Sources list of up to 12 items, one block.
    for (const heading of element.querySelectorAll('h2, h3, h4')) expect(getComputedStyle(heading).breakAfter).toBe('avoid');
    expect(element.querySelectorAll('h4').length).toBe(report.scorecard.length + report.findings.length + report.recommendations.length);
    const shortSources = report.sources.length <= 12;
    const blocks = element.querySelectorAll<HTMLElement>('.lfx-aeo-report-block');
    expect(blocks).toHaveLength(report.scorecard.length + report.findings.length + report.recommendations.length + (shortSources ? 1 : 0));
    for (const block of blocks) expect(getComputedStyle(block).breakInside).toBe('avoid');
    expect(element.querySelector('[data-testid="mktg-aeo-typed-score-ai_crawler_access"]')?.classList.contains('lfx-aeo-report-block')).toBe(true);
    const sourcesSection = element.querySelector('[data-testid="mktg-aeo-typed-sources"]');
    expect(sourcesSection?.classList.contains('lfx-aeo-report-block')).toBe(shortSources);
    // The boundary: 12 sources keep together, 13 flow.
    const source13 = Array.from({ length: 13 }, (_, index) => ({ url: `https://reference.example/source-${index}`, role: 'external' as const }));
    fixture.componentRef.setInput('report', { ...report, sources: source13.slice(0, 12) });
    fixture.detectChanges();
    expect(sourcesSection?.classList.contains('lfx-aeo-report-block')).toBe(true);
    fixture.componentRef.setInput('report', { ...report, sources: source13 });
    fixture.detectChanges();
    expect(sourcesSection?.classList.contains('lfx-aeo-report-block')).toBe(false);
    for (const item of element.querySelectorAll('li')) expect(getComputedStyle(item).breakInside).toBe('avoid');
    for (const section of element.querySelectorAll('section')) expect(getComputedStyle(section).breakInside).not.toBe('avoid');
    fixture.destroy();
  });
});
