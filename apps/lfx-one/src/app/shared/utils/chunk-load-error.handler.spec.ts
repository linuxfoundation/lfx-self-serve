// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChunkLoadRecoveryService } from '../services/chunk-load-recovery.service';
import { ChunkLoadErrorHandler } from './chunk-load-error.handler';

describe('ChunkLoadErrorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates recovery while preserving reporting for every error', () => {
    const handleError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: [ChunkLoadErrorHandler, { provide: ChunkLoadRecoveryService, useValue: { handleError } }] });
    const error = new Error('ordinary or import failure');
    TestBed.inject(ChunkLoadErrorHandler).handleError(error);
    expect(handleError).toHaveBeenCalledWith(error);
    expect(console.error).toHaveBeenCalledWith(error);
  });
});
