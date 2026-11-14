// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, PLATFORM_ID, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, map } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { injectIsMobileViewport } from './mobile-viewport.util';

@Component({ selector: 'lfx-mobile-viewport-test-host', template: '' })
class HostComponent {
  public readonly isMobile: Signal<boolean> = injectIsMobileViewport();
}

describe('injectIsMobileViewport', () => {
  async function setup(
    platform: 'browser' | 'server',
    matches: boolean
  ): Promise<{ matches$: BehaviorSubject<boolean>; host: HostComponent; tick: () => void }> {
    const matches$ = new BehaviorSubject<boolean>(matches);
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: BreakpointObserver, useValue: { observe: () => matches$.pipe(map((m) => ({ matches: m, breakpoints: {} }))) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    return { matches$, host: fixture.componentInstance, tick: () => fixture.detectChanges() };
  }

  it('is false at construction on the browser even when the viewport already matches, so the first client render equals the SSR render', async () => {
    const { host } = await setup('browser', true);

    expect(host.isMobile()).toBe(false);
  });

  it('follows the media query once the first render has completed, and keeps following it', async () => {
    const { host, matches$, tick } = await setup('browser', true);

    tick();
    expect(host.isMobile()).toBe(true);

    matches$.next(false);
    expect(host.isMobile()).toBe(false);
  });

  it('stays false on the server regardless of the viewport, because the observer is only registered in the browser', async () => {
    const { host, tick } = await setup('server', true);

    tick();

    expect(host.isMobile()).toBe(false);
  });
});
