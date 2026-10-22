// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, Location } from '@angular/common';
import { afterNextRender, Component, computed, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  MKTG_KIT_FAMILIES,
  MKTG_AGENTS,
  MKTG_KIT_EXCLUDED_AGENT_IDS,
  MKTG_DOCUMENT_TYPES,
  MKTG_KIT_POSITIONING_FAMILY_ID,
  MKTG_REBUILD_NAVIGATION_STATE_KEY,
} from '@lfx-one/shared/constants';
import { MktgAgent, MktgRebuildNavigationIntent } from '@lfx-one/shared/interfaces';
import { isMktgKitFamilyLive, mktgFamilyExportAgentKeys, mktgKitRootCrumb, readMktgRebuildNavigationIntent } from '@lfx-one/shared/utils';
import { MktgKitService } from '@services/mktg-kit.service';
import { catchError, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { MktgFamilyExportService } from '@services/mktg-family-export.service';
import { ProjectContextService } from '@services/project-context.service';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { MktgKitStatusComponent } from '../components/mktg-kit-status/mktg-kit-status.component';
import { MktgFamilyExportActionsComponent } from '../components/mktg-family-export-actions/mktg-family-export-actions.component';
import { MktgFamilyDetailsComponent } from '../components/mktg-family-details/mktg-family-details.component';
import { MktgRebuildComponent } from '../components/mktg-rebuild/mktg-rebuild.component';
import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';

@Component({
  selector: 'lfx-mktg-family',
  imports: [
    DatePipe,
    RouterLink,
    ButtonComponent,
    MktgKitStatusComponent,
    MktgFamilyExportActionsComponent,
    MktgFamilyDetailsComponent,
    PageHeaderComponent,
    MktgRebuildComponent,
    MktgBreadcrumbComponent,
  ],
  providers: [MktgKitService],
  templateUrl: './mktg-family.component.html',
})
export class MktgFamilyComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platform = inject(PLATFORM_ID);
  private readonly location = inject(Location);
  private readonly exports = inject(MktgFamilyExportService);
  private readonly context = inject(ProjectContextService);
  protected readonly kit = inject(MktgKitService);

  // Writable signals
  private readonly navigationIntent = signal<MktgRebuildNavigationIntent | null>(null);
  protected readonly rebuildPanel = viewChild(MktgRebuildComponent);
  protected readonly rebuildFamilyId = MKTG_KIT_POSITIONING_FAMILY_ID;
  protected readonly hasStale = computed(() => this.family()?.rows.some((row) => row.state === 'needs-rebuild') ?? false);
  private readonly familyId = toSignal(this.route.paramMap.pipe(map((params) => params.get('familyId'))), { initialValue: '' });
  protected readonly definition = computed(() => MKTG_KIT_FAMILIES.find((family) => family.id === this.familyId()));
  protected readonly crumbs = computed(() => [mktgKitRootCrumb(this.kit.projectName(), ['../../']), { label: this.definition()?.name ?? 'Family not found' }]);
  protected readonly family = computed(() => this.kit.families().find((family) => family.family.id === this.familyId()));
  protected readonly live: Signal<boolean> = this.initLive();
  protected readonly firstAgent: Signal<MktgAgent | undefined> = this.initFirstAgent();
  protected readonly rowRunAgents: Signal<Record<string, MktgAgent>> = this.initRowRunAgents();
  private readonly routeQueryParams = toSignal(this.route.queryParams, { initialValue: {} });
  protected readonly autoRebuild = computed(() =>
    this.navigationIntent()?.project === this.kit.projectUid() ? (this.navigationIntent()?.frameworkRevisionId ?? '') : ''
  );
  protected readonly runQueryParams = computed(() => ({ ...this.routeQueryParams(), project: this.kit.projectQueryParams().project ?? '' }));

  public constructor() {
    bindLfxDocumentTitle(computed(() => this.definition()?.name));
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platform)) return;
      const state: unknown = this.location.getState();
      if (!state || typeof state !== 'object' || !(MKTG_REBUILD_NAVIGATION_STATE_KEY in state)) return;
      this.navigationIntent.set(readMktgRebuildNavigationIntent(state[MKTG_REBUILD_NAVIGATION_STATE_KEY]));
      const remaining: Record<string, unknown> = { ...state };
      delete remaining[MKTG_REBUILD_NAVIGATION_STATE_KEY];
      this.location.replaceState(this.location.path(), '', remaining);
    });
    // Start the last-export read even while the unrelated kit/document listing is loading or failed.
    if (isPlatformBrowser(this.platform)) {
      toObservable(computed(() => ({ project: this.context.activeContext()?.uid, familyId: this.familyId(), writer: this.context.canWrite() })))
        .pipe(
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          switchMap(({ project, familyId, writer }) =>
            project && familyId && writer && mktgFamilyExportAgentKeys(familyId).length
              ? this.exports.last({ project, familyId }, true).pipe(catchError(() => of(null)))
              : of(null)
          ),
          takeUntilDestroyed()
        )
        .subscribe();
    }
  }

  protected runFirstAgent(): void {
    const agent = this.firstAgent();
    if (this.live() && agent?.status === 'active') {
      this.router.navigate(['../../', agent.id], { relativeTo: this.route, queryParams: this.kit.projectQueryParams(), queryParamsHandling: 'merge' });
    }
  }

  protected rebuildStarted(): void {
    this.navigationIntent.set(null);
  }

  private initRowRunAgents(): Signal<Record<string, MktgAgent>> {
    return computed(() => {
      const agents: Record<string, MktgAgent> = {};
      for (const row of this.family()?.rows ?? []) {
        if (row.state !== 'missing') continue;
        const id = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === row.asset.agentKey)?.catalogAgentId;
        const agent = MKTG_AGENTS.find((candidate) => candidate.id === id && candidate.status === 'active');
        if (agent && !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id)) agents[row.asset.id] = agent;
      }
      return agents;
    });
  }

  private initFirstAgent(): Signal<MktgAgent | undefined> {
    return computed(() => MKTG_AGENTS.find((agent) => agent.id === this.definition()?.agentIds[0] && !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id)));
  }

  private initLive(): Signal<boolean> {
    return computed(() => {
      const family = this.definition();
      return family ? isMktgKitFamilyLive(family) : false;
    });
  }
}
