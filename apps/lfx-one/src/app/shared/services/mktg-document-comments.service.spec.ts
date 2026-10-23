// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES } from '@lfx-one/shared/constants';
import type { MktgDocumentComment, MktgDocumentCommentScope } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { ProjectContextService } from './project-context.service';
import { UserService } from './user.service';

const SCOPE: MktgDocumentCommentScope = {
  projectUid: 'project-one',
  agentKey: 'foundation-message',
  documentId: 'living',
  revisionId: `000001-${'a'.repeat(64)}`,
};
const NEXT = `000002-${'b'.repeat(64)}`;
const PATH = '/api/mktg-agents/documents/foundation-message/living/comments';
function thread(id = 'comment-one'): MktgDocumentComment {
  return {
    id,
    anchor: { kind: 'field', key: 'mf.tagline' },
    revisionId: SCOPE.revisionId,
    author: { name: 'Project writer' },
    text: 'Shorten this synthetic line.',
    createdAt: '2026-10-21T10:00:00Z',
    status: 'open',
    sentInRun: null,
    resultRevisionId: null,
    resolution: null,
  };
}

describe('MktgDocumentCommentsService', () => {
  const user = signal<{ sub: string } | null>({ sub: 'opaque-user-one' });
  const project = signal('project-one');
  let service: MktgDocumentCommentsService;
  let http: HttpTestingController;
  let consoleError: ReturnType<typeof vi.spyOn>;
  function setup(platform = 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UserService, useValue: { user: user.asReadonly() } },
        { provide: ProjectContextService, useValue: { activeContextUid: project.asReadonly() } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    service = TestBed.inject(MktgDocumentCommentsService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  }
  function finishRead(threads: MktgDocumentComment[] = []): void {
    http.expectOne((request) => request.url === PATH && request.method === 'GET').flush({ revisionId: SCOPE.revisionId, threads });
  }
  beforeEach(() => {
    user.set({ sub: 'opaque-user-one' });
    project.set('project-one');
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup();
  });
  afterEach(() => {
    http.verify();
    consoleError.mockRestore();
  });

  it('does not fetch until a view selects a revision; selection GETs exactly once with scoped query parameters', () => {
    http.expectNone(() => true);
    service.select(SCOPE);
    TestBed.tick();
    const request = http.expectOne((candidate) => candidate.url === PATH);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('project')).toBe('project-one');
    expect(request.request.params.get('revision')).toBe(SCOPE.revisionId);
    expect(service.loading()).toBe(true);
    expect(service.loaded()).toBe(false);
    request.flush({ revisionId: SCOPE.revisionId, threads: [] });
    expect(service.loading()).toBe(false);
    expect(service.loaded()).toBe(true);
    expect(service.threads()).toEqual([]);
  });

  it('shows the authoritative list without writing when a stored view is reopened', () => {
    service.select(SCOPE);
    finishRead([thread()]);
    expect(service.threads()).toEqual([thread()]);
    service.select({ ...SCOPE });
    TestBed.tick();
    http.expectNone(() => true);
    service.select(null);
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    service.select(SCOPE);
    finishRead([thread()]);
    http.expectNone((request) => request.method === 'POST');
  });

  it('cancels an old revision GET and clears its state before fetching another revision', () => {
    service.select(SCOPE);
    const old = http.expectOne((request) => request.method === 'GET');
    service.select({ ...SCOPE, revisionId: NEXT });
    expect(old.cancelled).toBe(true);
    expect(service.threads()).toEqual([]);
    const current = http.expectOne((request) => request.params.get('revision') === NEXT);
    current.flush({ revisionId: NEXT, threads: [{ ...thread('next'), revisionId: NEXT }] });
    expect(service.threads()[0].id).toBe('next');
  });

  it('hides the previous subject immediately and reloads only under the new effective subject', () => {
    service.select(SCOPE);
    finishRead([thread()]);
    const previousKey = service.draftScopeKey();
    user.set({ sub: 'opaque-user-two' });
    expect(service.draftScopeKey()).not.toBe(previousKey);
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    TestBed.tick();
    finishRead([]);
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(true);
  });

  it('clears comments and cancels reads when the project changes, without querying a mismatched project', () => {
    service.select(SCOPE);
    const old = http.expectOne((request) => request.method === 'GET');
    project.set('project-two');
    TestBed.tick();
    expect(old.cancelled).toBe(true);
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    http.expectNone(() => true);
    service.select({ ...SCOPE, projectUid: 'project-two' });
    const request = http.expectOne((candidate) => candidate.params.get('project') === 'project-two');
    request.flush({ revisionId: SCOPE.revisionId, threads: [] });
  });

  it('sends a one-shot scoped POST with the caller request ID but no author, time, passage or JSON', () => {
    service.select(SCOPE);
    finishRead();
    const next = vi.fn();
    service.add({ kind: 'field', key: 'mf.tagline' }, 'Shorten it.', 'stable-request').subscribe(next);
    expect(service.saving()).toBe(true);
    const request = http.expectOne(PATH);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      project: 'project-one',
      revisionId: SCOPE.revisionId,
      anchor: { kind: 'field', key: 'mf.tagline' },
      text: 'Shorten it.',
      clientRequestId: 'stable-request',
    });
    request.flush({ revisionId: SCOPE.revisionId, threads: [thread()] });
    expect(next).toHaveBeenCalledTimes(1);
    expect(service.saving()).toBe(false);
    expect(service.threads()).toEqual([thread()]);
    http.expectNone(() => true);
  });

  it('does not let a pre-save GET overwrite the acknowledged POST snapshot', () => {
    service.select(SCOPE);
    const oldRead = http.expectOne((request) => request.method === 'GET');
    service.add({ kind: 'field', key: 'mf.tagline' }, 'Shorten it.', 'stable-request').subscribe();
    http.expectOne(PATH).flush({ revisionId: SCOPE.revisionId, threads: [thread()] });
    expect(oldRead.cancelled).toBe(true);
    expect(service.threads()).toEqual([thread()]);
    expect(service.loading()).toBe(false);
  });

  it('retains the list and allows an explicit same-ID retry after a failed save, never automatically retries', () => {
    service.select(SCOPE);
    finishRead([thread()]);
    const add = service.add({ kind: 'field', key: 'mf.tagline' }, 'Keep this composer text.', 'same-request');
    const error = vi.fn();
    add.subscribe({ error });
    const failed = http.expectOne(PATH);
    const body = failed.request.body;
    failed.flush({ error: 'Unavailable' }, { status: 503, statusText: 'Unavailable' });
    expect(error).toHaveBeenCalled();
    expect(service.saveError()).toBe(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.save);
    expect(service.threads()).toEqual([thread()]);
    expect(service.saving()).toBe(false);
    http.expectNone(() => true);
    add.subscribe();
    const retry = http.expectOne(PATH);
    expect(retry.request.body).toEqual(body);
    retry.flush({ revisionId: SCOPE.revisionId, threads: [thread(), thread('second')] });
    expect(service.saveError()).toBe('');
    expect(service.threads()).toHaveLength(2);
  });

  it('keeps read failure distinct from a measured empty result and logs only status', () => {
    service.select(SCOPE);
    http.expectOne((request) => request.method === 'GET').flush({ error: 'private reply' }, { status: 503, statusText: 'Unavailable' });
    expect(service.loaded()).toBe(false);
    expect(service.loading()).toBe(false);
    expect(service.loadError()).toBe(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.load);
    expect(consoleError).toHaveBeenCalledWith('Asset comments read failed', { status: 503 });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private reply');
  });

  it('retains previously measured comments during a transient same-scope read failure and recovers manually', () => {
    service.select(SCOPE);
    finishRead([thread()]);
    service.refresh();
    http.expectOne((request) => request.method === 'GET').flush('', { status: 500, statusText: 'Error' });
    expect(service.threads()).toEqual([thread()]);
    expect(service.loaded()).toBe(true);
    expect(service.loadError()).not.toBe('');
    service.refresh();
    finishRead([thread(), thread('second')]);
    expect(service.loadError()).toBe('');
    expect(service.threads()).toHaveLength(2);
  });

  it.each([401, 403])('clears inaccessible comment data on read status %s', (status) => {
    service.select(SCOPE);
    finishRead([thread()]);
    service.refresh();
    http.expectOne((request) => request.method === 'GET').flush('', { status, statusText: 'Denied' });
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.loadError()).toBe(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.access);
  });

  it.each([401, 403])('shows a recoverable access-read failure after save status %s without an automatic POST retry', (status) => {
    service.select(SCOPE);
    finishRead([thread()]);
    service.add({ kind: 'field', key: 'mf.tagline' }, 'Change it.', 'request').subscribe({ error: vi.fn() });
    http.expectOne(PATH).flush({ error: 'Writer access required.' }, { status, statusText: 'Denied' });
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.saveError()).toBe('Writer access required.');
    expect(service.loadError()).toBe(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.access);
    http.expectNone(() => true);
    service.refresh();
    finishRead([]);
    expect(service.loadError()).toBe('');
    expect(service.loaded()).toBe(true);
  });

  it('cancels a pending read after a denied save so stale data cannot reappear', () => {
    service.select(SCOPE);
    const old = http.expectOne((request) => request.method === 'GET');
    service.add({ kind: 'field', key: 'mf.tagline' }, 'Change it.', 'request').subscribe({ error: vi.fn() });
    http.expectOne(PATH).flush('', { status: 403, statusText: 'Denied' });
    expect(old.cancelled).toBe(true);
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.loading()).toBe(false);
    expect(service.loadError()).toBe(MKTG_DOCUMENT_COMMENT_CLIENT_MESSAGES.access);
  });

  it('cancels an old-scope save and never displays its result in the next revision', () => {
    service.select(SCOPE);
    finishRead([thread()]);
    const next = vi.fn();
    service.add({ kind: 'field', key: 'mf.tagline' }, 'Change it.', 'request').subscribe(next);
    const write = http.expectOne(PATH);
    service.select({ ...SCOPE, revisionId: NEXT });
    expect(write.cancelled).toBe(true);
    expect(service.saving()).toBe(false);
    expect(service.saveError()).toBe('');
    http.expectOne((request) => request.params.get('revision') === NEXT).flush({ revisionId: NEXT, threads: [] });
    expect(next).not.toHaveBeenCalled();
    expect(service.threads()).toEqual([]);
  });

  it('prevents an old action replay after navigating away and back to the same revision', () => {
    service.select(SCOPE);
    finishRead();
    const oldAction = service.add({ kind: 'field', key: 'mf.tagline' }, 'Old text', 'old-request');
    service.select(null);
    service.select(SCOPE);
    finishRead();
    const next = vi.fn();
    oldAction.subscribe(next);
    http.expectNone(() => true);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not duplicate writes while a save is in flight', () => {
    service.select(SCOPE);
    finishRead();
    service.add({ kind: 'field', key: 'mf.tagline' }, 'First', 'first').subscribe();
    const first = http.expectOne(PATH);
    service.add({ kind: 'field', key: 'mf.tagline' }, 'Second', 'second').subscribe();
    http.expectNone(() => true);
    first.flush({ revisionId: SCOPE.revisionId, threads: [thread()] });
  });

  it('does not accept a response that belongs to a different revision', () => {
    service.select(SCOPE);
    http.expectOne((request) => request.method === 'GET').flush({ revisionId: NEXT, threads: [thread()] });
    expect(service.threads()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.loadError()).not.toBe('');
  });

  it('isolates read-only label metadata by effective subject and revision without posting it', () => {
    const content = { mf: { goals: [{ t: 'Synthetic adoption' }] } };
    service.setLabelContent(content);
    expect(service.labelContent()).toBeNull();
    service.select(SCOPE);
    finishRead();
    service.setLabelContent(content);
    expect(service.labelContent()).toBe(content);
    user.set({ sub: 'opaque-user-two' });
    expect(service.labelContent()).toBeNull();
    TestBed.tick();
    finishRead();
    expect(service.labelContent()).toBeNull();
    service.setLabelContent(content);
    service.select({ ...SCOPE, revisionId: NEXT });
    http.expectOne((request) => request.params.get('revision') === NEXT).flush({ revisionId: NEXT, threads: [] });
    expect(service.labelContent()).toBeNull();
    http.expectNone((request) => request.method === 'POST');
  });

  it('does not send a stale action after sign-out, and cancels a pending read', () => {
    service.select(SCOPE);
    const read = http.expectOne((request) => request.method === 'GET');
    user.set(null);
    expect(service.threads()).toEqual([]);
    TestBed.tick();
    expect(read.cancelled).toBe(true);
    service.add({ kind: 'field', key: 'mf.tagline' }, 'No session', 'request').subscribe({ error: vi.fn() });
    http.expectNone(() => true);
  });

  it('performs no HTTP or browser-storage work during SSR', () => {
    TestBed.resetTestingModule();
    setup('server');
    service.select(SCOPE);
    TestBed.tick();
    service.refresh();
    service.add({ kind: 'field', key: 'mf.tagline' }, 'SSR', 'request').subscribe();
    http.expectNone(() => true);
    expect(service.loaded()).toBe(false);
    expect(service.threads()).toEqual([]);
  });
});
