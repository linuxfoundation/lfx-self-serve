// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@shared/services/project-context.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gwEmbedTenantGuard } from './gw-embed-tenant.guard';

// This guard is a data-isolation control, not a convenience: Gatewaze serves one tenant, so
// admitting any other foundation renders AAIF's newsletters under that foundation's chrome.
//
// Two earlier versions were wrong in the same place — they decided on the CURRENT context rather
// than the requested one. Angular subscribes same-route canActivate guards concurrently via
// `prioritizedGuardValue()`, so this synchronous guard always ran before the async
// `projectQueryParamGuard` that updates the context, and read the tenant being navigated AWAY
// from. The first two cases below pin that exact failure in both directions.
describe('gwEmbedTenantGuard', () => {
  const ALLOWED = 'agentic-ai-foundation';
  const OTHER = 'the-linux-foundation';

  let selectedFoundation: ReturnType<typeof signal<Partial<Project> | null>>;
  let selectedProject: ReturnType<typeof signal<Partial<Project> | null>>;
  let parseUrl: ReturnType<typeof vi.fn>;

  const route = (options: { query?: Record<string, string>; childQuery?: Record<string, string> } = {}): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap(options.query ?? {}),
      firstChild: options.childQuery ? ({ queryParamMap: convertToParamMap(options.childQuery) } as unknown as ActivatedRouteSnapshot) : null,
    }) as unknown as ActivatedRouteSnapshot;

  const runGuard = (r: ActivatedRouteSnapshot): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => gwEmbedTenantGuard(r, {} as RouterStateSnapshot)) as boolean | UrlTree;

  const denial = (url: string): unknown => ({ redirect: url });

  beforeEach(() => {
    selectedFoundation = signal<Partial<Project> | null>(null);
    selectedProject = signal<Partial<Project> | null>(null);
    parseUrl = vi.fn().mockImplementation((url: string) => denial(url) as UrlTree);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectContextService, useValue: { selectedFoundation, selectedProject } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
  });

  it('denies a non-allowed ?project= even when the stale context still holds the allowed tenant', () => {
    // The admit-the-wrong-tenant direction: cookie says AAIF, the URL is navigating to another
    // foundation. Deciding on context here leaks AAIF's newsletters into that foundation.
    selectedFoundation.set({ slug: ALLOWED });

    expect(runGuard(route({ query: { project: OTHER } }))).toEqual(denial('/'));
  });

  it('admits an allowed ?project= even when the context still holds a different tenant', () => {
    // The refuse-a-valid-link direction: a shared /foundation/gw/... ?project=agentic-ai-foundation
    // URL opened from another foundation's session must still work.
    selectedFoundation.set({ slug: OTHER });

    expect(runGuard(route({ query: { project: ALLOWED } }))).toBe(true);
  });

  it('reads ?project= from the child snapshot', () => {
    // Both mounts are `**` wildcards, so a deep link's query params can land on a child.
    expect(runGuard(route({ childQuery: { project: ALLOWED } }))).toBe(true);
  });

  it('falls back to the resolved context when the route names no project', () => {
    selectedFoundation.set({ slug: ALLOWED });

    expect(runGuard(route())).toBe(true);
  });

  it('accepts the allowed tenant in the project slot as well as the foundation slot', () => {
    selectedProject.set({ slug: ALLOWED });

    expect(runGuard(route())).toBe(true);
  });

  it('fails closed when neither the route nor the context names a tenant', () => {
    // Not knowing the tenant is exactly the case that renders the wrong one.
    expect(runGuard(route())).toEqual(denial('/'));
  });
});
