// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, UrlSegment } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { newsletterAnonymousSsrMatchGuard } from './newsletter-anonymous-ssr-match.guard';

function run(platform: 'server' | 'browser', authenticated: boolean | undefined, paths: string[]): boolean {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: REQUEST_CONTEXT, useValue: authenticated === undefined ? {} : { auth: { authenticated } } },
    ],
  });
  const segments = paths.map((path) => new UrlSegment(path, {}));
  return TestBed.runInInjectionContext(() => newsletterAnonymousSsrMatchGuard({} as Route, segments)) as boolean;
}

describe('newsletterAnonymousSsrMatchGuard', () => {
  it('matches a signed-out server render of the permalink', () => {
    expect(run('server', false, ['newsletters', 'acme', 'news-1'])).toBe(true);
  });

  it('never matches in the browser, so the shell authGuard still sends visitors to sign in', () => {
    expect(run('browser', false, ['newsletters', 'acme', 'news-1'])).toBe(false);
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
