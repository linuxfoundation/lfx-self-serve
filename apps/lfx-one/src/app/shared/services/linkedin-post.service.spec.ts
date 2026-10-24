// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LINKEDIN_POST_INTAKE, MKTG_PENDING_RUN_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import { UserService } from './user.service';
import { LinkedinPostService } from './linkedin-post.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('LinkedIn document transport', () => {
  const user = signal({ sub: 'subject-one' });
  const run = {
    sessionId: 'synthetic-session',
    ownerToken: 'synthetic-token',
    documentId: 'run-0123456789abcdef01234567',
    source: { label: 'Example release', words: 10, fetched: false },
    answers: { share_link: 'https://public.example/shared' },
  };
  beforeEach(() => {
    user.set({ sub: 'subject-one' });
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: UserService, useValue: { user } }] });
  });
  it.each(['browser', 'server'])('sweeps stale legacy owner tokens only in the browser, preserving current attempts (%s)', (platform) => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: platform });
    const legacyKey = 'lfx-mktg-pending-document:synthetic-subject:synthetic-project:synthetic-document';
    const currentKey = `${MKTG_PENDING_RUN_STORAGE_KEY_PREFIX}:synthetic-subject:synthetic-project:synthetic-agent:synthetic-document`;
    const legacy = JSON.stringify({ ownerToken: 'synthetic-retired-token', sessionId: 'synthetic-retired-session' });
    for (const key of [legacyKey, `${legacyKey}-another`]) localStorage.setItem(key, legacy);
    localStorage.setItem(currentKey, 'synthetic-current-proof');
    TestBed.inject(LinkedinPostService);
    for (const key of [legacyKey, `${legacyKey}-another`]) expect(localStorage.getItem(key)).toBe(platform === 'browser' ? null : legacy);
    expect(localStorage.getItem(currentKey)).toBe('synthetic-current-proof');
  });

  it('does not block the live transport when browser storage is unavailable', () => {
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('Synthetic storage denial');
    });
    try {
      expect(() => TestBed.inject(LinkedinPostService)).not.toThrow();
    } finally {
      storage.mockRestore();
    }
  });

  it('starts a document without legacy storage and keeps setup only in creator/project/document-bound live memory', () => {
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    const setup = { name: 'Synthetic author', role: 'Maintainer', focus_areas: 'Open source', primary_audience: 'Developers' };
    service.startForDocument(LINKEDIN_POST_INTAKE, 'project-one', { content_source: 'text', content_text: 'private-source' }, setup).subscribe();
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    expect(localStorage.length).toBe(0);
    expect(service.setupForDocument('project-one', run.documentId)).toEqual(setup);
    expect(service.setupForDocument('other-project', run.documentId)).toBeNull();
    expect(service.setupForDocument('project-one', 'run-' + 'b'.repeat(24))).toBeNull();
    expect(TestBed.runInInjectionContext(() => new LinkedinPostService()).setupForDocument('project-one', run.documentId)).toBeNull();
    user.set({ sub: 'another-subject' });
    expect(service.setupForDocument('project-one', run.documentId)).toBeNull();
    http.verify();
  });

  it('does not retain the old subject’s owner token after an impersonation switch', () => {
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    const error = vi.fn();
    service.startForDocument(LINKEDIN_POST_INTAKE, 'project-one', {}).subscribe({ error });
    user.set({ sub: 'subject-two' });
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    expect(error).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    http.verify();
  });
});
