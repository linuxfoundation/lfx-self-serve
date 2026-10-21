// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS, Location } from '@angular/common';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MKTG_AGENTS, MKTG_DOCUMENT_TYPES, MKTG_REBUILD_NAVIGATION_STATE_KEY } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgRevisionRef } from '@lfx-one/shared/interfaces';
import { resolveMktgKit } from '@lfx-one/shared/utils';
import { MktgKitService } from '@services/mktg-kit.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgRebuildService } from '@services/mktg-rebuild.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgFamilyComponent } from './mktg-family.component';

describe('Marketing family page', () => {
  const originalAgents = [...MKTG_AGENTS];
  const families = signal(resolveMktgKit({ project: 'synthetic', groups: [] }));
  const loading = signal(false);
  const error = signal('');
  const projectSlug = signal('synthetic');
  const framework: MktgRevisionRef = {
    agentKey: 'foundation-message',
    revisionId: '000003-' + 'a'.repeat(64),
    revisionNumber: 3,
    contentSha256: 'b'.repeat(64),
  };
  const documents = signal<MktgDocumentsResponse>({ project: 'synthetic', groups: [] });
  const run = vi.fn(() => of({ project: 'synthetic', framework, chainId: 'chain', ownerToken: 'token', status: 'complete', steps: [] }));
  beforeEach(() => {
    const agents = originalAgents.map((agent) => (agent.id === 'member-360' ? { ...agent, status: 'coming-soon' as const } : agent));
    MKTG_AGENTS.splice(0, MKTG_AGENTS.length, ...agents);
    projectSlug.set('synthetic');
    documents.set({ project: 'synthetic', groups: [] });
    run.mockClear();
    families.set(
      resolveMktgKit({
        project: 'synthetic',
        groups: MKTG_DOCUMENT_TYPES.map((type) => ({
          type,
          documents:
            type.agentKey === 'foundation-message'
              ? [
                  {
                    agentKey: type.agentKey,
                    documentId: 'living',
                    revisionCount: 99,
                    latestRevisionId: '000003-' + 'a'.repeat(64),
                    approvedCurrent: null,
                    updatedAt: '2026-10-16T12:00:00Z',
                    createdAt: '2026-10-01T12:00:00Z',
                  },
                ]
              : [],
        })),
      })
    );
    loading.set(false);
    error.set('');
    TestBed.configureTestingModule({
      providers: [
        { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } },
        { provide: MktgRebuildService, useValue: { run } },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-writer' }), impersonating: signal(false) } },
        { provide: MktgDocumentStoreService, useValue: { getRevision: () => of(null) } },
        provideRouter([
          { path: 'project/mktg-os-agents/families/:familyId', component: MktgFamilyComponent },
          { path: '**', children: [] },
        ]),
      ],
    });
    TestBed.overrideComponent(MktgFamilyComponent, {
      set: {
        providers: [
          {
            provide: MktgKitService,
            useValue: {
              families,
              loading,
              error,
              projectUid: signal('synthetic'),
              projectName: signal('Synthetic Project'),
              projectQueryParams: computed(() => ({ project: projectSlug() })),
              documents,
              retry: vi.fn(),
            },
          },
        ],
      },
    });
  });
  afterEach(() => void MKTG_AGENTS.splice(0, MKTG_AGENTS.length, ...originalAgents));

  it.each(['matching state', 'wrong project', 'wrong revision', 'URL only'])('consumes %s once without accepting URL write intent', async (scenario) => {
    documents.set({ project: 'synthetic', groups: [], approvedFramework: framework });
    families.update((items) =>
      items.map((family) => ({ ...family, rows: family.rows.map((row) => (row.asset.agentKey === 'boilerplates' ? { ...row, state: 'needs-rebuild' } : row)) }))
    );
    const harness = await RouterTestingHarness.create();
    const intent = {
      project: scenario === 'wrong project' ? 'other' : 'synthetic',
      frameworkRevisionId: scenario === 'wrong revision' ? '000001-' + 'c'.repeat(64) : framework.revisionId,
    };
    const query = scenario === 'URL only' ? '&rebuild=' + framework.revisionId : '';
    await TestBed.inject(Router).navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic' + query, {
      state: scenario === 'URL only' ? {} : { [MKTG_REBUILD_NAVIGATION_STATE_KEY]: intent },
    });
    await harness.fixture.whenStable();
    expect(run).toHaveBeenCalledTimes(scenario === 'matching state' ? 1 : 0);
    expect((TestBed.inject(Location).getState() as Record<string, unknown> | null)?.[MKTG_REBUILD_NAVIGATION_STATE_KEY]).toBeUndefined();
    documents.set({ ...documents() });
    await harness.fixture.whenStable();
    expect(run).toHaveBeenCalledTimes(scenario === 'matching state' ? 1 : 0);
  });

  it('links existing assets and the first available agent; exports/rebuild remain disabled', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    expect(root?.querySelector('[data-testid="mktg-family-asset-messaging-framework"]')?.textContent).toContain('Draft');
    expect(root?.querySelector('[data-testid="mktg-family-current-messaging-framework"]')?.textContent).toContain('v3');
    expect(root?.querySelector('[data-testid="mktg-family-current-messaging-framework"]')?.textContent).not.toContain('v99');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Title).getTitle()).toBe('Positioning & brand · LFX');
    expect(root?.textContent).toContain('Boilerplates');
    expect(root?.querySelector('[data-testid="mktg-family-open-messaging-framework"]')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/documents/foundation-message/living?project=synthetic'
    );
    expect(root?.querySelector('[data-testid="mktg-family-open-brand-kit"]')).toBeNull();
    for (const id of ['family-export-pdf', 'family-export-slides', 'mktg-family-rebuild']) {
      expect(root?.querySelector<HTMLButtonElement>(`[data-testid="${id}"] button`)?.disabled).toBe(true);
    }
    expect(root?.querySelector('[data-testid="mktg-family-rebuild"] button')?.getAttribute('aria-label')).toBe('Rebuild what is stale');
    expect(root?.querySelector('lfx-mktg-family-export-actions')?.getAttribute('data-family-id')).toBe('positioning-brand');
    projectSlug.set('next');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('project=synthetic');
    for (const link of root?.querySelectorAll<HTMLAnchorElement>('a') ?? []) expect(link.search).toContain('project=next');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    root?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button')?.click();
    expect(navigate).toHaveBeenCalledWith(
      ['../../', 'foundation-setup'],
      expect.objectContaining({ queryParams: { project: 'next' }, queryParamsHandling: 'merge' })
    );
  });
  it('offers only active Missing-row agents, preserving project scope; header action stays unchanged', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    expect(root?.querySelector('[data-testid="mktg-family-run-brand-kit"] a')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/brand-kit?project=synthetic'
    );
    expect(root?.querySelector('[data-testid="mktg-family-run-boilerplates"]')?.textContent).toContain('Run Boilerplates');
    expect(root?.querySelector('[data-testid="mktg-family-run-messaging-framework"]')).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-run-faq"]')?.textContent).toContain('Run FAQ');
    expect(root?.querySelector('[data-testid="mktg-family-run-one-pager"]')).toBeNull();
    for (const state of ['approved', 'draft', 'needs-rebuild', 'coming-soon'] as const) {
      families.update((value) => value.map((family) => ({ ...family, rows: family.rows.map((row) => ({ ...row, state })) })));
      harness.detectChanges();
      expect(root?.querySelector('[data-testid="mktg-family-run-brand-kit"]')).toBeNull();
    }
    families.update((value) => value.map((family) => ({ ...family, rows: family.rows.map((row) => ({ ...row, state: 'missing', monthlyCount: null })) })));
    await harness.navigateByUrl('/project/mktg-os-agents/families/website-web', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-aeo-geo"]')).toBeNull();
  });

  it('shows run dates without pretending revisionCount is a current version', async () => {
    families.update((value) =>
      value.map((family) => ({
        ...family,
        rows: family.rows.map((row) =>
          row.asset.agentKey === 'linkedin-post'
            ? {
                ...row,
                document: {
                  agentKey: 'linkedin-post' as const,
                  documentId: 'run-synthetic',
                  revisionCount: 1,
                  latestRevisionId: 'synthetic',
                  approvedCurrent: null,
                  createdAt: '2026-10-10T12:00:00Z',
                  updatedAt: '2026-10-11T12:00:00Z',
                },
              }
            : row
        ),
      }))
    );
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/social-community', MktgFamilyComponent);
    const current = harness.routeNativeElement?.querySelector('[data-testid="mktg-family-current-linkedin-post"]');
    expect(current?.textContent).toContain('10 Oct');
    expect(current?.textContent).not.toContain('v1');
  });

  it('handles coming-soon and unknown family ids on the same route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/events', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-coming-soon"]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('table')).toBeNull();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Title).getTitle()).toBe('Events · LFX');
    await harness.navigateByUrl('/project/mktg-os-agents/families/unknown', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-not-found"]')).not.toBeNull();
  });
  it('captions each disabled action and explains a coming-soon Run agent in the intro', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/website-web', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button')?.disabled).toBe(true);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-unavailable"]')?.textContent).toContain('Coming soon');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-rebuild-unavailable"]')?.textContent).toContain('Coming soon');
    await harness.navigateByUrl('/project/mktg-os-agents/families/member-sponsor', MktgFamilyComponent);
    const run = harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button');
    expect(run?.disabled).toBe(true);
    expect(run?.textContent).toContain('Run Member 360');
    const pending = MKTG_AGENTS.find((agent) => agent.id === 'member-360');
    expect(pending?.status).toBe('coming-soon');
    expect(run?.getAttribute('aria-label')).toBe(`Run ${pending?.name} (coming soon)`);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-unavailable"]')?.textContent).toContain(
      'Coming soon — the Member 360 page is on its way'
    );
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-coming-soon"]')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-asset-member-360"]')).not.toBeNull();
  });
  it('automatically enables the pending first agent when its catalog entry becomes active', async () => {
    const index = MKTG_AGENTS.findIndex((agent) => agent.id === 'member-360');
    const originalAgent = MKTG_AGENTS[index];
    if (!originalAgent) throw new Error('Expected the pending Member 360 test catalog entry');
    MKTG_AGENTS[index] = { ...originalAgent, status: 'active', name: 'Synthetic Member Agent', guildAgentHandle: 'member-360' };
    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/project/mktg-os-agents/families/member-sponsor?project=synthetic', MktgFamilyComponent);
      const run = harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button');
      expect(run?.disabled).toBe(false);
      expect(run?.textContent).toContain('Run Synthetic Member Agent');
      expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-unavailable"]')).toBeNull();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      run?.click();
      expect(navigate).toHaveBeenCalledWith(['../../', 'member-360'], expect.objectContaining({ queryParamsHandling: 'merge' }));
    } finally {
      MKTG_AGENTS[index] = originalAgent;
    }
  });
  it('defensively renders no-project while isolated from lens navigation', async () => {
    families.set([]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-no-project"]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('table')).toBeNull();
  });
  it('renders loading and errors without claiming missing documents, keeping catalog actions', async () => {
    loading.set(true);
    families.set([]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-loading"]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button')?.disabled).toBe(false);
    loading.set(false);
    error.set('You need write access.');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain('write access');
    expect(harness.routeNativeElement?.querySelector('table')).toBeNull();
  });
});
