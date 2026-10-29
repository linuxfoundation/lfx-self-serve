// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, EMPTY, of, throwError, Observable } from 'rxjs';
import type { MktgRedraftProgress } from '@lfx-one/shared/interfaces';
import { MktgDocumentRedraftClientService } from '@services/mktg-document-redraft-client.service';
import { MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES } from '@lfx-one/shared/constants';
import { TestBed } from '@angular/core/testing';
import { mktgCommentFixture, mktgCommentScopeFixture, provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import { describe, expect, it, vi } from 'vitest';
import { MktgCommentsPanelComponent } from './mktg-comments-panel.component';

describe('MktgCommentsPanelComponent', () => {
  it('renders eight compact two-line rows with separate previews, status chips and no full bodies or resolutions', async () => {
    const threads = signal(
      Array.from({ length: 8 }, (_, index) =>
        mktgCommentFixture({
          id: `comment-${index}`,
          text: `\nPreview ${index}\nLong explanation ${index}`,
          status: 'resolved',
          resolution: 'Agent explanation',
        })
      )
    );
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded: signal(true), threads })] });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', mktgCommentScopeFixture());
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('[data-testid="mktg-comment-thread"]');
    expect(rows).toHaveLength(8);
    for (const [index, row] of Array.from(rows).entries()) {
      const summary = row.querySelector('[data-testid="mktg-comment-summary"]');
      const preview = row.querySelector('[data-testid="mktg-comment-preview"]');
      expect(preview?.previousElementSibling).toBe(summary);
      expect(preview?.classList.contains('w-full')).toBe(true);
      expect(preview?.classList.contains('truncate')).toBe(true);
      expect(preview?.textContent?.trim()).toBe(`Preview ${index}`);
      expect(summary?.textContent).not.toContain(`Preview ${index}`);
      expect(summary?.textContent).toContain('Project writer');
      expect(summary?.textContent).toContain('21 Oct');
      expect(summary?.textContent).toContain('Resolved by the agent');
      expect(row.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    }
    expect(el.querySelector('[data-testid="mktg-comment-body"]')).toBeNull();
    expect(el.querySelector('[data-testid="mktg-comment-resolution"]')).toBeNull();
    expect(el.textContent).not.toContain('Long explanation');
  });

  it('expands only the chosen thread in place and collapses it without replacing the focused button', async () => {
    TestBed.configureTestingModule({
      providers: [provideMktgCommentsStub({ loaded: signal(true), threads: signal([mktgCommentFixture(), mktgCommentFixture({ id: 'second' })]) })],
    });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', mktgCommentScopeFixture());
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rows = Array.from(el.querySelectorAll('[data-testid="mktg-comment-thread"]'));
    const button = rows[0].querySelector('button');
    button?.focus();
    button?.click();
    await fixture.whenStable();
    expect(rows[0].querySelector('[data-testid="mktg-comment-body"]')).not.toBeNull();
    expect(rows[1].querySelector('[data-testid="mktg-comment-body"]')).toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(rows[0].querySelector('button')).toBe(button);
    expect(fixture.nativeElement.ownerDocument.activeElement).toBe(button);
    button?.click();
    await fixture.whenStable();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(rows[0].querySelector('[data-testid="mktg-comment-body"]')).toBeNull();
    expect(fixture.nativeElement.ownerDocument.activeElement).toBe(button);
  });

  it('keeps expansion and row identity across same-scope refreshes, new snapshots and label-content changes', async () => {
    const scope = mktgCommentScopeFixture();
    const selectedScope = signal<typeof scope | null>(null);
    const threads = signal([mktgCommentFixture({ text: 'Preview\nOriginal details' })]);
    const loading = signal(false);
    const loadError = signal('');
    const refresh = vi.fn(() => {
      loading.set(true);
      loadError.set('');
    });
    TestBed.configureTestingModule({
      providers: [
        provideMktgCommentsStub({ loaded: signal(true), loading, loadError, threads, selectedScope, select: (next) => selectedScope.set(next), refresh }),
      ],
    });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const row = el.querySelector('[data-testid="mktg-comment-thread"]');
    const button = row?.querySelector('button');
    button?.click();
    await fixture.whenStable();
    loadError.set('Synthetic refresh failure');
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-testid="mktg-comments-retry"] button')?.click();
    await fixture.whenStable();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="mktg-comments-loading"]')).toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    threads.set([mktgCommentFixture({ text: 'Preview\nUpdated details', status: 'resolved', resolution: 'Agent explanation' })]);
    loading.set(false);
    fixture.componentRef.setInput('scope', { ...scope });
    fixture.componentRef.setInput('content', { synthetic: 'new labels' });
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="mktg-comment-thread"]')).toBe(row);
    expect(row?.querySelector('button')).toBe(button);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(row?.querySelector('[data-testid="mktg-comment-body"]')?.textContent).toContain('Updated details');
    expect(row?.querySelector('[data-testid="mktg-comment-resolution"]')?.textContent).toBe('Agent explanation');
    // The panel, not the child instance, owns disclosure when a re-read replaces the list.
    const snapshot = threads();
    threads.set([]);
    await fixture.whenStable();
    threads.set(snapshot);
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="mktg-comment-toggle"] button')?.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[data-testid="mktg-comment-body"]')?.textContent).toContain('Updated details');
  });

  it.each(['documentId', 'revisionId'] as const)('clears expansion on %s navigation even when the new list reuses a thread id', async (key) => {
    const scope = mktgCommentScopeFixture();
    const selectedScope = signal<typeof scope | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideMktgCommentsStub({ loaded: signal(true), threads: signal([mktgCommentFixture()]), selectedScope, select: (next) => selectedScope.set(next) }),
      ],
    });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-testid="mktg-comment-toggle"] button')?.click();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="mktg-comment-body"]')).not.toBeNull();
    fixture.componentRef.setInput('scope', { ...scope, [key]: key === 'documentId' ? 'another-document' : `000002-${'b'.repeat(64)}` });
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="mktg-comment-toggle"] button')?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[data-testid="mktg-comment-body"]')).toBeNull();
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="mktg-comment-body"]')).toBeNull();
  });

  it('sends only measured open comments, shows feed, retries the same intent and reports release409 without resubmission', async () => {
    const loaded = signal(false);
    const threads = signal([mktgCommentFixture()]);
    const stream = new Subject<MktgRedraftProgress>();
    let pending = false;
    const runner = {
      hasIntent: () => pending,
      hasAcceptedAttempt: () => false,
      canRelease: () => pending,
      resume: () => EMPTY,
      send: vi.fn(() => stream),
      release: vi.fn<() => Observable<void>>(() => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MKTG_REDRAFT_COMMENTS_BUSY' } }))),
    };
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded, threads })] });
    TestBed.overrideProvider(MktgDocumentRedraftClientService, { useValue: runner });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    const scope = mktgCommentScopeFixture();
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('priorVersion', 1);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const send = () => el.querySelector<HTMLButtonElement>('[data-testid="mktg-comments-send"] button');
    expect(send()).toBeNull();
    expect(el.querySelector('[data-testid="mktg-comments-disabled-reason"]')).toBeNull();
    const live = el.querySelector('[data-testid="mktg-comments-run-message"]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('');
    loaded.set(true);
    threads.set([]);
    fixture.detectChanges();
    expect(send()).toBeNull();
    expect(el.querySelector('[data-testid="mktg-comments-disabled-reason"]')).toBeNull();
    threads.set([mktgCommentFixture({ status: 'resolved' })]);
    fixture.detectChanges();
    expect(send()).toBeNull();
    threads.set([mktgCommentFixture()]);
    fixture.detectChanges();
    expect(send()?.textContent).toContain('Send 1 open comment to the agent');
    expect(send()?.disabled).toBe(false);
    send()?.click();
    fixture.detectChanges();
    expect(runner.send).toHaveBeenCalledWith(scope, 1);
    expect(send()?.disabled).toBe(true);
    expect(el.querySelector('[data-testid="mktg-comments-feed"]')).toBeNull();
    stream.next({
      type: 'submitted',
      attempt: { session: { agentId: 'synthetic-agent', sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' }, priorVersion: 1 },
    });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="mktg-comments-feed"]')).not.toBeNull();
    stream.next({ type: 'activity', activity: [] });
    threads.set([mktgCommentFixture({ status: 'sent' })]);
    fixture.detectChanges();
    expect(send()).not.toBeNull();
    pending = true;
    stream.error(new HttpErrorResponse({ status: 503, error: { code: 'MKTG_REDRAFT_START_UNCERTAIN' } }));
    fixture.detectChanges();
    expect(send()?.textContent).toContain('Retry the same redraft');
    expect(el.textContent).toContain('Try the same send again');
    expect(el.textContent).toContain('hold expires');
    el.querySelector<HTMLButtonElement>('[data-testid="mktg-comments-release"] button')?.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Still starting — retry shortly');
    expect(el.querySelector('[data-testid="mktg-comments-run-message"]')).toBe(live);
    expect(runner.send).toHaveBeenCalledTimes(1);
    runner.release.mockReturnValue(of(undefined));
    pending = false;
    el.querySelector<HTMLButtonElement>('[data-testid="mktg-comments-release"] button')?.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Send released');
  });

  it.each([
    ['foundation-message', 30],
    ['brand-kit', 30],
    ['boilerplates', 20],
  ] as const)('explains every disabled Send state and %s cap without showing an unknown count', async (agentKey, cap) => {
    const loaded = signal(false);
    const loadError = signal('');
    const rows = signal([mktgCommentFixture()]);
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded, loadError, threads: rows })] });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', { ...mktgCommentScopeFixture(), agentKey });
    fixture.componentRef.setInput('priorVersion', 1);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const send = () => el.querySelector<HTMLButtonElement>('[data-testid="mktg-comments-send"] button');
    const reason = () => el.querySelector('[data-testid="mktg-comments-disabled-reason"]');
    expect(send()).toBeNull();
    expect(reason()).toBeNull();
    loadError.set('Synthetic failure');
    loaded.set(true);
    await fixture.whenStable();
    expect(send()).toBeNull();
    expect(reason()).toBeNull();
    loadError.set('');
    rows.set([]);
    await fixture.whenStable();
    expect(send()).toBeNull();
    expect(reason()).toBeNull();
    rows.set(Array.from({ length: cap + 1 }, (_, index) => mktgCommentFixture({ id: `comment-${index}` })));
    await fixture.whenStable();
    expect(reason()?.textContent?.trim()).toBe(`This agent takes up to ${cap} comments per send — resolve or remove some`);
    expect(send()?.disabled).toBe(true);
    rows.set([mktgCommentFixture()]);
    fixture.componentRef.setInput('priorVersion', null);
    await fixture.whenStable();
    expect(reason()?.textContent?.trim()).toBe('This revision has no stored source to redraft');
    fixture.componentRef.setInput('priorVersion', 1);
    await fixture.whenStable();
    expect(send()?.textContent).toContain('Send 1 open comment to the agent');
    expect(send()?.disabled).toBe(false);
    expect(send()?.hasAttribute('aria-describedby')).toBe(false);
  });

  it.each(['receipt budget', 'poll timeout'])('offers re-observe Retry, not Release, after an accepted %s', async (failure) => {
    const stream = new Subject<MktgRedraftProgress>();
    let accepted = false;
    const runner = {
      hasIntent: () => accepted,
      hasAcceptedAttempt: () => accepted,
      canRelease: () => false,
      resume: vi.fn(() => stream),
      send: vi.fn(() => stream),
      release: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded: signal(true), threads: signal([mktgCommentFixture()]) })] });
    TestBed.overrideProvider(MktgDocumentRedraftClientService, { useValue: runner });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', mktgCommentScopeFixture());
    fixture.componentRef.setInput('priorVersion', 1);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-testid="mktg-comments-send"] button')?.click();
    accepted = true;
    stream.next({ type: 'storing' });
    if (failure === 'poll timeout') stream.error(new Error('Synthetic timeout'));
    else stream.complete();
    await fixture.whenStable();
    expect(el.textContent).toContain('The agent is still working on this redraft');
    expect(el.textContent).toContain('Retry checks the same run');
    expect(el.querySelector('[data-testid="mktg-comments-release"]')).toBeNull();
    expect(el.querySelector('[data-testid="mktg-comments-send"]')?.textContent).toContain('Retry the same redraft');
    expect(runner.release).not.toHaveBeenCalled();
  });

  it('freezes the selected pinned chapter for landing even if comments change while the agent works', async () => {
    const rows = signal([mktgCommentFixture({ anchor: { kind: 'passage', key: 'chapters.voice.line' } })]);
    const stream = new Subject<MktgRedraftProgress>();
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded: signal(true), threads: rows })] });
    TestBed.overrideProvider(MktgDocumentRedraftClientService, {
      useValue: { hasIntent: () => false, hasAcceptedAttempt: () => false, canRelease: () => false, resume: () => EMPTY, send: () => stream },
    });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', { ...mktgCommentScopeFixture(), agentKey: 'brand-kit' });
    fixture.componentRef.setInput('priorVersion', 1);
    const ready = vi.fn();
    fixture.componentInstance.ready.subscribe(ready);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="mktg-comments-send"] button')?.click();
    rows.set([mktgCommentFixture({ anchor: { kind: 'passage', key: 'chapters.color.summary' } })]);
    const location = { agentKey: 'brand-kit' as const, documentId: 'living', revisionId: `000002-${'b'.repeat(64)}` };
    stream.next({ type: 'ready', location });
    expect(ready).toHaveBeenCalledExactlyOnceWith({ ...location, tab: 'voice' });
    stream.complete();
  });

  it('gives concurrent panels distinct declaratively-bound description idrefs without DOM effects', async () => {
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded: signal(true), threads: signal([mktgCommentFixture()]) })] });
    const first = TestBed.createComponent(MktgCommentsPanelComponent);
    const second = TestBed.createComponent(MktgCommentsPanelComponent);
    for (const fixture of [first, second]) fixture.componentRef.setInput('scope', mktgCommentScopeFixture());
    await first.whenStable();
    await second.whenStable();
    const ids = [first, second].map((fixture) => {
      const el = fixture.nativeElement as HTMLElement;
      const id = el.querySelector('[data-testid="mktg-comments-disabled-reason"]')?.id;
      expect(id).toBeTruthy();
      expect(el.querySelector('[data-testid="mktg-comments-send"] button')?.getAttribute('aria-describedby')).toBe(id);
      return id;
    });
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('selects the exact revision, tracks input changes, and clears on departure without posting', async () => {
    const select = vi.fn();
    const add = vi.fn();
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ select, add })] });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    const scope = mktgCommentScopeFixture();
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
    expect(select).toHaveBeenLastCalledWith(scope);
    const next = { ...scope, revisionId: `000002-${'b'.repeat(64)}` };
    fixture.componentRef.setInput('scope', next);
    await fixture.whenStable();
    expect(select).toHaveBeenLastCalledWith(next);
    fixture.destroy();
    expect(select).toHaveBeenLastCalledWith(null);
    expect(add).not.toHaveBeenCalled();
  });
  it('keeps the settled heading and thread nodes through two same-scope refreshes, reserving skeletons for the first read', async () => {
    const loading = signal(true);
    const loaded = signal(false);
    const threads = signal([mktgCommentFixture({ id: 'synthetic-first' }), mktgCommentFixture({ id: 'synthetic-second' })]);
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loading, loaded, threads })] });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', mktgCommentScopeFixture());
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="mktg-comments-loading"]')?.querySelectorAll('[data-testid="mktg-skeleton-row"]')).toHaveLength(2);
    expect(element.querySelector('h2')).toBeNull();
    expect(element.querySelectorAll('[data-testid="mktg-comment-thread"]')).toHaveLength(0);
    loaded.set(true);
    loading.set(false);
    await fixture.whenStable();
    const heading = element.querySelector('h2');
    const list = () => Array.from(element.querySelectorAll('[data-testid="mktg-comment-thread"]'));
    const nodes = list();
    expect(heading?.textContent).toBe('Comments');
    expect(nodes).toHaveLength(2);
    for (let cycle = 0; cycle < 2; cycle++) {
      loading.set(true);
      await fixture.whenStable();
      expect(element.querySelector('[data-testid="mktg-comments-loading"]')).toBeNull();
      expect(element.querySelector('h2')).toBe(heading);
      list().forEach((node, index) => expect(node).toBe(nodes[index]));
      expect(list()).toHaveLength(2);
      threads.update((rows) => rows.map((row) => ({ ...row })));
      loading.set(false);
      await fixture.whenStable();
      expect(element.querySelector('[data-testid="mktg-comments-loading"]')).toBeNull();
      expect(element.querySelector('h2')).toBe(heading);
      list().forEach((node, index) => expect(node).toBe(nodes[index]));
      expect(list()).toHaveLength(2);
    }
  });

  it('distinguishes loading, failure, measured empty and loaded threads, and retries only reads', async () => {
    const loading = signal(true);
    const loaded = signal(false);
    const loadError = signal('');
    const saveError = signal('');
    const threads = signal([mktgCommentFixture()]);
    const refresh = vi.fn();
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loading, loaded, loadError, saveError, threads, refresh })] });
    const fixture = TestBed.createComponent(MktgCommentsPanelComponent);
    fixture.componentRef.setInput('scope', mktgCommentScopeFixture());
    fixture.componentRef.setInput('content', { mf: { goals: [{ t: 'Adoption' }, { t: 'Community' }] } });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const card = element.querySelector('[data-testid="mktg-comments-panel"]');
    expect(card?.className).not.toContain('h-96');
    expect(element.querySelector('[data-testid="mktg-comments-loading"]')?.querySelectorAll('[data-testid="mktg-skeleton-row"]')).toHaveLength(2);
    expect(element.querySelector('[data-testid="mktg-comments-empty"]')).toBeNull();
    loading.set(false);
    loadError.set('Writer access required.');
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Writer access required.');
    element.querySelector('button')?.click();
    expect(refresh).toHaveBeenCalledTimes(1);
    loadError.set('');
    loaded.set(true);
    threads.set([]);
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="mktg-comments-empty"]')?.textContent).toBe(
      'No comments yet. To ask for a change, hover a field and choose Comment.'
    );
    threads.set([mktgCommentFixture({ anchor: { kind: 'field', key: 'mf.goals[1].bite' }, text: 'Shorten the sound bite.' })]);
    fixture.detectChanges();
    expect(element.textContent).toContain('Shorten the sound bite.');
    expect(element.textContent).toContain('Sound bite · Goal column 2 · Community');
    expect(element.querySelector('[data-testid="mktg-comments-panel"]')).toBe(card);
    expect(card?.className).not.toContain('h-96');
    expect(card?.classList.contains('overflow-y-auto')).toBe(false);
    saveError.set('Comment could not be saved.');
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    loaded.set(false);
    loadError.set(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.access);
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('write access');
    expect(element.querySelector('[data-testid="mktg-comments-retry"]')).not.toBeNull();
    expect(element.querySelector('textarea')).toBeNull();
  });
});
