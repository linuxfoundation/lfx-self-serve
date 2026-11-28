// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_REPORT_ASSET_LABELS } from '@lfx-one/shared/constants';
import type { MktgAssetReport, MktgReportInheritedGroup, MktgReportInheritedView } from '@lfx-one/shared/interfaces';
import { mktgRedraftReportFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-report-v2.fixture';
import { mktgReportInheritedView } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgReportInheritedComponent } from './mktg-report-inherited.component';

@Component({
  selector: 'lfx-test-report-inherited-host',
  imports: [MktgReportInheritedComponent],
  template: `<lfx-mktg-report-inherited [group]="group()" [view]="view()" />`,
})
class HostComponent {
  // The framework agent's real inherited block: version 1's sources, and the page version 1 could not read.
  public readonly view = signal<MktgReportInheritedView>(mktgReportInheritedView(mktgRedraftReportFixture(), MKTG_REPORT_ASSET_LABELS));
  public readonly group = signal<MktgReportInheritedGroup>('read');
}

describe('MktgReportInheritedComponent', () => {
  const render = async (group: MktgReportInheritedGroup, view?: MktgReportInheritedView): Promise<HTMLElement> => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.group.set(group);
    if (view) fixture.componentInstance.view.set(view);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const query = (root: HTMLElement, testId: string): HTMLElement | null => root.querySelector(`[data-testid="${testId}"]`);
  /** The texts of a list's rows, each row's lines in order. */
  const rows = (root: HTMLElement, testId: string): string[][] =>
    Array.from(query(root, testId)?.querySelectorAll('li') ?? []).map((row) =>
      Array.from(row.querySelectorAll('span:not(:has(span)):not(.sr-only), a')).map((line) => line.textContent?.trim() ?? '')
    );

  it('lists the sources read as the run’s own rows are, each with the version that read it, and only its own group', async () => {
    const root = await render('read');
    expect(rows(root, 'mktg-report-inherited-read').slice(-2)).toEqual([
      ['LFX record: Agentic AI Foundation (agentic-ai-foundation)', 'Read in version 1'],
      ['LFX standard metrics', 'Read in version 1'],
    ]);
    expect(query(root, 'mktg-report-inherited-read')?.querySelectorAll('i.fa-check')).toHaveLength(6);
    expect(query(root, 'mktg-report-inherited-failed')).toBeNull();
    // The host is `contents`, so the list is a child of the card it stands in.
    expect(root.querySelector('lfx-mktg-report-inherited')?.classList.contains('contents')).toBe(true);
  });

  it('lists a source a version could not read in the agent’s words, its detail, then the version', async () => {
    const root = await render('failed');
    expect(rows(root, 'mktg-report-inherited-failed')).toEqual([
      ['https://aaif.io/press', 'This page does not exist on the site (the server answered 404).', 'HTTP 404', 'Could not be read in version 1'],
    ]);
    expect(query(root, 'mktg-report-inherited-read')).toBeNull();
  });

  it('lists the inherited missing assets with their fix and the warnings with their source, a link only for an http(s) address', async () => {
    const report: MktgAssetReport = mktgRedraftReportFixture();
    report.inherited?.findings.missing_assets.push({ asset: 'press_release', reason: 'No press release was found.', fix: 'Add it as a link.', version: 1 });
    report.inherited?.findings.warnings.push(
      { code: 'truncated_read', text: 'The page was cut short.', source: 'https://aaif.io/long', version: 2 },
      { code: 'lfx_record_by_name', text: 'The record was found by name.', source: 'LFX record', version: 1 }
    );
    const view = mktgReportInheritedView(report, MKTG_REPORT_ASSET_LABELS);
    const missing = await render('missing', view);
    expect(rows(missing, 'mktg-report-inherited-missing')).toEqual([
      [MKTG_REPORT_ASSET_LABELS.press_release, 'No press release was found.', 'Fix: Add it as a link.', 'Missing in version 1'],
    ]);
    TestBed.resetTestingModule();
    const warnings = await render('warnings', view);
    expect(rows(warnings, 'mktg-report-inherited-warnings')).toEqual([
      ['The page was cut short.', 'https://aaif.io/long (opens in a new tab)', 'Noted in version 2'],
      ['The record was found by name.', 'LFX record', 'Noted in version 1'],
    ]);
    const link = query(warnings, 'mktg-report-inherited-warnings-source-link');
    expect(link?.getAttribute('href')).toBe('https://aaif.io/long');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders nothing for a group that inherited no row', async () => {
    const root = await render('missing');
    expect(root.querySelector('ul')).toBeNull();
    expect(query(root, 'mktg-report-inherited-marker')).toBeNull();
  });
});
