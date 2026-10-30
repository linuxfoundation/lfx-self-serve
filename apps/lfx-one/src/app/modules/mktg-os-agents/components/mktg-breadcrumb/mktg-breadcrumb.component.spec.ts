// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MKTG_AGENTS, MKTG_DOCUMENT_TYPES, MKTG_KIT_FAMILIES, MKTG_KIT_TABS } from '@lfx-one/shared/constants';
import { MktgBreadcrumbPage, ProjectContext } from '@lfx-one/shared/interfaces';
import { buildMktgBreadcrumbs } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it } from 'vitest';
import { MktgBreadcrumbComponent } from './mktg-breadcrumb.component';

describe('Marketing kit breadcrumb', () => {
  const context = signal<ProjectContext | null>(null);
  beforeEach(() => {
    context.set({ uid: 'synthetic', name: 'Synthetic Project', slug: 'synthetic-project' });
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: ProjectContextService, useValue: { activeContext: context } }],
    });
  });

  const pages: MktgBreadcrumbPage[] = [
    { kind: 'kit' },
    ...MKTG_KIT_TABS.flatMap(({ path: tab }) => (tab ? [{ kind: 'kit-tab' as const, tab }] : [])),
    ...MKTG_KIT_FAMILIES.map((family) => ({ kind: 'family' as const, familyId: family.id })),
    { kind: 'family', familyId: 'not-found' },
    ...MKTG_DOCUMENT_TYPES.map((type) => ({ kind: 'asset' as const, agentKey: type.agentKey })),
    { kind: 'asset', agentKey: 'legacy-output' },
    ...MKTG_AGENTS.map((agent) => ({ kind: 'run' as const, agentId: agent.id })),
  ];
  for (const host of ['/project/mktg-os-agents', '/foundation/mktg-os-agents']) {
    it.each(pages)(`${host}: serializes absolute hrefs for $kind`, async (page) => {
      await TestBed.inject(Router).navigateByUrl(`${host}/documents/faq/living?project=stale&type=faq&revision=old#sources`);
      const fixture = TestBed.createComponent(MktgBreadcrumbComponent);
      fixture.componentRef.setInput('page', page);
      await fixture.whenStable();
      const root: HTMLElement = fixture.nativeElement;
      const crumbs = buildMktgBreadcrumbs(page, host, 'Synthetic Project');
      expect(Array.from(root.querySelectorAll('li')).map((li) => li.textContent?.replace('›', '').trim())).toEqual(crumbs.map((crumb) => crumb.label));
      const hrefs = crumbs.flatMap((crumb) => (crumb.route ? [`${crumb.route.join('/')}?project=synthetic-project`] : []));
      expect(Array.from(root.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(hrefs);
      expect(root.querySelectorAll('[aria-current="page"]')).toHaveLength(page.kind === 'kit' ? 0 : 1);
      expect(root.querySelectorAll('[data-testid="mktg-breadcrumb-current"]')).toHaveLength(page.kind === 'kit' ? 0 : 1);
      if (page.kind === 'kit') expect(root.querySelector('nav')).toBeNull();
      if (page.kind === 'run') {
        const living = MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === page.agentId && type.kind === 'living');
        const agent = MKTG_AGENTS.find((entry) => entry.id === page.agentId);
        expect(root.querySelector('[data-testid="mktg-breadcrumb-current"]')?.textContent).toBe(living?.itemLabel ?? agent?.name ?? 'Agent');
      }
    });
  }

  it('uses one fallback until project resolution, then reacts to name, slug and context clearing without navigation', async () => {
    context.set(null);
    await TestBed.inject(Router).navigateByUrl('/project/mktg-os-agents/member-360?project=stale');
    const fixture = TestBed.createComponent(MktgBreadcrumbComponent);
    fixture.componentRef.setInput('page', { kind: 'run', agentId: 'member-360' });
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('a')?.textContent).toBe('Marketing kit');
    expect(Array.from(root.querySelectorAll('a')).every((link) => !link.getAttribute('href')?.includes('project='))).toBe(true);
    context.set({ uid: 'next', name: 'Next Project', slug: 'next-project' });
    await fixture.whenStable();
    expect(root.querySelector('a')?.textContent).toBe('Next Project kit');
    expect(Array.from(root.querySelectorAll('a')).every((link) => link.getAttribute('href')?.endsWith('?project=next-project'))).toBe(true);
    context.set(null);
    await fixture.whenStable();
    expect(root.querySelector('a')?.textContent).toBe('Marketing kit');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/project/mktg-os-agents');
  });

  it('reacts to NavigationEnd when the same component crosses lens hosts', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/project/mktg-os-agents/faq');
    const fixture = TestBed.createComponent(MktgBreadcrumbComponent);
    fixture.componentRef.setInput('page', { kind: 'run', agentId: 'faq' });
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/project/mktg-os-agents?project=synthetic-project');
    await router.navigateByUrl('/foundation/mktg-os-agents/faq?type=stale#old');
    await fixture.whenStable();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/foundation/mktg-os-agents?project=synthetic-project');
    expect(root.querySelectorAll('a')[1]?.getAttribute('href')).toBe('/foundation/mktg-os-agents/families/positioning-brand?project=synthetic-project');
  });

  it('never marks an earlier non-link crumb current', async () => {
    const fixture = TestBed.createComponent(MktgBreadcrumbComponent);
    fixture.componentRef.setInput('page', { kind: 'kit' });
    Object.defineProperty(fixture.componentInstance, 'items', { value: signal([{ label: 'Plain middle' }, { label: 'Current' }]) });
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('[data-testid="mktg-breadcrumb-current"]')).toHaveLength(1);
    expect(root.querySelector('[data-testid="mktg-breadcrumb-current"]')?.textContent).toBe('Current');
    expect(root.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(root.querySelector('li span')?.hasAttribute('data-testid')).toBe(false);
  });
});
