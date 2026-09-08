// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { MktgDependencyDocument, MktgStoredAgentRun, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgOsAgentsComponent } from './mktg-os-agents.component';

/**
 * The "vN generated" badges AND the dependency gating
 * (dec-agent-dependency-gating) must follow the ACTIVE project, not the first
 * render: the project selector reuses this component on a switch (it only
 * rewrites ?project= via Location.replaceState — no navigation), and the
 * context can also resolve only after the first render. A one-shot load
 * would show one project's versions on another project's marketplace, or no
 * badges at all — the two regressions locked down here.
 */
describe('MktgOsAgentsComponent — stored-version badges follow the active project', () => {
  const PROJECT_1: ProjectContext = { uid: 'proj-1', name: 'Project One', slug: 'proj-one' };
  const PROJECT_2: ProjectContext = { uid: 'proj-2', name: 'Project Two', slug: 'proj-two' };

  let fixture: ComponentFixture<MktgOsAgentsComponent>;
  let activeContext: WritableSignal<ProjectContext | null>;
  let loadRun: ReturnType<typeof vi.fn>;
  let resolveDependencies: ReturnType<typeof vi.fn>;
  /** Latest stored-run version per projectUid for the brand-kit agent; other agents have none. */
  let brandKitVersions: Record<string, number>;
  /** Resolved dependency document per `<projectUid>:<agentId>`, returned by the mocked dependency service. */
  let dependencyDocs: Record<string, MktgDependencyDocument>;
  /** Stand-in for the service's run-completed notifications. */
  let documentsChanged: Subject<string>;

  function storedRun(projectUid: string, version: number): MktgStoredAgentRun {
    return {
      agentId: 'brand-kit',
      projectUid,
      sessionId: `sess-${projectUid}`,
      ownerToken: `token-${projectUid}`,
      answers: {},
      versions: [{ version, document: '# Doc', createdAt: '2026-08-19T00:00:00.000Z' }],
      savedAt: '2026-08-19T00:00:00.000Z',
    };
  }

  function badge(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="mktg-os-agents-generated-brand-kit"]');
  }

  beforeEach(async () => {
    activeContext = signal<ProjectContext | null>(null);
    brandKitVersions = {};
    dependencyDocs = {};
    documentsChanged = new Subject<string>();
    loadRun = vi.fn((projectUid: string, agentId: string) => {
      const version = brandKitVersions[projectUid];
      return agentId === 'brand-kit' && version ? storedRun(projectUid, version) : null;
    });
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
        { provide: MktgAgentRunService, useValue: { loadRun } },
        { provide: MktgDependencyService, useValue: { resolveDependencies, documentsChanged$: documentsChanged.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MktgOsAgentsComponent);
    await fixture.whenStable();
  });

  it('shows the badge once the context resolves AFTER the first render — a one-shot load would never badge at all', async () => {
    // First render with no context yet (activeContextUid was empty at
    // afterNextRender time in the regressed one-shot implementation).
    expect(badge()).toBeNull();

    brandKitVersions = { 'proj-1': 2 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();

    expect(badge()?.textContent).toContain('v2 generated');
  });

  it('reloads the badges on an in-app project switch instead of keeping the previous project versions', async () => {
    brandKitVersions = { 'proj-1': 3, 'proj-2': 1 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(badge()?.textContent).toContain('v3 generated');

    // The selector reuses this component — only the context signal changes.
    activeContext.set(PROJECT_2);
    await fixture.whenStable();

    expect(loadRun).toHaveBeenCalledWith('proj-2', 'brand-kit');
    expect(badge()?.textContent).toContain('v1 generated');
  });

  it('clears the badges when the switched-to project has no stored runs', async () => {
    brandKitVersions = { 'proj-1': 2 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    expect(badge()).not.toBeNull();

    activeContext.set(PROJECT_2);
    await fixture.whenStable();

    expect(badge()).toBeNull();
  });

  it('does not reload when the context re-emits the same uid (Location.replaceState churn)', async () => {
    brandKitVersions = { 'proj-1': 2 };
    activeContext.set(PROJECT_1);
    await fixture.whenStable();
    const callsAfterFirstLoad = loadRun.mock.calls.length;

    activeContext.set({ ...PROJECT_1 });
    await fixture.whenStable();

    expect(loadRun.mock.calls.length).toBe(callsAfterFirstLoad);
  });

  describe('dependency gating (dec-agent-dependency-gating) — the Message Foundation card follows the stored Brand Kit', () => {
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const mfTile = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('[data-testid="mktg-os-agents-tile-foundation-setup"]');
    const requiresTag = (): HTMLElement | null => host().querySelector('[data-testid="mktg-os-agents-requires-foundation-setup"]');
    const kitDoc = (source: 'server' | 'browser' = 'server'): MktgDependencyDocument => ({
      agentId: 'brand-kit',
      source,
      version: 2,
      document: '# Kit',
    });

    it('disables the card with a "Requires Brand Kit" tag while the active project has no stored Brand Kit', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(mfTile()?.disabled).toBe(true);
      expect(requiresTag()?.textContent).toContain('Requires Brand Kit');
      expect(mfTile()?.getAttribute('aria-label')).toContain('requires Brand Kit');
      // The independent Brand Kit Agent card itself stays clickable.
      expect(host().querySelector<HTMLButtonElement>('[data-testid="mktg-os-agents-tile-brand-kit"]')?.disabled).toBe(false);
    });

    it('enables the card once the dependency resolves for the active project (server-persisted kit)', async () => {
      dependencyDocs = { 'proj-1:brand-kit': kitDoc() };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-1', ['brand-kit']);
      expect(mfTile()?.disabled).toBe(false);
      expect(requiresTag()).toBeNull();
    });

    it('enables the card from the browser-stored fallback when server persistence has none', async () => {
      dependencyDocs = { 'proj-1:brand-kit': kitDoc('browser') };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(mfTile()?.disabled).toBe(false);
    });

    it('gives every card an accessible name that states the reason it is inert', async () => {
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      // Disabled by a missing dependency: the accessible name carries the same
      // reason as the visible "Requires Brand Kit" tag.
      expect(mfTile()?.getAttribute('aria-label')).toBe('Message Foundation Agent (requires Brand Kit)');
      // Disabled for having no live agent yet — never described as dependency-blocked.
      expect(host().querySelector('[data-testid="mktg-os-agents-tile-icp"]')?.getAttribute('aria-label')).toBe('ICP Agent (coming soon)');
      // Enabled cards announce the action instead.
      expect(host().querySelector('[data-testid="mktg-os-agents-tile-brand-kit"]')?.getAttribute('aria-label')).toBe('Open Brand Kit Agent');
    });

    it('switches the gated card to its action name once the dependency resolves', async () => {
      dependencyDocs = { 'proj-1:brand-kit': kitDoc() };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();

      expect(mfTile()?.getAttribute('aria-label')).toBe('Open Message Foundation Agent');
    });

    /**
     * A live demo found the Message Foundation card still locked after the
     * Brand Kit run finished: the gating only ever resolved on a project-uid
     * change, so the only way to see a freshly generated Brand Kit was a full
     * page reload. Generating a document and walking back to the grid is the
     * ORDINARY path through this marketplace — it has to unlock without one.
     */
    describe('staleness — the grid re-resolves instead of waiting for a reload', () => {
      it('unlocks the card when a run completes while the grid is showing', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(mfTile()?.disabled).toBe(true);

        // The run page finished a Brand Kit for this project.
        dependencyDocs = { 'proj-1:brand-kit': kitDoc() };
        documentsChanged.next('proj-1');
        await fixture.whenStable();

        expect(mfTile()?.disabled).toBe(false);
      });

      it('re-resolves when the marketplace becomes active again (returning from a run page)', async () => {
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        const callsOnEntry = resolveDependencies.mock.calls.length;
        expect(mfTile()?.disabled).toBe(true);

        // The Brand Kit was generated while the user was on the run page; the
        // grid only learns about it by re-resolving on the way back.
        dependencyDocs = { 'proj-1:brand-kit': kitDoc() };
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

      it('keeps the unlocked card unlocked while a refresh is in flight — no relock flicker', async () => {
        dependencyDocs = { 'proj-1:brand-kit': kitDoc() };
        activeContext.set(PROJECT_1);
        await fixture.whenStable();
        expect(mfTile()?.disabled).toBe(false);

        // A refresh that never resolves: the card must not flash back to locked.
        resolveDependencies.mockReturnValueOnce(new Subject<Record<string, MktgDependencyDocument | null>>().asObservable());
        documentsChanged.next('proj-1');
        await fixture.whenStable();

        expect(mfTile()?.disabled).toBe(false);
      });
    });

    it('re-evaluates on project switch — a kit on one project never unlocks another', async () => {
      dependencyDocs = { 'proj-1:brand-kit': kitDoc() };
      activeContext.set(PROJECT_1);
      await fixture.whenStable();
      expect(mfTile()?.disabled).toBe(false);

      activeContext.set(PROJECT_2);
      await fixture.whenStable();

      expect(resolveDependencies).toHaveBeenCalledWith('proj-2', ['brand-kit']);
      expect(mfTile()?.disabled).toBe(true);
      expect(requiresTag()).not.toBeNull();
    });
  });
});
