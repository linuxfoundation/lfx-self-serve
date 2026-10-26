// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS, Location } from '@angular/common';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MKTG_AGENTS, MKTG_DOCUMENT_TYPES, MKTG_REBUILD_NAVIGATION_STATE_KEY, MKTG_AGENT_INTAKES, MKTG_KIT_FAMILIES } from '@lfx-one/shared/constants';
import { MktgDocumentsResponse, MktgRevisionRef } from '@lfx-one/shared/interfaces';
import { resolveMktgKit } from '@lfx-one/shared/utils';
import { MktgKitService } from '@services/mktg-kit.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgRebuildService } from '@services/mktg-rebuild.service';
import { UserService } from '@services/user.service';
import { MktgFamilyExportService } from '@services/mktg-family-export.service';
import { ProjectContextService } from '@services/project-context.service';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgFamilyComponent } from './mktg-family.component';

describe('Marketing family page', () => {
  const originalAgents = [...MKTG_AGENTS];
  const families = signal(resolveMktgKit({ project: 'synthetic', groups: [] }));
  const loading = signal(false);
  const error = signal('');
  const accessDenied = signal(false);
  const projectSlug = signal('synthetic');
  const framework: MktgRevisionRef = {
    agentKey: 'foundation-message',
    revisionId: '000003-' + 'a'.repeat(64),
    revisionNumber: 3,
    contentSha256: 'b'.repeat(64),
  };
  const documents = signal<MktgDocumentsResponse>({ project: 'synthetic', groups: [] });
  const run = vi.fn(() => of({ project: 'synthetic', framework, chainId: 'chain', ownerToken: 'token', status: 'complete', steps: [] }));
  const writer = signal(false);
  const lastExport = vi.fn(() => of(null));
  beforeEach(() => {
    const agents = originalAgents.map((agent) => (agent.id === 'member-360' ? { ...agent, status: 'coming-soon' as const } : agent));
    MKTG_AGENTS.splice(0, MKTG_AGENTS.length, ...agents);
    writer.set(true);
    lastExport.mockClear();
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
    accessDenied.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } },
        { provide: MktgRebuildService, useValue: { run } },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-writer' }), impersonating: signal(false) } },
        { provide: ProjectContextService, useValue: { activeContext: signal({ uid: 'synthetic', name: 'Synthetic project' }), canWrite: writer } },
        { provide: MktgFamilyExportService, useValue: { last: lastExport, running: () => null } },
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
              accessDenied,
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

  it('contains each stretched link and raised Run control in a positioned list card', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic&unrelated=drop&profile=drop', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    const list = root?.querySelector('[data-testid="mktg-family-assets"]');
    expect(list?.tagName).toBe('UL');
    expect(list?.getAttribute('role')).toBe('list');
    expect(root?.querySelector('table')).toBeNull();
    const family = MKTG_KIT_FAMILIES.find((entry) => entry.id === 'positioning-brand');
    expect(family).toBeDefined();
    for (const asset of family?.assets ?? []) {
      const row = list?.querySelector(`[data-testid="mktg-family-asset-${asset.id}"]`);
      expect(row?.tagName).toBe('LI');
      expect(row?.classList.contains('relative')).toBe(true);
      expect(row?.querySelector(`[data-testid="mktg-family-state-${asset.id}"]`)).not.toBeNull();
      expect(row?.querySelector(`[data-testid="mktg-family-current-${asset.id}"]`)).not.toBeNull();
    }
    expect(list?.querySelector('[data-testid="mktg-family-open-messaging-framework"]')?.classList.contains('after:inset-0')).toBe(true);
    const activeRun = list?.querySelector('[data-testid="mktg-family-run-messaging-framework"]');
    expect(activeRun).toBeNull(); // Existing assets open their document; Run again lives there.
    const blockedRun = list?.querySelector('[data-testid="mktg-family-run-boilerplates"]')?.parentElement;
    expect(blockedRun?.classList.contains('relative')).toBe(true);
    expect(blockedRun?.classList.contains('z-10')).toBe(true);
  });

  it('links existing assets and the next clear step; the primary is never disabled', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic&unrelated=drop&profile=drop', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    expect(root?.querySelector('[data-testid="mktg-family-asset-messaging-framework"]')?.textContent).toContain('Draft');
    expect(root?.querySelector('[data-testid="mktg-family-current-messaging-framework"]')?.textContent).toContain('v3');
    expect(root?.querySelector('[data-testid="mktg-family-current-messaging-framework"]')?.textContent).not.toContain('v99');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Title).getTitle()).toBe('Positioning & brand · LFX');
    expect(root?.textContent).toContain('Boilerplates');
    expect(root?.querySelector('[data-testid="mktg-breadcrumb-link-0"]')?.getAttribute('href')).toBe('/project/mktg-os-agents?project=synthetic');
    expect(root?.querySelector('[aria-current="page"]')?.textContent).toBe('Positioning & brand');
    expect(root?.querySelector('[data-testid="mktg-family-kit-link"]')).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-open-messaging-framework"]')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/documents/foundation-message/living?project=synthetic&unrelated=drop&profile=drop'
    );
    expect(root?.querySelector('[data-testid="mktg-family-open-brand-kit"]')).toBeNull();
    for (const id of ['family-export-pdf', 'family-export-slides']) {
      expect(root?.querySelector<HTMLButtonElement>(`[data-testid="${id}"] button`)?.disabled).toBe(true);
    }
    // Nothing stale: the one header action runs the next asset not run yet.
    expect(root?.querySelector('[data-testid="mktg-family-rebuild"]')).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-run"]')?.textContent).toContain('Review and approve the messaging framework');
    expect(root?.querySelector('[data-testid="mktg-family-run-next"]')).toBeNull();
    expect(root?.querySelector('lfx-mktg-family-export-actions')?.getAttribute('data-family-id')).toBe('positioning-brand');
    projectSlug.set('next');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('project=synthetic');
    for (const link of root?.querySelectorAll<HTMLAnchorElement>('a') ?? []) expect(link.search).toContain('project=next');
    // The framework is a draft: Boilerplates is next but cannot run until it is approved.
    expect(root?.querySelector('[data-testid="mktg-family-run"] a')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/documents/foundation-message/living?project=next'
    );
    expect(root?.querySelector('[data-testid="mktg-family-run"] button')).toBeNull();
    documents.set({ project: 'synthetic', groups: [], approvedFramework: framework });
    harness.detectChanges();
    expect(root?.querySelector('[data-testid="mktg-family-run"] a')?.getAttribute('href')).toBe('/project/mktg-os-agents/boilerplates?project=next&mode=new');
    documents.set({ project: 'synthetic', groups: [] });
    families.update((value) =>
      value.map((family) => ({ ...family, rows: family.rows.map((row) => (row.asset.id === 'faq' ? { ...row, state: 'needs-rebuild' as const } : row)) }))
    );
    harness.detectChanges();
    // Something stale: the shared primary names the update; panel guards still own starting.
    expect(root?.querySelector('[data-testid="mktg-family-run"]')).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-rebuild"] button')?.getAttribute('aria-label')).toBe('Update FAQ');
    expect(root?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-rebuild"] button')?.disabled).toBe(false);
  });
  it('offers quiet Run only for unbuilt rows, with inline blockers and clean project-scoped links', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(
      '/project/mktg-os-agents/families/positioning-brand?project=synthetic&questions=old&generation=old&revision=old&run=old&profile=drop&type=drop&unrelated=drop',
      MktgFamilyComponent
    );
    const root = harness.routeNativeElement;
    // No approved framework: every agent that reads it is greyed out, saying why.
    for (const id of ['boilerplates', 'faq', 'brand-kit']) {
      const button = root?.querySelector<HTMLButtonElement>(`[data-testid="mktg-family-run-${id}"] button`);
      expect(button?.disabled).toBe(true);
      expect(root?.querySelector(`[data-testid="mktg-family-run-reason-${id}"]`)?.textContent).toContain('Approve the messaging framework first');
    }
    documents.set({ project: 'synthetic', groups: [], approvedFramework: framework });
    harness.detectChanges();
    expect(root?.querySelector('[data-testid="mktg-family-run-brand-kit"] a')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/brand-kit?project=synthetic&mode=new'
    );
    expect(root?.querySelector('[data-testid="mktg-family-run-boilerplates"]')?.textContent).toContain('Run boilerplates');
    expect(root?.querySelector('[data-testid="mktg-family-run-messaging-framework"]')).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-run-brand-kit"]')?.textContent).toContain('Run brand kit');
    expect(root?.querySelector('[data-testid="mktg-family-run-faq"]')?.textContent).toContain('Run FAQ');
    expect(root?.querySelector('[data-testid="mktg-family-run-one-pager"]')).toBeNull();
    for (const state of ['approved', 'draft', 'needs-rebuild'] as const) {
      families.update((value) => value.map((family) => ({ ...family, rows: family.rows.map((row) => ({ ...row, state })) })));
      harness.detectChanges();
      expect(root?.querySelector('[data-testid="mktg-family-run-brand-kit"]')).not.toBeNull();
    }
    families.update((value) => value.map((family) => ({ ...family, rows: family.rows.map((row) => ({ ...row, state: 'missing', monthlyCount: null })) })));
    await harness.navigateByUrl('/project/mktg-os-agents/families/website-web', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-aeo-geo"]')).toBeNull();
  });

  it.each(['inactive', 'intake-less'])('omits row actions for %s catalog entries', async (reason) => {
    const saved = MKTG_AGENT_INTAKES['brand-kit'];
    const index = MKTG_AGENTS.findIndex((agent) => agent.id === 'brand-kit');
    const original = MKTG_AGENTS[index];
    if (!original) throw new Error('Missing synthetic catalog target');
    if (reason === 'inactive') MKTG_AGENTS[index] = { ...original, status: 'coming-soon' };
    else delete MKTG_AGENT_INTAKES['brand-kit'];
    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
      expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-brand-kit"]')).toBeNull();
      expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-one-pager"]')).toBeNull();
    } finally {
      MKTG_AGENT_INTAKES['brand-kit'] = saved;
      MKTG_AGENTS[index] = original;
    }
  });

  it.each([
    { agentId: 'foundation-setup', familyId: 'positioning-brand' },
    { agentId: 'member-360', familyId: 'member-sponsor' },
  ])('hides the active $agentId lead header without an intake, regardless of document kind', async ({ agentId, familyId }) => {
    const saved = MKTG_AGENT_INTAKES[agentId];
    const index = MKTG_AGENTS.findIndex((agent) => agent.id === agentId);
    const original = MKTG_AGENTS[index];
    if (!original) throw new Error('Missing synthetic lead agent');
    MKTG_AGENTS[index] = { ...original, status: 'active', guildAgentHandle: 'synthetic-lead-fixture' };
    delete MKTG_AGENT_INTAKES[agentId];
    families.set([]); // No missing/stale rows: exercise the fallback lead control, not the next-agent gate.
    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/project/mktg-os-agents/families/' + familyId, MktgFamilyComponent);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const run = harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button');
      expect(run).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      MKTG_AGENT_INTAKES[agentId] = saved;
      MKTG_AGENTS[index] = original;
    }
  });

  it('shows the play icon only for Create, with no icon element for blocked or review steps', async () => {
    const drafts = families();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic', MktgFamilyComponent);
    // PrimeNG retains a p-hidden placeholder span; it has no glyph or layout gap.
    const icon = () => harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run"] .p-button-icon:not(.p-hidden)');
    expect(icon()).toBeNull(); // Blocked: review and approve the framework.
    families.set(resolveMktgKit({ project: 'synthetic', groups: [] }));
    await harness.fixture.whenStable();
    expect(icon()?.classList.contains('fa-play')).toBe(true);
    families.set(drafts.map((item) => ({ ...item, rows: item.rows.filter((row) => row.document) })));
    await harness.fixture.whenStable();
    expect(icon()).toBeNull(); // Review the existing draft.
  });

  it('reviews the first draft when nothing remains to create, then hides the fresh approved header', async () => {
    families.update((items) => items.map((item) => ({ ...item, rows: item.rows.filter((row) => row.document) })));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand?project=synthetic', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run"] a')?.textContent).toContain('Review the draft');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run"] a')?.getAttribute('href')).toContain(
      '/documents/foundation-message/living?project=synthetic'
    );
    families.update((items) => items.map((item) => ({ ...item, rows: item.rows.map((row) => ({ ...row, state: 'approved' })) })));
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-actions"]')).toBeNull();
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
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-assets"]')).toBeNull();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Title).getTitle()).toBe('Events · LFX');
    await harness.navigateByUrl('/project/mktg-os-agents/families/unknown', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-not-found"]')).not.toBeNull();
  });
  it('hides coming-soon primary actions while preserving their row state', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/website-web', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run"]')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-state-aeo-geo"]')?.textContent).toContain('Coming soon');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-rebuild"]')).toBeNull();
    await harness.navigateByUrl('/project/mktg-os-agents/families/member-sponsor', MktgFamilyComponent);
    const run = harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button');
    expect(run).toBeNull();
    const pending = MKTG_AGENTS.find((agent) => agent.id === 'member-360');
    expect(pending?.status).toBe('coming-soon');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-state-member-360"]')?.textContent).toContain('Coming soon');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-coming-soon"]')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-asset-member-360"]')).not.toBeNull();
  });
  it('never creates a disabled header from pending catalog copy', async () => {
    const family = MKTG_KIT_FAMILIES.find((candidate) => candidate.id === 'member-sponsor');
    if (!family) throw new Error('Missing synthetic family');
    const original = family.pendingAgentName;
    family.pendingAgentName = 'Synthetic pending product';
    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/project/mktg-os-agents/families/member-sponsor', MktgFamilyComponent);
      const run = harness.routeNativeElement?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button');
      expect(run).toBeNull();
    } finally {
      if (original === undefined) delete family.pendingAgentName;
      else family.pendingAgentName = original;
    }
  });

  it('automatically enables the pending first agent when its catalog entry becomes active', async () => {
    const index = MKTG_AGENTS.findIndex((agent) => agent.id === 'member-360');
    const originalAgent = MKTG_AGENTS[index];
    if (!originalAgent) throw new Error('Expected the pending Member 360 test catalog entry');
    MKTG_AGENTS[index] = { ...originalAgent, status: 'active', name: 'Synthetic Member Agent', guildAgentHandle: 'member-360' };
    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/project/mktg-os-agents/families/member-sponsor?project=synthetic', MktgFamilyComponent);
      const run = harness.routeNativeElement?.querySelector<HTMLAnchorElement>('[data-testid="mktg-family-run"] a');
      expect(run?.textContent).toContain('Create Member 360');
      expect(run?.getAttribute('href')).toBe('/project/mktg-os-agents/member-360?project=synthetic');
      expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-unavailable"]')).toBeNull();
      expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run-next"]')).toBeNull();
    } finally {
      MKTG_AGENTS[index] = originalAgent;
    }
  });
  it.each(['social-community', 'member-sponsor'])('keeps Create for %s while moving built-row actions to the document', async (familyId) => {
    MKTG_AGENTS.splice(0, MKTG_AGENTS.length, ...originalAgents);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/' + familyId + '?project=synthetic&mode=new&run=stale', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    const row = families().find((item) => item.family.id === familyId)?.rows[0];
    if (!row?.asset.agentKey) throw new Error('Missing synthetic one-off');
    const action = () => root?.querySelector<HTMLAnchorElement>(`[data-testid="mktg-family-run-${row.asset.id}"] a`);
    expect(action()?.textContent).toContain('Run ' + (row.asset.runName ?? row.asset.label));
    expect(action()?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/' + row.asset.agentKey + '?project=synthetic' + (familyId === 'social-community' ? '&mode=new' : '')
    );
    expect(root?.querySelector('[data-testid="mktg-family-run"] a')?.textContent).toContain('Create ' + (row.asset.runName ?? row.asset.label));
    families.update((items) =>
      items.map((item) => ({
        ...item,
        rows: item.rows.map((candidate) =>
          candidate === row
            ? {
                ...candidate,
                state: null,
                document: {
                  agentKey: row.asset.agentKey ?? 'linkedin-post',
                  documentId: 'run-synthetic',
                  revisionCount: 1,
                  latestRevisionId: 'synthetic',
                  approvedCurrent: null,
                  createdAt: '2026-10-10T12:00:00Z',
                  updatedAt: null,
                },
              }
            : candidate
        ),
      }))
    );
    await harness.fixture.whenStable();
    expect(action()).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-run"] a')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/' + row.asset.agentKey + '?project=synthetic'
    );
    expect(root?.querySelector('[data-testid="mktg-family-run-next"]')).toBeNull();
  });
  it.each([
    { familyId: 'positioning-brand', label: 'Run messaging framework' },
    { familyId: 'social-community', label: 'Run LinkedIn posts' },
  ])('a denied $familyId listing hides the header without exposing document state', async ({ familyId }) => {
    writer.set(false);
    error.set('You need write access to this project to see its Marketing kit.');
    accessDenied.set(true);
    families.set([]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/' + familyId + '?project=synthetic', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    expect(root?.querySelector('[data-testid="mktg-family-actions"]')).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-assets"]')).toBeNull();
    accessDenied.set(false);
    error.set('The Marketing kit could not be loaded.');
    await harness.fixture.whenStable();
    expect(root?.querySelector('[data-testid="mktg-family-actions"]')).toBeNull();
  });
  it('announces exactly the primary step in its accessible name', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/social-community?project=synthetic', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-run"] a')?.getAttribute('aria-label')).toBe('Create LinkedIn post');
  });
  it('keeps a one-off Current date in UTC at a local month boundary', async () => {
    TestBed.overrideProvider(DATE_PIPE_DEFAULT_OPTIONS, { useValue: { timezone: 'America/Los_Angeles' } });
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'linkedin-post');
    if (!type) throw new Error('Missing synthetic one-off type');
    families.set(
      resolveMktgKit(
        {
          project: 'synthetic',
          groups: [
            {
              type,
              documents: [
                {
                  agentKey: 'linkedin-post',
                  documentId: 'run-synthetic',
                  revisionCount: 1,
                  latestRevisionId: 'synthetic',
                  approvedCurrent: null,
                  createdAt: '2026-10-01T00:30:00Z',
                  updatedAt: null,
                },
              ],
            },
          ],
        },
        new Date('2026-10-01T01:00:00Z')
      )
    );
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/social-community?project=synthetic', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-current-linkedin-post"]')?.textContent).toContain('1 Oct');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-state-linkedin-post"]')?.textContent).toContain('1 this month');
  });
  it('modifier clicks stay native on both header and row Run links, without host navigation', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/social-community?project=synthetic', MktgFamilyComponent);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    for (const id of ['mktg-family-run', 'mktg-family-run-linkedin-post']) {
      const anchor = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(`[data-testid="${id}"] a`);
      expect(anchor?.getAttribute('href')).toBe('/project/mktg-os-agents/linkedin-post?project=synthetic' + (id === 'mktg-family-run' ? '' : '&mode=new'));
      anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    }
    expect(navigate).not.toHaveBeenCalled();
  });
  it('hides the reader header, explains row blockers inline, and restores anchors for writers', async () => {
    writer.set(false);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/social-community?project=synthetic', MktgFamilyComponent);
    const root = harness.routeNativeElement;
    const header = root?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run"] button');
    expect(header).toBeNull();
    expect(root?.querySelector('[data-testid="mktg-family-run-reason-linkedin-post"]')?.textContent).toBe(
      'You need write access to this project to run its agents'
    );
    expect(root?.querySelector<HTMLButtonElement>('[data-testid="mktg-family-run-linkedin-post"] button')?.disabled).toBe(true);
    writer.set(true);
    await harness.fixture.whenStable();
    expect(root?.querySelector('[data-testid="mktg-family-run"] a')?.getAttribute('href')).toBe('/project/mktg-os-agents/linkedin-post?project=synthetic');
  });
  it('defensively renders no-project while isolated from lens navigation', async () => {
    families.set([]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-no-project"]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-assets"]')).toBeNull();
  });
  it('looks up the last export before the family document list finishes', async () => {
    writer.set(true);
    loading.set(true);
    families.set([]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
    await harness.fixture.whenStable();
    expect(lastExport).toHaveBeenCalledWith({ project: 'synthetic', familyId: 'positioning-brand' }, true);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-loading"]')).not.toBeNull();
  });
  it('keeps the loading status node mounted while changing its announcement', async () => {
    loading.set(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
    const status = harness.routeNativeElement?.querySelector('[data-testid="mktg-family-loading"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain('Loading family assets');
    loading.set(false);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-loading"]')).toBe(status);
    expect(status?.textContent).toBe('');
    loading.set(true);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-loading"]')).toBe(status);
    expect(status?.textContent).toContain('Loading family assets');
  });
  it('hides every header action until the kit read resolves and on error', async () => {
    loading.set(true);
    families.set([]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/families/positioning-brand', MktgFamilyComponent);
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-loading"]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-actions"]')).toBeNull();
    loading.set(false);
    error.set('You need write access.');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain('write access');
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-assets"]')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('[data-testid="mktg-family-actions"]')).toBeNull();
  });
});
