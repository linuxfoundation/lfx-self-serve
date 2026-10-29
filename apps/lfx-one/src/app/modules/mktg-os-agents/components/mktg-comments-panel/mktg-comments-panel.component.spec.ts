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
