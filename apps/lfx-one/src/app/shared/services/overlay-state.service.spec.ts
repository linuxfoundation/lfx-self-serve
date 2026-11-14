// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { OverlayStateService } from './overlay-state.service';

describe('OverlayStateService', () => {
  let service: OverlayStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OverlayStateService);
  });

  it('should start with nothing open and no sticky bar', () => {
    expect(service.anyOpen()).toBe(false);
    expect(service.stickyBarVisible()).toBe(false);
  });

  it('should report open after register and closed after unregister', () => {
    service.register('a');
    expect(service.anyOpen()).toBe(true);

    service.unregister('a');
    expect(service.anyOpen()).toBe(false);
  });

  it('should stay open until every registered overlay has unregistered', () => {
    service.register('a');
    service.register('b');
    service.unregister('a');
    expect(service.anyOpen()).toBe(true);

    service.unregister('b');
    expect(service.anyOpen()).toBe(false);
  });

  it('should treat repeated register and unregister of the same id as idempotent', () => {
    service.register('a');
    service.register('a');
    service.unregister('a');
    expect(service.anyOpen()).toBe(false);

    service.unregister('a');
    expect(service.anyOpen()).toBe(false);
  });
});
