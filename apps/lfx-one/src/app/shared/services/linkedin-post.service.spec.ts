// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
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
  afterEach(() => vi.useRealTimers());
  it('polls public activity, pauses at questions, answers the same session and ignores an already answered round', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(LinkedinPostService);
    const http = TestBed.inject(HttpTestingController);
    const setup = { name: 'Synthetic author', role: 'Maintainer', focus_areas: 'Open source', primary_audience: 'Developers' };
    service.startForDocument(LINKEDIN_POST_INTAKE, 'project-one', { content_source: 'text', content_text: 'private-source' }, setup).subscribe();
    http.expectOne(LINKEDIN_POST_INTAKE.endpoints.generate).flush(run);
    expect(localStorage.length).toBe(0);
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
