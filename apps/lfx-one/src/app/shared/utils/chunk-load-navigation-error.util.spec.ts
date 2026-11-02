// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withNavigationErrorHandler } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChunkLoadRecoveryService } from '../services/chunk-load-recovery.service';
import { handleChunkLoadNavigationError } from './chunk-load-navigation-error.util';

describe('chunk navigation recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('receives a lazy import failure even when navigateByUrl rejection is handled', async () => {
    const error = new Error('Failed to fetch dynamically imported module');
    const recover = vi.fn(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'broken', loadComponent: () => Promise.reject(error) }], withNavigationErrorHandler(handleChunkLoadNavigationError)),
        { provide: ChunkLoadRecoveryService, useValue: { handleError: recover } },
      ],
    });
    await TestBed.inject(Router)
      .navigateByUrl('/broken')
      .catch(() => false);
    expect(recover).toHaveBeenCalledWith(error);
    expect(console.error).toHaveBeenCalledWith(error);
  });

  it('does not log ordinary navigation errors through the recovery hook', async () => {
    const error = new Error('resolver failed');
    const recover = vi.fn(() => false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'broken', loadComponent: () => Promise.reject(error) }], withNavigationErrorHandler(handleChunkLoadNavigationError)),
        { provide: ChunkLoadRecoveryService, useValue: { handleError: recover } },
      ],
    });
    await TestBed.inject(Router)
      .navigateByUrl('/broken')
      .catch(() => false);
    expect(recover).toHaveBeenCalledWith(error);
    expect(console.error).not.toHaveBeenCalled();
  });
});
