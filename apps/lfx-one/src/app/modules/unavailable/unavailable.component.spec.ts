// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnavailableComponent } from './unavailable.component';

describe('UnavailableComponent', () => {
  function create(platform: 'server' | 'browser', reqContext: ServerRequestContext | null) {
    TestBed.configureTestingModule({
      imports: [UnavailableComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platform }, { provide: REQUEST_CONTEXT, useValue: reqContext }, provideRouter([]), provideLocationMocks()],
    });
    return TestBed.createComponent(UnavailableComponent);
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('flags unavailable only during SSR', () => {
    const reqContext: ServerRequestContext = { unavailable: false };
    create('server', reqContext);
    expect(reqContext.unavailable).toBe(true);
  });

  it('leaves the request context untouched in the browser', () => {
    const reqContext: ServerRequestContext = { unavailable: false };
    create('browser', reqContext);
    expect(reqContext.unavailable).toBe(false);
  });

  it('does not throw without a request context', () => {
    expect(() => create('server', null)).not.toThrow();
  });

  it('retries the original path and query string from the rendered button', () => {
    const fixture = create('browser', null);
    vi.spyOn(TestBed.inject(Location), 'path').mockReturnValue('/foundation/groups?project=test-foundation');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="unavailable-retry-button"] button').click();

    expect(navigate).toHaveBeenCalledWith('/foundation/groups?project=test-foundation');
  });

  it.each(['', '/unavailable', '/unavailable?project=test-foundation'])('falls back to the dashboard for path %j', (path) => {
    const fixture = create('browser', null);
    vi.spyOn(TestBed.inject(Location), 'path').mockReturnValue(path);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.retry();

    expect(navigate).toHaveBeenCalledWith('/');
  });
});
