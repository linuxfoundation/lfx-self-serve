// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { PersonaService } from '@shared/services/persona.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formationsQueueAuditorGuard } from './formations-queue-auditor.guard';

describe('formationsQueueAuditorGuard', () => {
  let isRootWriter: ReturnType<typeof signal<boolean>>;
  let isAuditor: ReturnType<typeof signal<boolean>>;
  let refreshEnrichedPersonas: ReturnType<typeof vi.fn>;
  let router: { createUrlTree: ReturnType<typeof vi.fn> };

  const runGuard = async (): Promise<boolean | UrlTree> => {
    const result = TestBed.runInInjectionContext(() => formationsQueueAuditorGuard(null as never, null as never));
    return typeof result === 'boolean' ? result : firstValueFrom(result as Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    isRootWriter = signal(false);
    isAuditor = signal(false);
    refreshEnrichedPersonas = vi.fn().mockReturnValue(of(null));
    router = { createUrlTree: vi.fn().mockImplementation((commands: string[]) => ({ denied: commands[0] }) as unknown as UrlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { isRootWriter, isAuditor, refreshEnrichedPersonas } },
        { provide: Router, useValue: router },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows on the server without evaluating anything (SSR fast path)', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    expect(await runGuard()).toBe(true);
    expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
  });

  it('allows a root writer without an explicit probe', async () => {
    isRootWriter.set(true);

    expect(await runGuard()).toBe(true);
    expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
  });

  it('allows a caller whose fresh probe response carries isAuditor', async () => {
    refreshEnrichedPersonas.mockReturnValue(of({ isAuditor: true, isRootWriter: false, error: null }));

    expect(await runGuard()).toBe(true);
  });

  it('denies a caller whose fresh probe response has neither grant', async () => {
    refreshEnrichedPersonas.mockReturnValue(of({ isAuditor: false, isRootWriter: false, error: null }));

    const result = await runGuard();

    expect(result).toEqual({ denied: '/foundation/overview' });
  });

  it('falls back to the already-loaded signal when refreshEnrichedPersonas short-circuits to null', async () => {
    isAuditor.set(true);
    refreshEnrichedPersonas.mockReturnValue(of(null));

    expect(await runGuard()).toBe(true);
  });

  it('denies on an errored probe response, falling back to the (denied) cached signal', async () => {
    isAuditor.set(false);
    refreshEnrichedPersonas.mockReturnValue(of({ isAuditor: true, isRootWriter: false, error: 'upstream failure' }));

    const result = await runGuard();

    expect(result).toEqual({ denied: '/foundation/overview' });
  });
});
