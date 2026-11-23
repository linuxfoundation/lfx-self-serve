// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, REQUEST_CONTEXT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, UrlSegment } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { UserService } from '../services/user.service';
import { newsletterAnonymousSsrMatchGuard } from './newsletter-anonymous-ssr-match.guard';

function run(platform: 'server' | 'browser', authenticated: boolean | undefined, paths: string[]): boolean {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: REQUEST_CONTEXT, useValue: authenticated === undefined ? {} : { auth: { authenticated } } },
      { provide: UserService, useValue: { authenticated: signal(authenticated === true) } },
    ],
  });
  const segments = paths.map((path) => new UrlSegment(path, {}));
  return TestBed.runInInjectionContext(() => newsletterAnonymousSsrMatchGuard({} as Route, segments)) as boolean;
}

describe('newsletterAnonymousSsrMatchGuard', () => {
  it('matches a signed-out server render of the permalink', () => {
    expect(run('server', false, ['newsletters', 'acme', 'news-1'])).toBe(true);
  });

  it('matches a signed-out browser visit, which gets the member-benefit email prompt', () => {
    expect(run('browser', false, ['newsletters', 'acme', 'news-1'])).toBe(true);
  });

  it('does not match a signed-in browser visit, which keeps the reader', () => {
    expect(run('browser', true, ['newsletters', 'acme', 'news-1'])).toBe(false);
  });

  it('leaves the drill-down alone in the browser too', () => {
    expect(run('browser', false, ['newsletters', 'my', 'acme'])).toBe(false);
  });

  it('does not match a signed-in request, which keeps the reader', () => {
    expect(run('server', true, ['newsletters', 'acme', 'news-1'])).toBe(false);
  });

  it('does not match when the auth state is unknown', () => {
    expect(run('server', undefined, ['newsletters', 'acme', 'news-1'])).toBe(false);
  });

  it('leaves the authenticated My Newsletters drill-down alone', () => {
    expect(run('server', false, ['newsletters', 'my', 'acme'])).toBe(false);
  });
});
