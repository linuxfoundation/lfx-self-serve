// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Lens } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LensService } from '../services/lens.service';
import { flatDocumentsRedirect } from './flat-documents-redirect.guard';

describe('flatDocumentsRedirect', () => {
  let activeLens: Lens;
  let router: { createUrlTree: ReturnType<typeof vi.fn> };

  const runRedirect = (queryParams: Record<string, string> = {}, fragment: string | null = null) =>
    TestBed.runInInjectionContext(() =>
      flatDocumentsRedirect({
        queryParams,
        fragment,
        params: {},
        data: {},
        routeConfig: null,
        url: [],
        outlet: 'primary',
        title: undefined,
      })
    );

  beforeEach(() => {
    activeLens = 'me';
    router = {
      createUrlTree: vi.fn().mockImplementation((commands: string[]) => ({ redirected: commands.join('/') })),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: LensService, useValue: { activeLens: () => activeLens } },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('sends the me lens to My Dashboard', () => {
    activeLens = 'me';

    expect(runRedirect()).toEqual({ redirected: '/' });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
  });

  it('keeps an org-lens user on the org lens instead of switching them to me', () => {
    activeLens = 'org';

    expect(runRedirect()).toEqual({ redirected: '/org' });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/org']);
  });

  it.each(['foundation', 'project'] as const)('keeps the %s documents page, including the query string', (lens) => {
    activeLens = lens;

    runRedirect({ project: 'cncf' }, 'files');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/', lens, 'documents'], {
      queryParams: { project: 'cncf' },
      fragment: 'files',
    });
  });
});
