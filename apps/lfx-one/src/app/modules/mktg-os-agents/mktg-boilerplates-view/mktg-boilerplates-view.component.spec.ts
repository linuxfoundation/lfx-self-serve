// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { MktgBoilerplatesAsset } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MktgBoilerplatesViewComponent } from './mktg-boilerplates-view.component';

const ASSET: MktgBoilerplatesAsset = {
  kind: 'boilerplates',
  mode: 'draft',
  content: {
    bp: [
      { l: 'One-liner', max: 15, t: 'TestOrbit is the open release toolkit.' },
      { l: '25 words', max: 25, t: 'TestOrbit, a Linux Foundation project, is the open release toolkit that 40 companies use.' },
      { l: '50 words', max: 50, t: 'TestOrbit, a Linux Foundation project, is the open release toolkit for platform teams.' },
      { l: '100 words', max: 100, t: 'TestOrbit, a Linux Foundation project, is the open release toolkit. Learn more at testorbit.example.org.' },
    ],
  },
  report: {
    sources_read: ['https://testorbit.example.org'],
    sources_failed: [{ name: 'https://testorbit.example.org/members', reason: 'Not found' }],
    gaps: ['The launch year is not stated.'],
    notes: '',
  },
  checks: { word_counts: [6, 15, 14, 15], findings: [] },
};

