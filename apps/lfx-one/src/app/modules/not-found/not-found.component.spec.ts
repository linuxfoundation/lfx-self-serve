// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideLocationMocks } from '@angular/common/testing';
import { PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { NotFoundComponent } from './not-found.component';

/**
 * Guards the novel SSR contract: during server render the component mutates the
 * shared REQUEST_CONTEXT so the Express handler rewrites the response to a real
 * HTTP 404. It must do so only on the server, and must not throw when no
 * request context is present (client navigation).
 */
describe('NotFoundComponent', () => {
  function create(platform: 'server' | 'browser', reqContext: ServerRequestContext | null): void {
    TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platform }, { provide: REQUEST_CONTEXT, useValue: reqContext }, provideRouter([]), provideLocationMocks()],
    });
    // Constructing the component runs the constructor that flags not-found.
    TestBed.createComponent(NotFoundComponent);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('flags notFound on the request context during SSR', () => {
    const reqContext: ServerRequestContext = { notFound: false };
    create('server', reqContext);
    expect(reqContext.notFound).toBe(true);
  });

  it('leaves notFound untouched during browser rendering', () => {
    const reqContext: ServerRequestContext = { notFound: false };
    create('browser', reqContext);
    expect(reqContext.notFound).toBe(false);
  });

  it('does not throw during SSR when no request context is present', () => {
    expect(() => create('server', null)).not.toThrow();
  });
});
