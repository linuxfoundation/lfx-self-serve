// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ElementIdService } from './element-id.service';

describe('ElementIdService', () => {
  it('numbers ids per prefix within one app', () => {
    const ids = TestBed.inject(ElementIdService);

    expect([ids.next('a'), ids.next('a'), ids.next('b')]).toEqual(['a-0', 'a-1', 'b-0']);
  });

  it('starts every app (one SSR request each) from zero', () => {
    TestBed.inject(ElementIdService).next('a');
    TestBed.resetTestingModule();

    expect(TestBed.inject(ElementIdService).next('a')).toBe('a-0');
  });
});
