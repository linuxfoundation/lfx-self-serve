// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { PersonaService } from '@shared/services/persona.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { SocialListeningService } from '@shared/services/social-listening.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { socialListeningAccessGuard } from './social-listening-access.guard';

describe('socialListeningAccessGuard', () => {
  let currentPersona: ReturnType<typeof signal<string>>;
  let canViewExecutiveDashboards: ReturnType<typeof signal<boolean>>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let getAccess: ReturnType<typeof vi.fn>;

  const route = (params: Record<string, string> = {}): ActivatedRouteSnapshot =>
    ({ queryParamMap: convertToParamMap(params) }) as unknown as ActivatedRouteSnapshot;

  const runGuard = async (r: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    const result = TestBed.runInInjectionContext(() => socialListeningAccessGuard(r, {} as RouterStateSnapshot));
    return typeof result === 'boolean' ? result : firstValueFrom(result as Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    currentPersona = signal('board-member');
    canViewExecutiveDashboards = signal(false);
    selectedFoundation = signal<{ slug: string } | null>(null);
    getAccess = vi.fn().mockReturnValue(of({ canView: false, reason: 'none' }));

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { currentPersona, canViewExecutiveDashboards, refreshEnrichedPersonas: vi.fn(() => of(null)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: SocialListeningService, useValue: { getAccess } },
        {
          provide: Router,
          useValue: { createUrlTree: vi.fn((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree) },
        },
      ],
    });
  });

  it('lets the ED persona straight through', async () => {
    currentPersona.set('executive-director');

    await expect(runGuard(route({ project: 'tlf' }))).resolves.toBe(true);
    expect(getAccess).not.toHaveBeenCalled();
  });

  it('admits LF Staff without asking the access endpoint', async () => {
    canViewExecutiveDashboards.set(true);

    await expect(runGuard(route({ project: 'tlf' }))).resolves.toBe(true);
    expect(getAccess).not.toHaveBeenCalled();
  });

  it('admits a group member the access endpoint admits for the foundation in ?project=', async () => {
    getAccess.mockReturnValue(of({ canView: true, reason: 'group-member' }));

    await expect(runGuard(route({ project: 'tlf' }))).resolves.toBe(true);
    expect(getAccess).toHaveBeenCalledWith('tlf');
  });

  it('falls back to the selected foundation when ?project= is absent', async () => {
    selectedFoundation.set({ slug: 'cncf' });
    getAccess.mockReturnValue(of({ canView: true, reason: 'group-member' }));

    await expect(runGuard(route())).resolves.toBe(true);
    expect(getAccess).toHaveBeenCalledWith('cncf');
  });

  it('redirects to the foundation overview when access is denied', async () => {
    await expect(runGuard(route({ project: 'tlf' }))).resolves.toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: 'tlf' } } });
  });

  it('redirects without a lookup when no foundation is known', async () => {
    await expect(runGuard(route())).resolves.toMatchObject({ denied: '/foundation/overview' });
    expect(getAccess).not.toHaveBeenCalled();
  });
});
