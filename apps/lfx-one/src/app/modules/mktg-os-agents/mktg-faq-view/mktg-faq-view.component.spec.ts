// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { Component, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { MktgFaqAsset, MktgDocumentComment, MktgDocumentCommentScope } from '@lfx-one/shared/interfaces';
import { provideMktgCommentsStub, mktgCommentScopeFixture, mktgCommentFixture } from '@shared/testing/mktg-comments-test-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgFaqViewComponent } from './mktg-faq-view.component';

@Component({
  selector: 'lfx-test-faq-host',
  imports: [MktgFaqViewComponent],
  templateUrl: './mktg-faq-view.test-host.html',
})
class HostComponent {
  public readonly asset = signal<MktgFaqAsset>(ASSET);
  public readonly version = signal<number | null>(3);
  public readonly showMetadata = signal(true);
  public readonly commentsEnabled = signal(false);
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
  let threads = signal<MktgDocumentComment[]>([]);
  let scope = signal<MktgDocumentCommentScope>({ ...mktgCommentScopeFixture(), agentKey: 'faq' });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(async () => {
    threads = signal<MktgDocumentComment[]>([]);
    scope = signal<MktgDocumentCommentScope>({ ...mktgCommentScopeFixture(), agentKey: 'faq' });
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideMktgCommentsStub({
          threads,
          loaded: signal(true),
          selectedScope: scope,
          labelContent: signal(ASSET.content),
        }),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'synthetic' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('opts stored answers and gaps into the same original-index comment anchors, excluding reports', async () => {
    const before = JSON.stringify(ASSET);
    expect(element().querySelector('lfx-mktg-field-comments')).toBeNull();
    expect(text('mktg-faq-view-unanswered-callout')).toBe('1 question needs an answer from your team.');
    host.commentsEnabled.set(true);
    await fixture.whenStable();
    const pins = () => Array.from(element().querySelectorAll('[data-mktg-comment-field]'));
    expect(pins().map((pin) => pin.getAttribute('data-mktg-comment-field'))).toEqual(['faq[0][1][0][1]', 'faq[0][1][1][1]', 'faq[1][1][0][1]']);
    expect(pins()[1].querySelector('button')?.getAttribute('aria-label')).toBe('Answer About TestOrbit · Q2: How much does membership cost? · Answer');
    expect(pins()[0].querySelector('button')?.textContent?.trim()).toBe('Comment');
    expect(pins()[1].querySelector('button')?.textContent?.trim()).toBe('Answer');
    expect(
      Array.from(element().querySelectorAll('[data-testid^="mktg-faq-view-question-"]')).every((row) => row.classList.contains('group/commentfield'))
    ).toBe(true);
    expect(text('mktg-faq-view-unanswered-callout')).toBe(
      '1 question needs an answer from your team. Answer it by commenting on it; the agent adds your answer as Notes.'
    );
    query('mktg-faq-view-tab-unanswered')?.click();
    await fixture.whenStable();
    expect(pins().map((pin) => pin.getAttribute('data-mktg-comment-field'))).toEqual(['faq[0][1][1][1]']);
    expect(pins()[0].closest('li')?.classList.contains('group/commentfield')).toBe(true);
    expect(pins()[0].querySelector('button')?.textContent?.trim()).toBe('Answer');
    query('mktg-faq-view-tab-sources')?.click();
    await fixture.whenStable();
    expect(pins()).toHaveLength(0);
    expect(JSON.stringify(ASSET)).toBe(before);
  });

  it('excludes only server-resolved answer fields from the callout, tab count and unanswered list', async () => {
    host.commentsEnabled.set(true);
    host.asset.set({
      ...ASSET,
      checks: {
        ...ASSET.checks,
        unanswered: [...ASSET.checks.unanswered, { path: 'faq[1][1][0]', group: 'Getting involved', question: 'How do I contribute?' }],
      },
    });
    threads.set([
      mktgCommentFixture({ id: 'resolved-gap', status: 'resolved', anchor: { kind: 'field', key: 'faq[0][1][1][1]' } }),
      mktgCommentFixture({ id: 'sent-gap', status: 'sent', anchor: { kind: 'field', key: 'faq[1][1][0][1]' } }),
      mktgCommentFixture({ id: 'resolved-question-not-answer', status: 'resolved', anchor: { kind: 'field', key: 'faq[1][1][0][0]' } }),
    ]);
    await fixture.whenStable();
    expect(text('mktg-faq-view-tab-unanswered')).toBe('Needs an answer (1)');
    expect(text('mktg-faq-view-unanswered-callout')).toContain('1 question needs an answer');
    query('mktg-faq-view-tab-unanswered')?.click();
    await fixture.whenStable();
    expect(text('mktg-faq-view-unanswered-list')).toContain('How do I contribute?');
    expect(text('mktg-faq-view-unanswered-list')).not.toContain('How much does membership cost?');
    threads.update((current) => [
      ...current,
      mktgCommentFixture({ id: 'resolved-second-gap', status: 'resolved', anchor: { kind: 'field', key: 'faq[1][1][0][1]' } }),
    ]);
    await fixture.whenStable();
    expect(text('mktg-faq-view-tab-unanswered')).toBe('Needs an answer');
    expect(query('mktg-faq-view-unanswered-empty')).not.toBeNull();
    query('mktg-faq-view-tab-faq')?.click();
    await fixture.whenStable();
    expect(query('mktg-faq-view-unanswered-callout')).toBeNull();
    expect(ASSET.checks.unanswered).toHaveLength(1);
  });

  it('does not apply resolved comments from another agent scope or to a non-comment view', async () => {
    threads.set([mktgCommentFixture({ status: 'resolved', anchor: { kind: 'field', key: 'faq[0][1][1][1]' } })]);
    await fixture.whenStable();
    expect(text('mktg-faq-view-tab-unanswered')).toBe('Needs an answer (1)');
    host.commentsEnabled.set(true);
    scope.set({ ...mktgCommentScopeFixture(), agentKey: 'foundation-message' });
    await fixture.whenStable();
    expect(text('mktg-faq-view-tab-unanswered')).toBe('Needs an answer (1)');
  });

  it('loads its URL tab and pushes one history entry per user switch', async () => {
    fixture.destroy();
    await TestBed.inject(Router).navigateByUrl('/?project=synthetic&profile=edit&tab=unanswered');
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(query('mktg-faq-view-tab-unanswered')?.getAttribute('aria-selected')).toBe('true');
    const push = vi.spyOn(TestBed.inject(Location), 'go');
    query('mktg-faq-view-tab-sources')?.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('tab=sources');
    expect(TestBed.inject(Router).url).toContain('profile=edit');
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('focuses the opened panel start only after routed content renders', async () => {
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
    query('mktg-faq-view-tab-faq')?.focus();
    const before = document.activeElement;
    query('mktg-faq-view-tab-sources')?.click();
    await fixture.whenStable();
    expect(query('mktg-faq-view-panel-sources')).toBeNull();
    expect(document.activeElement).toBe(before);
    release();
    await pending.mock.results[0]?.value;
    await fixture.whenStable();
    const panel = query('mktg-faq-view-panel-sources');
    expect(document.activeElement).toBe(panel);
    expect(panel?.getAttribute('tabindex')).toBe('-1');
  });

  it('heads the page with the title, the version, the mode, the size and what needs the team', () => {
    expect(text('mktg-faq-view-title')).toBe('TestOrbit FAQ');
    expect(text('mktg-faq-view-version')).toBe('v3');
    expect(text('mktg-faq-view-approval-state')).toBe('Draft');
    expect(query('mktg-faq-view-mode')).toBeNull();
    expect(text('mktg-faq-view-size')).toBe('3 questions in 2 groups');
    expect(query('mktg-faq-view-unanswered-chip')).toBeNull();
    expect(query('mktg-faq-view-unanswered-open')).toBeNull();
    expect(element().textContent).not.toContain('See them');
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
    query('mktg-faq-view-tab-unanswered')?.click();
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

  it('moves focus to the rendered panel start when its tab opens it', async () => {
    query('mktg-faq-view-tab-unanswered')?.click();
    await fixture.whenStable();
    const panel = query('mktg-faq-view-panel-unanswered');
    expect(document.activeElement).toBe(panel);
  });

  it('says the plural open-question count once and only adds comment guidance for stored documents', async () => {
    host.asset.set({
      ...ASSET,
      checks: { ...ASSET.checks, unanswered: [...ASSET.checks.unanswered, { path: 'faq[1][1][1]', group: 'Getting involved', question: 'Who can join?' }] },
    });
    await fixture.whenStable();
    expect(text('mktg-faq-view-unanswered-callout')).toBe('2 questions need an answer from your team.');
    host.commentsEnabled.set(true);
    await fixture.whenStable();
    expect(text('mktg-faq-view-unanswered-callout')).toBe(
      '2 questions need an answer from your team. Answer them by commenting on them; the agent adds your answers as Notes.'
    );
    expect(query('mktg-faq-view-unanswered-chip')).toBeNull();
    expect(query('mktg-faq-view-unanswered-open')).toBeNull();
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
