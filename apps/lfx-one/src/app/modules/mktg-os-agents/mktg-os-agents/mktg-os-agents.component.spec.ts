// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MktgStoredAgentRun, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgOsAgentsComponent } from './mktg-os-agents.component';

/**
 * The "vN generated" badges must follow the ACTIVE project, not the first
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
  /** Latest stored-run version per projectUid for the brand-kit agent; other agents have none. */
  let brandKitVersions: Record<string, number>;

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
    loadRun = vi.fn((projectUid: string, agentId: string) => {
      const version = brandKitVersions[projectUid];
      return agentId === 'brand-kit' && version ? storedRun(projectUid, version) : null;
    });

    await TestBed.configureTestingModule({
      imports: [MktgOsAgentsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext } },
        { provide: MktgAgentRunService, useValue: { loadRun } },
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
});
