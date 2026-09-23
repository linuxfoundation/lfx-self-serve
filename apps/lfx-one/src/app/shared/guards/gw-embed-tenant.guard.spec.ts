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
  let createUrlTree: ReturnType<typeof vi.fn>;

  const route = (
    options: { query?: Record<string, string>; childQuery?: Record<string, string>; lens?: 'foundation' | 'project' } = {}
  ): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap(options.query ?? {}),
      firstChild: options.childQuery ? ({ queryParamMap: convertToParamMap(options.childQuery) } as unknown as ActivatedRouteSnapshot) : null,
      // Both mounts declare `data.lens`; the context fallback reads the slot that matches it.
      data: { lens: options.lens ?? 'foundation' },
    }) as unknown as ActivatedRouteSnapshot;

  const runGuard = (r: ActivatedRouteSnapshot): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => gwEmbedTenantGuard(r, {} as RouterStateSnapshot)) as boolean | UrlTree;

  const denial = (url: string, project?: string): unknown => ({ redirect: url, queryParams: project ? { project } : {} });

  beforeEach(() => {
    selectedFoundation = signal<Partial<Project> | null>(null);
    selectedProject = signal<Partial<Project> | null>(null);
    createUrlTree = vi
      .fn()
      .mockImplementation((commands: string[], extras?: { queryParams?: Record<string, string> }) =>
        denial(commands.join('/'), extras?.queryParams?.['project'])
      );

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectContextService, useValue: { selectedFoundation, selectedProject } },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });
  });

  it('denies a non-allowed ?project= even when the stale context still holds the allowed tenant', () => {
    // The admit-the-wrong-tenant direction: cookie says AAIF, the URL is navigating to another
    // foundation. Deciding on context here leaks AAIF's newsletters into that foundation.
    selectedFoundation.set({ slug: ALLOWED });

    expect(runGuard(route({ query: { project: OTHER } }))).toEqual(denial('/foundation/overview', OTHER));
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

  it('reads the project slot on the project mount', () => {
    selectedProject.set({ slug: ALLOWED });

    expect(runGuard(route({ lens: 'project' }))).toBe(true);
  });

  it('ignores a stale allowed project when the foundation mount is the one being asked about', () => {
    // The two slots persist independently, so either can be stale with respect to the other.
    // Accepting either let a leftover AAIF project admit /foundation/gw under another foundation.
    selectedFoundation.set({ slug: OTHER });
    selectedProject.set({ slug: ALLOWED });

    // Refused into the foundation they are actually in, not dropped to the Me Lens: the refusal is
    // about the embed, not about the foundation.
    expect(runGuard(route({ lens: 'foundation' }))).toEqual(denial('/foundation/overview', OTHER));
  });

  it('ignores a stale allowed foundation when the project mount is the one being asked about', () => {
    selectedFoundation.set({ slug: ALLOWED });
    selectedProject.set({ slug: OTHER });

    expect(runGuard(route({ lens: 'project' }))).toEqual(denial('/project/overview', OTHER));
  });

  it('fails closed when neither the route nor the context names a tenant', () => {
    // Not knowing the tenant is exactly the case that renders the wrong one.
    expect(runGuard(route())).toEqual(denial('/foundation/overview'));
  });
});
