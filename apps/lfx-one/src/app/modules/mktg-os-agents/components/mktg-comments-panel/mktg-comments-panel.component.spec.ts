// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES } from '@lfx-one/shared/constants';
import { TestBed } from '@angular/core/testing';
import { mktgCommentFixture, mktgCommentScopeFixture, provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import { describe, expect, it, vi } from 'vitest';
import { MktgCommentsPanelComponent } from './mktg-comments-panel.component';

describe('MktgCommentsPanelComponent', () => {
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
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Loading');
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
    expect(element.textContent).toContain('No comments on this revision');
    threads.set([mktgCommentFixture({ anchor: { kind: 'field', key: 'mf.goals[1].bite' }, text: 'Shorten the sound bite.' })]);
    fixture.detectChanges();
    expect(element.textContent).toContain('Shorten the sound bite.');
    expect(element.textContent).toContain('Sound bite · Goal column 2 · Community');
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
