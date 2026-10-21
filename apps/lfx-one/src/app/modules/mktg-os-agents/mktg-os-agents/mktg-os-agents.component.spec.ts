// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { MKTG_AGENTS, MKTG_DOCUMENT_TYPES, MKTG_KIT_EXCLUDED_AGENT_IDS } from '@lfx-one/shared/constants';
import { MktgAgent, MktgDependencyDocument, MktgDocumentsResponse, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgOsAgentsComponent } from './mktg-os-agents.component';

/** Last-run dates and dependency gating follow the active project, including late context and re-entry. */
describe('MktgOsAgentsComponent — catalog states and listing dates', () => {
  const PROJECT_1: ProjectContext = { uid: 'proj-1', name: 'Project One', slug: 'proj-one' };
  const PROJECT_2: ProjectContext = { uid: 'proj-2', name: 'Project Two', slug: 'proj-two' };

  let fixture: ComponentFixture<MktgOsAgentsComponent>;
  let activeContext: WritableSignal<ProjectContext | null>;
  let listDocuments: ReturnType<typeof vi.fn>;
  let resolveDependencies: ReturnType<typeof vi.fn>;
  /** Synthetic last-run day per project; other agents have no document. */
  let brandKitRunDays: Record<string, number>;
  /** Resolved dependency document per `<projectUid>:<agentId>`, returned by the mocked dependency service. */
  let dependencyDocs: Record<string, MktgDependencyDocument>;
  /** Stand-in for the service's run-completed notifications. */
  let documentsChanged: Subject<string>;

  function listing(project: string, day?: number): MktgDocumentsResponse {
    return {
      project,
      groups: MKTG_DOCUMENT_TYPES.map((type) => ({
        type,
        documents:
          type.agentKey === 'brand-kit' && day
            ? [
                {
                  agentKey: type.agentKey,
                  documentId: 'living',
                  revisionCount: 99,
                  latestRevisionId: '000003-' + 'a'.repeat(64),
                  approvedCurrent: null,
                  createdAt: null,
                  updatedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
                },
              ]
            : [],
      })),
    };
  }

  function lastRun(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="mktg-os-agents-last-run-brand-kit"]');
  }

  beforeEach(async () => {
    activeContext = signal<ProjectContext | null>(null);
    brandKitRunDays = {};
    dependencyDocs = {};
    documentsChanged = new Subject<string>();
    listDocuments = vi.fn((project: string) => of(listing(project, brandKitRunDays[project])));
    resolveDependencies = vi.fn((projectUid: string, agentIds: string[]) =>
      of(Object.fromEntries(agentIds.map((agentId) => [agentId, dependencyDocs[`${projectUid}:${agentId}`] ?? null])))
    );

    await TestBed.configureTestingModule({
      imports: [MktgOsAgentsComponent],
      providers: [
        // A catch-all so the re-entry test can perform a REAL navigation and
        // get a genuine NavigationEnd, rather than pushing one into the
        // router's event subject by hand.
        provideRouter([{ path: '**', children: [] }]),
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext } },
        { provide: MktgDocumentStoreService, useValue: { listDocuments } },
        { provide: MktgDependencyService, useValue: { resolveDependencies, documentsChanged$: documentsChanged.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MktgOsAgentsComponent);
    await fixture.whenStable();
  });

  it('keeps the relocated grid usable: selecting an active card targets the sibling run route', async () => {
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(root.querySelector('[data-testid="mktg-breadcrumb-current"]')?.textContent).toBe('Agents');
    expect(root.querySelector('[data-testid="mktg-breadcrumb-link-0"]')?.getAttribute('href')).toContain('project=proj-one');
    const button = root.querySelector<HTMLButtonElement>('[data-testid="mktg-os-agents-tile-foundation-setup"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(navigate).toHaveBeenCalledWith(['../', 'foundation-setup'], expect.objectContaining({ queryParamsHandling: 'preserve' }));
  });

  it('clears resolving and shows the defensive message when project context is absent', async () => {
    const root: HTMLElement = fixture.nativeElement;
    expect(listDocuments).not.toHaveBeenCalled();
    expect(fixture.componentInstance['resolving']()).toBe(false);
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-os-agents-results"]')).not.toBeNull();
    activeContext.set(null);
    await fixture.whenStable();
    expect(fixture.componentInstance['resolving']()).toBe(false);
    expect(fixture.componentInstance['documents']()).toBeNull();
    expect(root.querySelector('[data-testid="mktg-os-agents-results"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-os-agents-no-project"]')?.textContent).toBe('Select a project to see its Marketing kit.');
  });

  it('groups board agents with the framework first, Boilerplates next; no standalone ICP or Website Builder', async () => {
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('[data-testid^="mktg-os-agents-run-order-"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-testid^="mktg-os-agents-tile-"]')).toHaveLength(
      MKTG_AGENTS.filter((agent) => !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id)).length
    );
    expect(root.querySelectorAll('section')).toHaveLength(5);
    expect(root.querySelector('[data-testid="mktg-os-agents-family-events"]')).toBeNull();
    const first = root.querySelector('[data-testid="mktg-os-agents-family-positioning-brand"]');
    expect(first?.textContent).toContain('Run in order: framework first');
    expect(Array.from(first?.querySelectorAll('button') ?? []).map((button) => button.getAttribute('data-testid'))).toEqual([
      'mktg-os-agents-tile-foundation-setup',
      'mktg-os-agents-tile-boilerplates',
      'mktg-os-agents-tile-faq',
      'mktg-os-agents-tile-brand-kit',
    ]);
  });

  it('keeps resolving tiles neutral and disabled until the snapshot completes', async () => {
    const pending = new Subject<MktgDocumentsResponse>();
    listDocuments.mockReturnValueOnce(pending);
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const tile = root.querySelector<HTMLButtonElement>('[data-testid="mktg-os-agents-tile-foundation-setup"]');
    expect(tile?.disabled).toBe(true);
    expect(tile?.getAttribute('aria-label')).toContain('Resolving');
    expect(root.querySelector('[data-testid="mktg-os-agents-state-foundation-setup"]')?.textContent).toContain('—');
    expect(root.textContent).not.toContain('Needs an approved framework');
    pending.next(listing('proj-1'));
    pending.complete();
    await fixture.whenStable();
    expect(tile?.disabled).toBe(false);
    expect(tile?.getAttribute('aria-label')).toBe('Messaging Framework Agent — Live');
  });

  it('shows a listing date after late context, with no search/Documents control or generated badge', async () => {
    expect(lastRun()).toBeNull();
    brandKitRunDays = { 'proj-1': 2 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(lastRun()?.textContent).toContain('Last run 2 Oct');
    expect(fixture.nativeElement.querySelector('lfx-input-text')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-os-agents-documents-link"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('generated');
  });

  it('reloads dates on a project switch, not the previous project’s version count', async () => {
    brandKitRunDays = { 'proj-1': 3, 'proj-2': 1 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(lastRun()?.textContent).toContain('Last run 3 Oct');
    activeContext.set(PROJECT_2);
    await fixture.whenStable();
    expect(listDocuments).toHaveBeenCalledWith('proj-2');
    expect(lastRun()?.textContent).toContain('Last run 1 Oct');
  });

  it('clears dates for a project with no documents or after deselection', async () => {
    brandKitRunDays = { 'proj-1': 2 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(lastRun()).not.toBeNull();
    activeContext.set(PROJECT_2);
    await fixture.whenStable();
    expect(lastRun()).toBeNull();
    activeContext.set(null);
    await fixture.whenStable();
    expect(lastRun()).toBeNull();
  });

  it('does not reload for the same uid and does not invent dates after a failed read', async () => {
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const calls = listDocuments.mock.calls.length;
    activeContext.set({ ...PROJECT_1 });
    await fixture.whenStable();
    expect(listDocuments.mock.calls.length).toBe(calls);
    listDocuments.mockReturnValueOnce(throwError(() => new Error('synthetic listing failure')));
    activeContext.set(PROJECT_2);
    await fixture.whenStable();
    expect(lastRun()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-os-agents-error"]')).not.toBeNull();
  });

  /**
   * No live agent depends on another today: the Messaging Framework runs first
   * and needs nothing, and Brand Guidelines — the next agent to gate, on the
   * stored Messaging Framework — is not in the catalog yet. The gate is
   * exercised on a TEST-ONLY dependency in that same direction: the Brand Kit
   * card requiring the project's Messaging Framework.
   */
  describe('dependency gating (dec-agent-dependency-gating) — a gated card follows the stored document it requires', () => {
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const gatedAgent = MKTG_AGENTS.find((agent) => agent.id === 'brand-kit') as MktgAgent;
    const mfTile = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('[data-testid="mktg-os-agents-tile-brand-kit"]');
    const requiresTag = (): HTMLElement | null => host().querySelector('[data-testid="mktg-os-agents-state-brand-kit"]');
    const kitDoc = (source: 'server' | 'browser' = 'server'): MktgDependencyDocument => ({
      agentId: 'foundation-setup',
      source,
      version: 2,
      document: '{"mf":{},"icp":[],"mh":{},"nums":[]}',
    });

    beforeEach(async () => {
      gatedAgent.dependsOn = ['foundation-setup'];
      // The catalog's dependencies are read when the grid is created, so it is
      // created again with the test-only one — the first grid is destroyed so
      // only one instance resolves.
      fixture.destroy();
      fixture = TestBed.createComponent(MktgOsAgentsComponent);
      await fixture.whenStable();
    });

    afterEach(() => {
      delete gatedAgent.dependsOn;
    });

    it('disables the card with a "Requires Messaging framework" tag while the active project has none stored', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(mfTile()?.disabled).toBe(true);
      expect(requiresTag()?.textContent).toContain('Needs an approved framework');
      expect(mfTile()?.getAttribute('aria-label')).toContain('Needs an approved framework');
      // The Messaging Framework Agent card itself runs first and stays clickable.
      expect(host().querySelector<HTMLButtonElement>('[data-testid="mktg-os-agents-tile-foundation-setup"]')?.disabled).toBe(false);
    });

    it('keeps an unresolved dependency gated and retries on the next refresh', async () => {
      resolveDependencies.mockReturnValueOnce(of({ 'foundation-setup': null }));
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(mfTile()?.disabled).toBe(true);
      dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
      documentsChanged.next(PROJECT_1.uid);
      await fixture.whenStable();
      expect(mfTile()?.disabled).toBe(false);
    });

    it('enables the card once the dependency resolves for the active project (server-persisted kit)', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['foundation-setup'], [], true);
      expect(mfTile()?.disabled).toBe(false);
      expect(requiresTag()?.textContent).toContain('Live');
    });

    it('keeps the card locked when the approved-only service omits browser Drafts', async () => {
      dependencyDocs = {};
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['foundation-setup'], [], true);
      expect(mfTile()?.disabled).toBe(true);
    });

    it('gives every card an accessible name that states the reason it is inert', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // Disabled by a missing dependency: the accessible name carries the same
      // reason as the visible "Requires Messaging framework" tag.
      expect(mfTile()?.getAttribute('aria-label')).toBe('Brand Kit Agent — Needs an approved framework');
      // Disabled for having no live agent yet — never described as dependency-blocked.
      expect(host().querySelector('[data-testid="mktg-os-agents-tile-pitch-deck"]')?.getAttribute('aria-label')).toBe('Pitch Deck Agent — Coming soon');
      // Enabled cards announce the action instead.
      expect(host().querySelector('[data-testid="mktg-os-agents-tile-foundation-setup"]')?.getAttribute('aria-label')).toBe('Messaging Framework Agent — Live');
    });

    it('does not surface standalone ICP or Website Builder even though the catalog retains them', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(host().querySelector('[data-testid="mktg-os-agents-tile-icp"]')).toBeNull();
      expect(host().querySelector('[data-testid="mktg-os-agents-tile-website-builder"]')).toBeNull();
    });

    it('switches the gated card to its action name once the dependency resolves', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(mfTile()?.getAttribute('aria-label')).toBe('Brand Kit Agent — Live');
    });

    /**
     * A live demo found a gated card still locked after the run it waited on
     * finished: the gating only ever resolved on a project-uid
     * change, so the only way to see a freshly generated Brand Kit was a full
     * page reload. Generating a document and walking back to the grid is the
     * ORDINARY path through this marketplace — it has to unlock without one.
     */
    describe('staleness — the grid re-resolves instead of waiting for a reload', () => {
      it('unlocks the card when a run completes while the grid is showing', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(mfTile()?.disabled).toBe(true);

        // The run page finished the required document for this project.
        dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
        documentsChanged.next('proj-1');
        await fixture.whenStable();

        expect(mfTile()?.disabled).toBe(false);
      });

      it('re-resolves when the marketplace becomes active again (returning from a run page)', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        const callsOnEntry = resolveDependencies.mock.calls.length;
        expect(mfTile()?.disabled).toBe(true);

        // The document was generated while the user was on the run page; the
        // grid only learns about it by re-resolving on the way back.
        dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
        await TestBed.inject(Router).navigateByUrl('/mktg-os-agents');
        await fixture.whenStable();

        expect(resolveDependencies.mock.calls.length).toBeGreaterThan(callsOnEntry);
        expect(mfTile()?.disabled).toBe(false);
      });

      it('resolves exactly once on first load — the refresh trigger must not double-fetch', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();

        expect(resolveDependencies).toHaveBeenCalledTimes(1);
      });

      it('ignores a completion notification for a DIFFERENT project', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        const callsOnEntry = resolveDependencies.mock.calls.length;

        documentsChanged.next('proj-2');
        await fixture.whenStable();

        expect(resolveDependencies.mock.calls.length).toBe(callsOnEntry);
      });

      it('keeps the current snapshot unlocked during a same-project refresh without relock flicker', async () => {
        dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(mfTile()?.disabled).toBe(false);

        const pending = new Subject<Record<string, MktgDependencyDocument | null>>();
        resolveDependencies.mockReturnValueOnce(pending.asObservable());
        documentsChanged.next('proj-1');
        await fixture.whenStable();
        expect(mfTile()?.disabled).toBe(false);
        expect(requiresTag()?.textContent).toContain('Live');
        expect(requiresTag()?.textContent).not.toContain('Needs');
        pending.next({ 'foundation-setup': kitDoc() });
        pending.complete();
        await fixture.whenStable();
        expect(mfTile()?.disabled).toBe(false);
      });
    });

    it('re-evaluates on project switch — a document on one project never unlocks another', async () => {
      dependencyDocs = { 'proj-1:foundation-setup': kitDoc() };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(mfTile()?.disabled).toBe(false);

      activeContext.set(PROJECT_2);
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-2', ['foundation-setup'], [], true);
      expect(mfTile()?.disabled).toBe(true);
      expect(requiresTag()).not.toBeNull();
    });
  });
});
