// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { MKTG_AGENTS, MKTG_OS_AGENTS_LABEL } from '@lfx-one/shared/constants';
import { MktgAgent, MktgAgentAccent, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { ProjectContextService } from '@services/project-context.service';
import { distinctUntilChanged, filter } from 'rxjs';

// Marketplace landing for the Marketing OS marketplace (approved form-first
// design): catalog grid with client-side search, "Coming soon" tags on
// disabled cards, and a "vN generated" badge on agents with stored output.
// Card clicks route to the per-agent run page (/:agentId) — the form-first
// run shell that replaced the earlier in-page chat-panel approach.
@Component({
  selector: 'lfx-mktg-os-agents',
  imports: [NgClass, ReactiveFormsModule, InputTextComponent, TagComponent, EmptyStateComponent],
  templateUrl: './mktg-os-agents.component.html',
})
export class MktgOsAgentsComponent {
  // === Injections ===
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

  private readonly searchTerm = toSignal(this.searchForm.controls.search.valueChanges, { initialValue: '' });

  // === Computed ===
  protected readonly tiles: Signal<{ agent: MktgAgent; iconClass: string; borderClass: string }[]> = this.initTiles();

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
          takeUntilDestroyed()
        )
        .subscribe((context) => {
          // Clear first so a project with no stored runs never keeps the
          // previous project's badges.
          this.storedVersions.set({});
          this.loadStoredVersions(context.uid);
        });
    }
  }

  // === Protected methods ===
  protected onSelectAgent(agent: MktgAgent): void {
    // Only `active` agents have a run page; `coming-soon` tiles are inert.
    if (agent.status !== 'active') {
      return;
    }
    this.router.navigate([agent.id], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  // === Private initializers ===
  private initTiles(): Signal<{ agent: MktgAgent; iconClass: string; borderClass: string }[]> {
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

      return matches.map((agent) => {
        const accent = agent.accent ?? 'gray';
        return { agent, iconClass: this.accentIcon[accent], borderClass: this.accentBorder[accent] };
      });
    });
  }

  // === Private helpers ===
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
