// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_REPORT_ASSET_LABELS } from '@lfx-one/shared/constants';
import type { MktgAssetReport, MktgReportFindingsView } from '@lfx-one/shared/interfaces';
import { faqReportV2Envelope } from '@lfx-one/shared/utils/__fixtures__/mktg-report-v2.fixture';
import { mktgReportFindingsView } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgReportFindingsComponent } from './mktg-report-findings.component';

@Component({
  selector: 'lfx-test-report-findings-host',
  imports: [MktgReportFindingsComponent],
  template: `<lfx-mktg-report-findings [view]="view()" />`,
})
class HostComponent {
  // The FAQ agent's real envelope: one open question with a fix, two warnings without a source.
  public readonly view = signal<MktgReportFindingsView>(mktgReportFindingsView(faqReportV2Envelope().report, MKTG_REPORT_ASSET_LABELS));
}

describe('MktgReportFindingsComponent', () => {
  const render = async (view?: MktgReportFindingsView): Promise<HTMLElement> => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    if (view) fixture.componentInstance.view.set(view);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const query = (root: HTMLElement, testId: string): HTMLElement | null => root.querySelector(`[data-testid="${testId}"]`);
  const text = (root: HTMLElement, testId: string): string | undefined => query(root, testId)?.textContent?.trim();

  it('renders the Missing assets and Warnings cards with the Brand Kit’s titles, each row in the agent’s words', async () => {
    const root = await render();
    expect(query(root, 'mktg-report-findings-missing')?.querySelector('h3')?.textContent).toBe('Missing assets');
    expect(query(root, 'mktg-report-findings-warnings')?.querySelector('h3')?.textContent).toBe('Warnings');
    const missing = query(root, 'mktg-report-findings-missing-item');
    expect(missing?.querySelector('span')?.textContent).toBe('Open question');
    expect(text(root, 'mktg-report-findings-missing-reason')).toBe('How do I propose a new project to AAIF?');
    expect(text(root, 'mktg-report-findings-missing-fix')).toBe('Fix: Answer it in a comment on this question and redraft, or remove the question.');
    const warnings = Array.from(root.querySelectorAll('[data-testid="mktg-report-findings-warnings-text"]')).map((node) => node.textContent?.trim());
    expect(warnings).toEqual(faqReportV2Envelope().report.findings?.warnings.map((warning) => warning.text));
    expect(warnings[0]).toContain('Is AAIF controlled by one AI company?');
    // No source on the agent's warnings: no link and no grey line.
    expect(query(root, 'mktg-report-findings-warnings-source-link')).toBeNull();
    expect(query(root, 'mktg-report-findings-missing-empty')).toBeNull();
    expect(query(root, 'mktg-report-findings-warnings-empty')).toBeNull();
    // The host is `contents`, so each card is a grid item of the tab's own grid.
    expect(root.querySelector('lfx-mktg-report-findings')?.classList.contains('contents')).toBe(true);
  });

  it('links a warning’s http(s) source in a new tab, prints any other source as grey text, and leaves out an absent fix', async () => {
    const report: MktgAssetReport = {
      sources_read: [],
      sources_failed: [],
      gaps: [],
      notes: '',
      version: 2,
      findings: {
        sources_failed: [],
        missing_assets: [{ asset: 'something_new', reason: 'Not found.' }],
        warnings: [
          { code: 'truncated_read', text: 'The page was cut short.', source: 'https://aaif.io/' },
          { code: 'lfx_record_by_name', text: 'The record was found by name.', source: 'LFX record' },
        ],
      },
    };
    const root = await render(mktgReportFindingsView(report, MKTG_REPORT_ASSET_LABELS));
    expect(query(root, 'mktg-report-findings-missing-item')?.querySelector('span')?.textContent).toBe('something_new');
    expect(query(root, 'mktg-report-findings-missing-fix')).toBeNull();
    const link = query(root, 'mktg-report-findings-warnings-source-link') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('https://aaif.io/');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toContain('https://aaif.io/');
    const items = Array.from(root.querySelectorAll('[data-testid="mktg-report-findings-warnings-item"]'));
    expect(items).toHaveLength(2);
    expect(items[1].querySelector('a')).toBeNull();
    expect(items[1].textContent).toContain('LFX record');
  });

  it('says so under each empty group, in the Brand Kit’s words', async () => {
    const root = await render({ hasFindings: true, failed: [], missing: [], warnings: [] });
    expect(text(root, 'mktg-report-findings-missing-empty')).toBe('Nothing is missing.');
    expect(text(root, 'mktg-report-findings-warnings-empty')).toBe('No warnings.');
    expect(query(root, 'mktg-report-findings-missing-item')).toBeNull();
    expect(query(root, 'mktg-report-findings-warnings-item')).toBeNull();
  });
});
