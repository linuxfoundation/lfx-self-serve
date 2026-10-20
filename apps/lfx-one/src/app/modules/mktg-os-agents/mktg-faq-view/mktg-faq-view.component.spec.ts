// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MktgFaqAsset } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MktgFaqViewComponent } from './mktg-faq-view.component';

@Component({
  selector: 'lfx-test-faq-host',
  imports: [MktgFaqViewComponent],
  template: `<lfx-mktg-faq-view projectName="TestOrbit" [asset]="asset()" [version]="version()" [showMetadata]="showMetadata()" note="latest"
    ><span asset-actions data-testid="faq-test-actions">Approve</span></lfx-mktg-faq-view
  >`,
})
class HostComponent {
  public readonly asset = signal<MktgFaqAsset>(ASSET);
  public readonly version = signal<number | null>(3);
  public readonly showMetadata = signal(true);
}

const ASSET: MktgFaqAsset = {
  kind: 'faq',
  content: {
    faq: [
      [
        'About TestOrbit',
        [
          ['What is TestOrbit?', 'TestOrbit is an open release toolkit.', 'Website'],
          ['How much does membership cost?', null, null],
        ],
      ],
      ['Getting involved', [['How do I contribute?', 'Open a pull request on GitHub.', 'Docs']]],
    ],
  },
  report: {
    sources_read: ['https://testorbit.example.org'],
    sources_failed: [{ name: 'https://testorbit.example.org/members', reason: '404' }],
    gaps: ['How much does membership cost?'],
    notes: '',
  },
  checks: { findings: [], unanswered: [{ path: 'faq[0][1][1]', group: 'About TestOrbit', question: 'How much does membership cost?' }] },
  mode: 'draft',
};

describe('MktgFaqViewComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('heads the page with the title, the version, the mode, the size and what needs the team', () => {
    expect(text('mktg-faq-view-title')).toBe('TestOrbit FAQ');
    expect(text('mktg-faq-view-version')).toBe('v3');
    expect(text('mktg-faq-view-approval-state')).toBe('Draft');
    expect(query('mktg-faq-view-mode')).toBeNull();
    expect(text('mktg-faq-view-size')).toBe('3 questions in 2 groups');
    expect(text('mktg-faq-view-unanswered-chip')).toBe('1 question needs an answer from your team');
    expect(text('mktg-faq-view-tab-unanswered')).toBe('Needs an answer (1)');
  });

  it('hides duplicate document metadata while retaining header actions and native content', async () => {
    host.showMetadata.set(false);
    await fixture.whenStable();
    expect(query('mktg-faq-view-title')).toBeNull();
    expect(query('mktg-faq-view-metadata')).toBeNull();
    expect(text('faq-test-actions')).toBe('Approve');
    expect(query('mktg-faq-view-groups')).not.toBeNull();
  });

  it('shows every group with its questions, each answer with its source, and flags the unanswered one', () => {
    expect(text('mktg-faq-view-group-0')).toContain('About TestOrbit');
    expect(text('mktg-faq-view-question-0-0')).toContain('TestOrbit is an open release toolkit.');
    expect(text('mktg-faq-view-source-0-0')).toBe('Website');
    expect(text('mktg-faq-view-needs-answer-0-1')).toBe('Needs an answer from your team');
    expect(query('mktg-faq-view-source-0-1')).toBeNull();
    expect(text('mktg-faq-view-group-1')).toContain('How do I contribute?');
    expect(query('mktg-faq-view-unanswered-callout')).not.toBeNull();
  });

  it('lists the unanswered questions for the reviewer on their own tab, and says so when there are none', async () => {
    query('mktg-faq-view-unanswered-open')?.click();
    await fixture.whenStable();
    expect(query('mktg-faq-view-tab-unanswered')?.getAttribute('aria-selected')).toBe('true');
    expect(text('mktg-faq-view-unanswered-list')).toContain('About TestOrbit');
    expect(text('mktg-faq-view-unanswered-list')).toContain('How much does membership cost?');

    host.asset.set({ ...ASSET, checks: { findings: [], unanswered: [] } });
    await fixture.whenStable();
    expect(query('mktg-faq-view-unanswered-empty')).not.toBeNull();
    expect(query('mktg-faq-view-unanswered-chip')).toBeNull();
    expect(text('mktg-faq-view-tab-unanswered')).toBe('Needs an answer');
  });

  it('moves the focus onto the selected tab once it has rendered when a shortcut opens it', async () => {
    query('mktg-faq-view-unanswered-chip')?.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(query('mktg-faq-view-tab-unanswered'));
  });

  it('shows the sources read, the failed ones, the gaps and the checks', async () => {
    query('mktg-faq-view-tab-sources')?.click();
    await fixture.whenStable();
    expect(text('mktg-faq-view-sources-read')).toContain('https://testorbit.example.org');
    expect(text('mktg-faq-view-sources-failed')).toContain('404');
    expect(text('mktg-faq-view-gaps')).toContain('How much does membership cost?');
    expect(query('mktg-faq-view-checks-empty')).not.toBeNull();
  });

  it('moves along the tabs with the arrow keys', async () => {
    const tablist = query('mktg-faq-view-tabs') as HTMLElement;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await fixture.whenStable();
    expect(query('mktg-faq-view-panel-sources')).not.toBeNull();
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(query('mktg-faq-view-panel-faq')).not.toBeNull();
  });
});
