// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_OS_AGENTS_LABEL } from '@lfx-one/shared/constants';
import { MktgAgent, MktgAgentAccent, MktgAgentTile, MktgDependencyDocument, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { distinctUntilChanged, filter, map, merge, Observable, of, switchMap } from 'rxjs';

// Marketplace landing for the Marketing OS marketplace (approved form-first
// design): catalog grid with client-side search, "Coming soon" tags on
// disabled cards, a "vN generated" badge on agents with stored output, and
// dependency gating (dec-agent-dependency-gating): an agent that `dependsOn`
// another stays disabled — tagged "Requires <document>" — until every
// dependency has stored output for the ACTIVE project (server-persisted
// preferred, browser-stored run fallback), re-evaluated on project switch.
// Card clicks route to the per-agent run page (/:agentId) — the form-first
// run shell that replaced the earlier in-page chat-panel approach.
@Component({
  selector: 'lfx-mktg-os-agents',
  imports: [NgClass, ReactiveFormsModule, InputTextComponent, TagComponent, EmptyStateComponent],
  templateUrl: './mktg-os-agents.component.html',
})
export class MktgOsAgentsComponent {
  // === Injections ===
  private readonly dependencyService = inject(MktgDependencyService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runService = inject(MktgAgentRunService);

  // toObservable needs the injection context — created here, subscribed
  // (browser only) in the constructor. Same pattern as the run page.
  private readonly activeContext$ = toObservable(this.projectContext.activeContext);

  // === Constants ===
  protected readonly labels = MKTG_OS_AGENTS_LABEL;

  // === Forms ===
  protected readonly searchForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
  });

  // === Signals ===
  // Stored-output version count per agent id for the active project. Read from
  // localStorage after hydration only, so SSR output stays badge-free and stable.
  protected readonly storedVersions = signal<Record<string, number>>({});
  /**
   * Resolved stored output per DEPENDENCY agent id for the active project
   * (dec-agent-dependency-gating): server-persisted preferred, browser-stored
   * run fallback. Starts empty and clears on every project switch, so
   * dependent cards are disabled (fail-closed) until resolution lands — on
   * SSR they stay disabled, matching the badge-free SSR output.
   */
  protected readonly dependencyDocs = signal<Record<string, MktgDependencyDocument | null>>({});

  private readonly searchTerm = toSignal(this.searchForm.controls.search.valueChanges, { initialValue: '' });

  // === Computed ===
  protected readonly tiles: Signal<MktgAgentTile[]> = this.initTiles();

  // === Catalog-derived (static for the component's lifetime) ===
  /** Every dependency agent id referenced by the catalog — resolved once per active project. */
  private readonly catalogDependencyIds: string[] = [...new Set(MKTG_AGENTS.flatMap((agent) => agent.dependsOn ?? []))];

  // Accent → Tailwind classes. Kept as class fields (not module-level) with literal
  // class names so Tailwind's content scan (./src/**/*.ts) generates them.
  private readonly accentIcon: Record<MktgAgentAccent, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  private readonly accentBorder: Record<MktgAgentAccent, string> = {
    blue: 'border-l-blue-500',
    emerald: 'border-l-emerald-500',
    violet: 'border-l-violet-500',
    amber: 'border-l-amber-500',
    red: 'border-l-red-500',
    gray: 'border-l-gray-300',
  };

  /**
   * Navigation that put this component on screen. Everything AFTER it is a
   * re-entry (or a return from an agent's run page) worth re-resolving on;
   * this one is already covered by the stream's own first resolution, so
   * excluding it is what keeps the first load down to a single fetch.
   */
  private readonly entryNavigationId: number = this.router.getCurrentNavigation()?.id ?? 0;

  public constructor() {
    // Stored-run badges read localStorage per project, and the project selector
    // reuses this component on a switch (it only rewrites ?project= via
    // Location.replaceState — no navigation), so the badges must follow the
    // active context, never a one-shot first render: a one-shot would keep the
    // previous project's versions after a switch and would never load at all
    // when the context resolves after the first render. Browser-only so SSR
    // output stays badge-free and stable; the first emission lands
    // post-hydration. Same pattern as the run page's restore/prefill.
    if (isPlatformBrowser(this.platformId)) {
      this.activeContext$
        .pipe(
          filter((context): context is ProjectContext => !!context),
          distinctUntilChanged((previous, current) => previous.uid === current.uid),
          switchMap((context) => {
            // Clear first so a project with no stored runs never keeps the
            // previous project's badges or dependency gating. Only on a
            // project CHANGE — a refresh must not flash every dependent card
            // back to locked while it re-resolves.
            this.storedVersions.set({});
            this.dependencyDocs.set({});
            // switchMap drops a stale in-flight resolution on project switch,
            // so the gating always reflects the CURRENT active project. The
            // inner stream resolves once immediately (`of`, synchronous — no
            // double fetch) and again on every refresh trigger.
            return merge(of(context.uid), this.refreshTriggers(context.uid)).pipe(
              switchMap(() => {
                this.loadStoredVersions(context.uid);
                return this.dependencyService.resolveDependencies(context.uid, this.catalogDependencyIds);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((dependencies) => this.dependencyDocs.set(dependencies));
    }
  }

  // === Protected methods ===
  protected onSelectAgent(tile: MktgAgentTile): void {
    // Only enabled tiles have a run page: `coming-soon` tiles and dependency-
    // gated tiles (dec-agent-dependency-gating) are inert.
    if (tile.disabled) {
      return;
    }
    this.router.navigate([tile.agent.id], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  // === Private initializers ===
  /**
   * When the marketplace must re-resolve its dependency gating for the active
   * project, beyond the resolution it does on arrival:
   *
   * 1. **A run completed.** Generating a Brand Kit stores the very document
   *    its dependents are gated on — leaving the grid on the old answer would
   *    keep the Message Foundation card locked over a document that exists.
   * 2. **The marketplace became active again.** Returning from a run page is
   *    the ordinary way a user reaches the grid after generating something,
   *    and it is exactly then that the gating is most likely stale. Navigation
   *    events cover it whether this instance is rebuilt or kept alive by the
   *    router's reuse strategy; the navigation that mounted us is excluded, so
   *    first load still resolves exactly once.
   */
  private refreshTriggers(projectUid: string): Observable<string> {
    const runCompleted$ = this.dependencyService.documentsChanged$.pipe(filter((changedUid) => changedUid === projectUid));
    const reentry$ = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      filter((event) => event.id !== this.entryNavigationId),
      map(() => projectUid)
    );
    return merge(runCompleted$, reentry$);
  }

  private initTiles(): Signal<MktgAgentTile[]> {
    return computed(() => {
      const term = this.searchTerm().trim().toLowerCase();
      const matches = term
        ? MKTG_AGENTS.filter(
            (agent) =>
              agent.name.toLowerCase().includes(term) ||
              agent.description.toLowerCase().includes(term) ||
              agent.tags.some((tag) => tag.toLowerCase().includes(term))
          )
        : MKTG_AGENTS;

      const dependencies = this.dependencyDocs();
      return matches.map((agent) => {
        const accent = agent.accent ?? 'gray';
        // Dependency gating (dec-agent-dependency-gating): a dependent agent is
        // disabled until every dependency has stored output for the active
        // project. Unresolved (still loading / SSR) counts as missing — fail-closed.
        const missingDependencyNames =
          agent.status === 'active' ? (agent.dependsOn ?? []).filter((id) => !dependencies[id]).map((id) => this.documentName(id)) : [];
        const disabled = agent.status !== 'active' || missingDependencyNames.length > 0;
        return {
          agent,
          iconClass: this.accentIcon[accent],
          borderClass: this.accentBorder[accent],
          disabled,
          missingDependencyNames,
          ariaLabel: this.tileAriaLabel(agent, disabled, missingDependencyNames),
        };
      });
    });
  }

  // === Private helpers ===
  /**
   * Accessible name for a card, derived here rather than in the template: the
   * grid's binding would otherwise need a nested conditional, which the repo
   * prohibits, and the disabled reason belongs next to the `disabled` decision
   * it must agree with. A disabled card always says WHY — the same reason its
   * visible tag carries, so the tag and the accessible name cannot diverge.
   */
  private tileAriaLabel(agent: MktgAgent, disabled: boolean, missingDependencyNames: string[]): string {
    if (!disabled) {
      return `Open ${agent.name}`;
    }
    if (agent.status !== 'active') {
      return `${agent.name} (coming soon)`;
    }
    return `${agent.name} (requires ${missingDependencyNames.join(' and ')})`;
  }

  /** Display name of a dependency agent's document: its intake's document name, else the catalog agent name, else the id. */
  private documentName(agentId: string): string {
    return MKTG_AGENT_INTAKES[agentId]?.documentName ?? MKTG_AGENTS.find((candidate) => candidate.id === agentId)?.name ?? agentId;
  }

  private loadStoredVersions(projectUid: string): void {
    const counts: Record<string, number> = {};
    for (const agent of MKTG_AGENTS) {
      const run = this.runService.loadRun(projectUid, agent.id);
      if (run && run.versions.length > 0) {
        counts[agent.id] = run.versions[run.versions.length - 1].version;
      }
    }
    this.storedVersions.set(counts);
  }
}
