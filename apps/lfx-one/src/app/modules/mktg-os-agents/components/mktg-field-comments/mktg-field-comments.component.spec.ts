// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { mktgCommentFixture, mktgCommentScopeFixture, provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import type { MktgDocumentCommentsResponse } from '@lfx-one/shared/interfaces';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgFieldCommentsComponent } from './mktg-field-comments.component';

describe('MktgFieldCommentsComponent', () => {
  let fixture: ComponentFixture<MktgFieldCommentsComponent>;
  const scope = signal(mktgCommentScopeFixture());
  const subject = signal('opaque-viewer');
  const threads = signal([mktgCommentFixture()]);
  const loaded = signal(true);
  let add: ReturnType<typeof vi.fn>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function click(id: string): void {
    const button = element().querySelector<HTMLButtonElement>(`[data-testid="${id}"] button`);
    if (!button) throw new Error(`Missing synthetic button ${id}`);
    button.click();
    fixture.detectChanges();
    TestBed.tick();
  }
  function fill(text: string): void {
    const control = element().querySelector('textarea');
    if (!control) throw new Error('Missing synthetic composer');
    control.value = text;
    control.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  async function mount(): Promise<void> {
    fixture = TestBed.createComponent(MktgFieldCommentsComponent);
    fixture.componentRef.setInput('field', 'mf.positioning');
    await fixture.whenStable();
    fixture.detectChanges();
  }
  beforeEach(async () => {
    scope.set(mktgCommentScopeFixture());
    subject.set('opaque-viewer');
    threads.set([mktgCommentFixture()]);
    loaded.set(true);
    add = vi.fn(() => of({ revisionId: scope().revisionId, threads: threads() }));
    TestBed.configureTestingModule({
      providers: [provideMktgCommentsStub({ selectedScope: scope, draftScopeKey: computed(() => JSON.stringify([subject(), scope()])), threads, loaded, add })],
    });
    await mount();
  });
  it('pins only matching threads and pairs the keyboard-reachable Comment button and composer label', () => {
    expect(element().getAttribute('data-mktg-comment-field')).toBe('mf.positioning');
    expect(element().getAttribute('data-testid')).toBe('mktg-field-comments-mf.positioning');
    const count = element().querySelector('[data-testid="mktg-field-comment-count"]');
    expect(element().textContent).toContain('Shorten the positioning.');
    expect(element().querySelector('button')?.getAttribute('aria-label')).toBe('Comment on Positioning');
    click('mktg-field-comment-open');
    const textarea = element().querySelector('textarea');
    expect(element().querySelector('label')?.htmlFor).toBe(textarea?.id);
    expect(textarea?.maxLength).toBe(4000);
    const button = element().querySelector('button');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(button?.getAttribute('aria-controls')).toBe(element().querySelector('[data-testid="mktg-field-comment-composer"]')?.id);
    threads.set([mktgCommentFixture({ anchor: { kind: 'field', key: 'mf.tagline' } })]);
    fixture.detectChanges();
    expect(element().textContent).not.toContain('Shorten the positioning.');
    expect(element().querySelector('[data-testid="mktg-field-comment-count"]')).toBe(count);
    expect(count?.classList.contains('invisible')).toBe(true);
    click('mktg-field-comment-cancel');
    expect(document.activeElement).toBe(button);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.hasAttribute('aria-controls')).toBe(false);
  });
  it('keeps failed/pending drafts across tab hosts and never resets newer edits on ACK', async () => {
    add.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    click('mktg-field-comment-open');
    fill('Make it one clause.');
    click('mktg-field-comment-add');
    expect(element().querySelector('textarea')?.value).toBe('Make it one clause.');
    expect(element().querySelector('[role="alert"]')).not.toBeNull();
    const id = add.mock.calls[0][2];
    fixture.destroy();
    await mount();
    const pending = new Subject<MktgDocumentCommentsResponse>();
    add.mockReturnValue(pending);
    click('mktg-field-comment-add');
    expect(add.mock.calls[1]).toEqual([{ kind: 'field', key: 'mf.positioning' }, 'Make it one clause.', id]);
    fixture.destroy();
    await mount();
    expect(pending.observed).toBe(true);
    expect(element().querySelector('textarea')?.value).toBe('Make it one clause.');
    fill('Typed while the save was pending.');
    pending.next({ revisionId: scope().revisionId, threads: threads() });
    pending.complete();
    fixture.detectChanges();
    expect(element().querySelector('textarea')?.value).toBe('Typed while the save was pending.');
    add.mockReturnValue(of({ revisionId: scope().revisionId, threads: threads() }));
    click('mktg-field-comment-add');
    expect(add.mock.calls[2][2]).not.toBe(id);
    expect(element().querySelector('textarea')).toBeNull();
    expect(element().querySelector('[role="status"]')?.textContent).toBe('Comment added');
    expect(document.activeElement).toBe(element().querySelector('button'));
  });
  it('submits a Brand Kit passage key without trusting or copying browser-rendered passage bytes', async () => {
    scope.set({ ...scope(), agentKey: 'brand-kit' });
    fixture.componentRef.setInput('field', 'chapters.voice.line');
    await fixture.whenStable();
    click('mktg-field-comment-open');
    fill('Make this line shorter.');
    click('mktg-field-comment-add');
    expect(add).toHaveBeenCalledExactlyOnceWith({ kind: 'passage', key: 'chapters.voice.line' }, 'Make this line shorter.', expect.any(String));
  });

  it('does not send blank or oversized text and creates a new request ID if failed text changes', () => {
    click('mktg-field-comment-open');
    fill('   ');
    click('mktg-field-comment-add');
    fill('x'.repeat(4001));
    click('mktg-field-comment-add');
    expect(add).not.toHaveBeenCalled();
    add.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fill('First');
    click('mktg-field-comment-add');
    fill('Changed');
    click('mktg-field-comment-add');
    expect(add.mock.calls[0][2]).not.toBe(add.mock.calls[1][2]);
  });
  it('never submits or creates a browser request ID during server rendering', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideMktgCommentsStub({ loaded, add }), { provide: PLATFORM_ID, useValue: 'server' }] });
    fixture = TestBed.createComponent(MktgFieldCommentsComponent);
    fixture.componentRef.setInput('field', 'mf.positioning');
    await fixture.whenStable();
    fixture.detectChanges();
    click('mktg-field-comment-open');
    fill('SSR must not write');
    click('mktg-field-comment-add');
    expect(add).not.toHaveBeenCalled();
  });

  it('clears a draft on revision navigation, but not an equal-scope refresh; hides affordances without measured access', async () => {
    click('mktg-field-comment-open');
    fill('Draft text');
    scope.set({ ...scope() });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element().querySelector('textarea')?.value).toBe('Draft text');
    scope.set({ ...scope(), revisionId: `000002-${'b'.repeat(64)}` });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element().querySelector('textarea')).toBeNull();
    loaded.set(false);
    fixture.detectChanges();
    expect(element().querySelector('button')).toBeNull();
    expect(element().classList.contains('hidden')).toBe(true);
    loaded.set(true);
    fixture.detectChanges();
    click('mktg-field-comment-open');
    fill('Private draft');
    subject.set('other-opaque-viewer');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element().querySelector('textarea')).toBeNull();
  });
});
