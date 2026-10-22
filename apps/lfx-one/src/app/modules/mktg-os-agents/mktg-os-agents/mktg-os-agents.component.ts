// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate, isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, inject, LOCALE_ID, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { MKTG_AGENTS, MKTG_KIT_FAMILIES, MKTG_KIT_FRAMEWORK_AGENT_ID, MKTG_KIT_EXCLUDED_AGENT_IDS } from '@lfx-one/shared/constants';
import {
  MktgAgent,
  MktgAgentAccent,
  MktgAgentTile,
  MktgDependencyDocument,
  MktgKitAgentGroup,
  MktgKitAgentTile,
  MktgDocumentsResponse,
} from '@lfx-one/shared/interfaces';
import { mktgAgentDocumentName, mktgKitRootCrumb } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, filter, forkJoin, map, merge, Observable, of, switchMap } from 'rxjs';

import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgKitHeaderComponent } from '../components/mktg-kit-header/mktg-kit-header.component';
import { MktgKitTabsComponent } from '../components/mktg-kit-tabs/mktg-kit-tabs.component';

// Agents board: one catalog-driven grid grouped by family, with Live/Needs/Coming soon
// state lines. Dependencies require server-approved current, never browser Drafts;
// resolution and listing dates follow the active project.
@Component({
  selector: 'lfx-mktg-os-agents',
  imports: [DatePipe, NgClass, MktgKitTabsComponent, MktgKitHeaderComponent, MktgBreadcrumbComponent],
  templateUrl: './mktg-os-agents.component.html',
})
export class MktgOsAgentsComponent {
  // === Injections ===
  private readonly dependencyService = inject(MktgDependencyService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly documentStore = inject(MktgDocumentStoreService);
  private readonly locale = inject(LOCALE_ID);

  // === Signals ===
  protected readonly documents = signal<MktgDocumentsResponse | null>(null);
  protected readonly listFailed = signal(false);
  protected readonly resolving = signal(true);
  /**
   * Resolved stored output per DEPENDENCY agent id for the active project
   * (dec-agent-dependency-gating): server-approved current only, never browser Drafts.
   * Starts empty and clears on every project switch, so
   * dependent cards are disabled (fail-closed) until resolution lands — on
   * SSR they stay disabled with a neutral resolving state.
   */
  protected readonly dependencyDocs = signal<Record<string, MktgDependencyDocument | null>>({});

  // === Computed ===
  private readonly activeContext$ = toObservable(this.projectContext.activeContext);
  protected readonly hasProject = computed(() => !!this.projectContext.activeContext()?.uid);
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? 'Project');
  protected readonly projectSlug = computed(() => this.projectContext.activeContext()?.slug ?? null);
  protected readonly crumbs = computed(() => [mktgKitRootCrumb(this.projectName(), ['..']), { label: 'Agents' }]);
  protected readonly tiles: Signal<MktgKitAgentTile[]> = this.initTiles();
  protected readonly familyGroups: Signal<MktgKitAgentGroup[]> = this.initFamilyGroups();

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
    // Browser-only: stable SSR; switchMap cancels stale reads when the project changes.
    if (isPlatformBrowser(this.platformId)) {
      this.activeContext$
        .pipe(
          distinctUntilChanged((previous, current) => previous?.uid === current?.uid),
          switchMap((context) => {
            this.documents.set(null);
            this.dependencyDocs.set({});
            this.listFailed.set(false);
            this.resolving.set(!!context);
            if (!context) return of(null);
            return merge(of(context.uid), this.refreshTriggers(context.uid)).pipe(
              switchMap(() => {
                this.listFailed.set(false);
                return forkJoin({
                  documents: this.documentStore.listDocuments(context.uid).pipe(
                    catchError(() => {
                      this.listFailed.set(true);
                      return of(null);
                    })
                  ),
                  dependencies: this.dependencyService.resolveDependencies(context.uid, this.catalogDependencyIds, [], true),
                });
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((snapshot) => {
          if (!snapshot) return;
          this.documents.set(snapshot.documents);
          this.dependencyDocs.set(snapshot.dependencies);
          this.resolving.set(false);
        });
    }
  }

  // === Protected methods ===
  protected onSelectAgent(tile: MktgAgentTile): void {
    // Only enabled tiles have a run page: `coming-soon` tiles and dependency-
    // gated tiles (dec-agent-dependency-gating) are inert.
    if (tile.disabled) {
      return;
    }
    this.router.navigate(['../', tile.agent.id], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  // === Private initializers ===
  /**
   * Refresh the Agents tab's snapshot after a run completes or on return from
   * a run page. The existing snapshot stays visible during a same-project
   * refresh; a project change clears it and resolves from a neutral state.
   * Excluding the navigation that mounted this component avoids a duplicate
   * first fetch even when the router retains the tab instance.
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

  private initFamilyGroups(): Signal<MktgKitAgentGroup[]> {
    return computed(() =>
      MKTG_KIT_FAMILIES.map((family) => ({
        family,
        tiles: family.agentIds.flatMap((id) => this.tiles().filter((tile) => tile.agent.id === id)),
      })).filter((group) => group.tiles.length > 0)
    );
  }

  private initTiles(): Signal<MktgKitAgentTile[]> {
    return computed(() => {
      const dependencies = this.dependencyDocs();
      return MKTG_AGENTS.filter((agent) => !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id)).map((agent) => {
        const accent = agent.accent ?? 'gray';
        // Dependency gating (dec-agent-dependency-gating): a dependent agent is
        // disabled until every dependency has stored output for the active
        // project. Unresolved (still loading / SSR) counts as missing — fail-closed.
        const missingDependencyNames =
          agent.status === 'active' ? (agent.dependsOn ?? []).filter((id) => !dependencies[id]).map((id) => mktgAgentDocumentName(id)) : [];
        const disabled = this.resolving() || agent.status !== 'active' || missingDependencyNames.length > 0;
        const statusLabel = this.tileState(agent, missingDependencyNames, dependencies);
        const lastRunAt = disabled ? null : (this.documents()?.groups.find((group) => group.type.catalogAgentId === agent.id)?.documents[0]?.updatedAt ?? null);
        return {
          agent,
          iconClass: this.accentIcon[accent],
          borderClass: this.accentBorder[accent],
          disabled,
          missingDependencyNames,
          ariaLabel: this.tileAriaLabel(agent, statusLabel, lastRunAt),
          statusLabel,
          lastRunAt,
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
   * visible state line carries, so the state line and the accessible name cannot diverge.
   */
  private tileAriaLabel(agent: MktgAgent, state: string, date: string | null): string {
    if (this.resolving()) return `${agent.name} — Resolving`;
    const lastRun = date ? ` · Last run ${formatDate(date, 'd MMM', this.locale)}` : '';
    return `${agent.name} — ${state}${lastRun}`;
  }

  private tileState(agent: MktgAgent, missing: string[], dependencies: Record<string, MktgDependencyDocument | null>): string {
    if (agent.status !== 'active') return 'Coming soon';
    if ((agent.dependsOn ?? []).includes(MKTG_KIT_FRAMEWORK_AGENT_ID) && !dependencies[MKTG_KIT_FRAMEWORK_AGENT_ID]) return 'Needs an approved framework';
    return missing.length ? `Needs ${missing.join(' and ')}` : 'Live';
  }
}