describe('MktgBoilerplatesViewComponent', () => {
  let fixture: ComponentFixture<MktgBoilerplatesViewComponent>;
  let messageService: { add: ReturnType<typeof vi.fn> };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);

  const render = async (asset: MktgBoilerplatesAsset = ASSET, platformId: 'browser' | 'server' = 'browser', url = '/'): Promise<void> => {
    messageService = { add: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [MktgBoilerplatesViewComponent],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'synthetic' }) } },
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: MessageService, useValue: messageService },
      ],
    }).compileComponents();
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(MktgBoilerplatesViewComponent);
    fixture.componentRef.setInput('projectName', 'TestOrbit');
    fixture.componentRef.setInput('asset', asset);
    fixture.componentRef.setInput('version', 2);
    await fixture.whenStable();
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads its URL tab and pushes one history entry per user switch', async () => {
    await render(ASSET, 'browser', '/?project=synthetic&profile=edit&tab=sources');
    expect(query('mktg-boilerplates-view-tab-sources')?.getAttribute('aria-selected')).toBe('true');
    const push = vi.spyOn(TestBed.inject(Location), 'go');
    query('mktg-boilerplates-view-tab-boilerplates')?.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).not.toContain('tab=');
    expect(TestBed.inject(Router).url).toContain('profile=edit');
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it.each(['tab', 'shortcut'])('focuses the opened panel after delayed navigation from a %s', async (action) => {
    await render({ ...ASSET, mode: 'check', checks: { ...ASSET.checks, findings: ['Review the synthetic draft.'] } });
    const router = TestBed.inject(Router);
    const navigate = router.navigate.bind(router);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = vi.spyOn(router, 'navigate').mockImplementationOnce(async (...args) => {
      await gate;
      return navigate(...args);
    });
    query('mktg-boilerplates-view-tab-boilerplates')?.focus();
    const before = document.activeElement;
    query(action === 'tab' ? 'mktg-boilerplates-view-tab-sources' : 'mktg-boilerplates-view-reviewer-sources')?.click();
    await fixture.whenStable();
    expect(query('mktg-boilerplates-view-panel-sources')).toBeNull();
    expect(document.activeElement).toBe(before);
    release();
    await pending.mock.results[0]?.value;
    await fixture.whenStable();
    const panel = query('mktg-boilerplates-view-panel-sources');
    expect(document.activeElement).toBe(panel);
    expect(panel?.getAttribute('tabindex')).toBe('-1');
  });

  it('heads the page with the project’s boilerplates, the version and how it was made', async () => {
    await render();

    expect(query('mktg-boilerplates-view-title')?.textContent).toContain('TestOrbit Boilerplates');
    expect(query('mktg-boilerplates-view-version')?.textContent).toContain('v2');
    expect(query('mktg-boilerplates-view-meta')?.textContent).toContain('v2');
    expect(query('mktg-boilerplates-view-approval-state')?.textContent?.trim()).toBe('Draft');
    expect(query('mktg-boilerplates-view-mode')).toBeNull();
  });

  it('shows approval metadata without changing the native tabs or counts', async () => {
    await render();
    fixture.componentRef.setInput('approval', { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: null } });
    await fixture.whenStable();
    expect(query('mktg-boilerplates-view-approval-state')?.textContent?.trim()).toBe('Approved');
    expect(query('mktg-boilerplates-view-mode')).toBeNull();
    expect(query('mktg-boilerplates-view-tabs')).not.toBeNull();
    expect(query('mktg-boilerplates-view-count-0')?.textContent).toContain('6 / 15 words');
  });

  it('shows the four lengths in order, each with its word count against its limit and what it carries', async () => {
    await render();

    const labels = [0, 1, 2, 3].map((index) => query(`mktg-boilerplates-view-length-${index}`)?.querySelector('h3')?.textContent?.trim());
    expect(labels).toEqual(['One-liner', '25 words', '50 words', '100 words']);
    expect(query('mktg-boilerplates-view-text-3')?.textContent).toContain('Learn more at testorbit.example.org.');
    expect(query('mktg-boilerplates-view-count-0')?.textContent).toContain('6 / 15 words');
    expect(query('mktg-boilerplates-view-count-0')?.className).toContain('emerald');
    expect(query('mktg-boilerplates-view-length-1')?.textContent).toContain('a Linux Foundation project');
    // Nothing to check on a clean draft: no reviewer card.
    expect(query('mktg-boilerplates-view-reviewer')).toBeNull();
  });

  it('flags a length over its limit, and puts the findings and notes in front of the reviewer', async () => {
    await render({
      ...ASSET,
      mode: 'check',
      checks: { word_counts: [17, 15, 14, 15], findings: ['One-liner: 17 words, over its 15.'] },
      report: { ...ASSET.report, notes: 'Check: One-liner: 17 words, over its 15.' },
    });

    expect(query('mktg-boilerplates-view-count-0')?.className).toContain('amber');
    expect(query('mktg-boilerplates-view-count-0')?.textContent).toContain('over the limit');
    expect(query('mktg-boilerplates-view-mode')?.textContent).toContain('Checked');
    expect(query('mktg-boilerplates-view-findings')?.textContent).toContain('One-liner: 17 words, over its 15.');
    expect(query('mktg-boilerplates-view-notes')?.textContent).toContain('Check: One-liner');

    query('mktg-boilerplates-view-reviewer-sources')?.click();
    await fixture.whenStable();
    expect(query('mktg-boilerplates-view-panel-sources')).not.toBeNull();
  });

  it('opens the sources and gaps on their own tab, with the count of what needs a look', async () => {
    await render();

    expect(query('mktg-boilerplates-view-gap-count')?.textContent).toContain('2');
    query('mktg-boilerplates-view-tab-sources')?.click();
    await fixture.whenStable();

    expect(query('mktg-boilerplates-view-panel-boilerplates')).toBeNull();
    expect(query('mktg-boilerplates-view-sources-read')?.textContent).toContain('https://testorbit.example.org');
    expect(query('mktg-boilerplates-view-sources-failed')?.textContent).toContain('Not found');
    expect(query('mktg-boilerplates-view-gaps')?.textContent).toContain('The launch year is not stated.');
    expect(query('mktg-boilerplates-view-checks-empty')).not.toBeNull();
  });

  it('moves along the tabs with the arrow keys, Home and End', async () => {
    await render();
    const tablist = query('mktg-boilerplates-view-tabs') as HTMLElement;

    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(query('mktg-boilerplates-view-tab-sources')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(query('mktg-boilerplates-view-tab-sources'));

    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await fixture.whenStable();
    expect(query('mktg-boilerplates-view-tab-boilerplates')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(query('mktg-boilerplates-view-tab-boilerplates'));
  });

  it('copies a length’s text and says so for a moment', async () => {
    await render();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.useFakeTimers();

    query('mktg-boilerplates-view-copy-2')?.querySelector('button')?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(ASSET.content.bp[2].t));
    await Promise.resolve();
    fixture.detectChanges();
    expect(query('mktg-boilerplates-view-copy-2')?.textContent).toContain('Copied');
    expect(host().querySelector('[role="status"]')?.textContent).toContain('50 words boilerplate copied to the clipboard');

    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(query('mktg-boilerplates-view-copy-2')?.textContent).toContain('Copy');
    expect(query('mktg-boilerplates-view-copy-2')?.textContent).not.toContain('Copied');
  });

  it('says a copy failed instead of looking like it worked', async () => {
    await render();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

    query('mktg-boilerplates-view-copy-0')?.querySelector('button')?.click();
    await vi.waitFor(() => expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Copy failed' })));
    expect(query('mktg-boilerplates-view-copy-0')?.textContent).not.toContain('Copied');
  });

  it('never touches the clipboard on the server', async () => {
    await render(ASSET, 'server');
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    query('mktg-boilerplates-view-copy-0')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(writeText).not.toHaveBeenCalled();
  });
});
