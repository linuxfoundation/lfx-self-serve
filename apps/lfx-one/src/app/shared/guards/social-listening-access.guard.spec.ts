// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { PersonaService } from '@shared/services/persona.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectRecoveryService } from '@shared/services/project-recovery.service';
import { SocialListeningService } from '@shared/services/social-listening.service';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { socialListeningAccessGuard } from './social-listening-access.guard';

describe('socialListeningAccessGuard', () => {
  let currentPersona: ReturnType<typeof signal<string>>;
  let canViewExecutiveDashboards: ReturnType<typeof signal<boolean>>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let getAccess: ReturnType<typeof vi.fn>;
  let setFoundation: ReturnType<typeof vi.fn>;
  let setRouteLensKind: ReturnType<typeof vi.fn>;
  let resolveProject: ReturnType<typeof vi.fn>;
  let groupGrant: { set: ReturnType<typeof vi.fn> };

  const route = (params: Record<string, string> = {}): ActivatedRouteSnapshot =>
    ({ queryParamMap: convertToParamMap(params), data: { lens: 'foundation' } }) as unknown as ActivatedRouteSnapshot;

  const runGuard = async (r: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    const result = TestBed.runInInjectionContext(() => socialListeningAccessGuard(r, {} as RouterStateSnapshot));
    return typeof result === 'boolean' ? result : firstValueFrom(result as Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    currentPersona = signal('board-member');
    canViewExecutiveDashboards = signal(false);
    selectedFoundation = signal<{ slug: string } | null>(null);
    getAccess = vi.fn().mockReturnValue(of({ canView: false, reason: 'none' }));
    setFoundation = vi.fn();
    setRouteLensKind = vi.fn();
    groupGrant = { set: vi.fn() };
    resolveProject = vi.fn().mockReturnValue(of({ uid: 'tlf-uid', name: 'TLF', slug: 'tlf' }));

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { currentPersona, canViewExecutiveDashboards, refreshEnrichedPersonas: vi.fn(() => of(null)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation, setFoundation, setRouteLensKind } },
        { provide: SocialListeningService, useValue: { getAccess, groupGrant } },
        { provide: ProjectRecoveryService, useValue: { resolve: resolveProject, unavailable: vi.fn() } },
        {
          provide: Router,
          useValue: {
            createUrlTree: vi.fn((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
            parseUrl: vi.fn((url: string) => ({ parsed: url }) as unknown as UrlTree),
          },
        },
      ],
    });
  });

  it('lets the ED persona straight through, seeding the foundation from ?project=', async () => {
    currentPersona.set('executive-director');

    await expect(runGuard(route({ project: 'tlf' }))).resolves.toBe(true);
    expect(getAccess).not.toHaveBeenCalled();
    expect(resolveProject).toHaveBeenCalledWith('tlf');
    expect(setFoundation).toHaveBeenCalledWith(expect.objectContaining({ uid: 'tlf-uid', slug: 'tlf' }));
  });

  it('shows not-found when ?project= does not resolve for the ED', async () => {
    currentPersona.set('executive-director');
    resolveProject.mockReturnValue(throwError(() => ({ status: 404 })));

    const result = await runGuard(route({ project: 'nope' }));
    expect((result as unknown as { redirectTo: unknown }).redirectTo).toEqual({ parsed: '/not-found' });
  });

  it("seeds a cross-foundation ED's group grant when the viewer-gated lookup can't resolve the foundation", async () => {
    currentPersona.set('executive-director');
    resolveProject.mockReturnValue(throwError(() => ({ status: 403 })));
    const foundation = { uid: 'b-uid', name: 'B', slug: 'b' };
    getAccess.mockReturnValue(of({ canView: true, reason: 'group-member', foundation, foundationSfid: 'b-sfid' }));

    await expect(runGuard(route({ project: 'b' }))).resolves.toBe(true);
    expect(getAccess).toHaveBeenCalledWith('b');
    expect(setFoundation).toHaveBeenCalledWith(foundation);
    expect(groupGrant.set).toHaveBeenCalledWith({ foundation, foundationSfid: 'b-sfid' });
  });

  it('admits LF Staff without asking the access endpoint', async () => {
    canViewExecutiveDashboards.set(true);

    await expect(runGuard(route({ project: 'tlf' }))).resolves.toBe(true);
    expect(getAccess).not.toHaveBeenCalled();
  });

  it('admits a group member and seeds the foundation from the access response, without the viewer-gated lookup', async () => {
    const foundation = { uid: 'tlf-uid', name: 'TLF', slug: 'tlf' };
    getAccess.mockReturnValue(of({ canView: true, reason: 'group-member', foundation, foundationSfid: 'tlf-sfid' }));

    await expect(runGuard(route({ project: 'tlf' }))).resolves.toBe(true);
    expect(getAccess).toHaveBeenCalledWith('tlf');
    expect(setRouteLensKind).toHaveBeenCalledWith('foundation');
    expect(setFoundation).toHaveBeenCalledWith(foundation);
    expect(groupGrant.set).toHaveBeenCalledWith({ foundation, foundationSfid: 'tlf-sfid' });
    expect(resolveProject).not.toHaveBeenCalled();
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
