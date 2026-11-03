// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeResizeService } from './meetings-home-resize.service';

describe('MeetingsHomeResizeService', () => {
  let created: number;
  let notify: (targets: Element[]) => void;
  let unobserve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = 0;
    unobserve = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public unobserve = unobserve;
        public disconnect = vi.fn();
        public constructor(callback: (entries: { target: Element }[]) => void) {
          created++;
          notify = (targets) => callback(targets.map((target) => ({ target })));
        }
      }
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shares one observer, calls each row once per batch and stops watching on request', () => {
    const service = TestBed.inject(MeetingsHomeResizeService);
    const [title, project, other] = [document.createElement('a'), document.createElement('span'), document.createElement('a')];
    const first = vi.fn();
    const second = vi.fn();

    const stop = service.observe([title, project], first);
    service.observe([other], second);
    notify([title, project]);

    expect(created).toBe(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    stop();
    notify([title]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(unobserve).toHaveBeenCalledWith(title);
    expect(unobserve).toHaveBeenCalledWith(project);
  });

  it('does nothing during server rendering', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const stop = TestBed.inject(MeetingsHomeResizeService).observe([document.createElement('a')], vi.fn());

    expect(created).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});
