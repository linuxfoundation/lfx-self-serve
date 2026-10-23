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
  MKTG_AGENT_INTAKES,
  MKTG_KIT_FRAMEWORK_AGENT_ID,
  MKTG_KIT_EXCLUDED_AGENT_IDS,
  MKTG_DOCUMENT_TYPES,
  MKTG_KIT_POSITIONING_FAMILY_ID,
  MKTG_KIT_STATE_LABELS,
  MKTG_REBUILD_NAVIGATION_STATE_KEY,
  MKTG_RUN_NEW_MODE,
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
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-mktg-family',
  imports: [
    TooltipModule,
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
  /** Why the family's lead agent cannot run yet: one copy for the tooltip and the note under the button. */
  protected readonly pendingReason = computed(() => this.definition()?.pendingAgentReason ?? MKTG_KIT_STATE_LABELS['coming-soon']);
  protected readonly crumbs = computed(() => [mktgKitRootCrumb(this.kit.projectName(), ['../../']), { label: this.definition()?.name ?? 'Family not found' }]);
  protected readonly family = computed(() => this.kit.families().find((family) => family.family.id === this.familyId()));
  protected readonly live: Signal<boolean> = this.initLive();
  protected readonly firstAgent: Signal<MktgAgent | undefined> = this.initFirstAgent();
  protected readonly firstRunEnabled = computed(() => {
    const agent = this.firstAgent();
    if (!agent || agent.status !== 'active') return false;
    return !!MKTG_AGENT_INTAKES[agent.id];
  });
  protected readonly firstRunName = computed(() => {
    const family = this.definition();
    if (!this.firstRunEnabled() && family?.pendingAgentName) return family.pendingAgentName;
    const asset = family?.assets.find((row) =>
      MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === row.agentKey && type.catalogAgentId === this.firstAgent()?.id)
    );
    return asset?.runName ?? asset?.label ?? family?.pendingAgentName ?? this.firstAgent()?.name;
  });
  protected readonly rowRunAgents: Signal<Record<string, MktgAgent>> = this.initRowRunAgents();
  /** Why each not-run-yet row's agent cannot run yet (a required document is not approved); absent when it can. */
  protected readonly rowRunBlocked: Signal<Record<string, string>> = this.initRowRunBlocked();
  /** The first asset not run yet, in the family's run order (the framework before the assets that read it). */
  protected readonly nextAgent = computed(() => {
    const agents = this.rowRunAgents();
    const row = this.family()?.rows.find((candidate) => candidate.state === 'missing' && agents[candidate.asset.id]);
    return row ? { agent: agents[row.asset.id], label: row.asset.label, blocked: this.rowRunBlocked()[row.asset.id] ?? '' } : null;
  });
  protected readonly rebuildBlockedReason = computed(() => {
    const panel = this.rebuildPanel();
    if (!panel || panel.canStart()) return '';
    if (panel.active()) return 'A rebuild is already running';
    if (!this.context.canWrite()) return 'You need write access to this project to rebuild';
    if (!this.kit.documents()?.approvedFramework) return 'Approve the messaging framework first: rebuilds start from the approved framework';
    return 'Rebuild is not available right now';
  });
  protected readonly autoRebuild = computed(() =>
    this.navigationIntent()?.project === this.kit.projectUid() ? (this.navigationIntent()?.frameworkRevisionId ?? '') : ''
  );
  protected readonly runQueryParams = computed(() => ({ project: this.kit.projectQueryParams().project ?? '', mode: MKTG_RUN_NEW_MODE }));

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
    if (this.live() && agent && this.firstRunEnabled()) {
      const living = MKTG_DOCUMENT_TYPES.some((type) => type.kind === 'living' && type.catalogAgentId === agent.id);
      this.router.navigate(['../../', agent.id], {
        relativeTo: this.route,
        queryParams: living ? this.runQueryParams() : this.kit.projectQueryParams(),
        ...(living ? {} : { queryParamsHandling: 'merge' as const }),
      });
    }
  }

  protected rebuildStarted(): void {
    this.navigationIntent.set(null);
  }

  /** PROVISIONAL: per-row Run actions for built living assets extend the board's header-only action. */
  private initRowRunAgents(): Signal<Record<string, MktgAgent>> {
    return computed(() => {
      const agents: Record<string, MktgAgent> = {};
      for (const row of this.family()?.rows ?? []) {
        const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === row.asset.agentKey);
        if (row.state === 'coming-soon' || (type?.kind !== 'living' && row.state !== 'missing')) continue;
        const agent = MKTG_AGENTS.find((candidate) => candidate.id === type?.catalogAgentId && candidate.status === 'active');
        if (agent && MKTG_AGENT_INTAKES[agent.id] && !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id)) agents[row.asset.id] = agent;
      }
      return agents;
    });
  }

  /**
   * The run page refuses an agent whose intake requires another agent's approved
   * document (boilerplates, FAQ and brand kit read the approved messaging
   * framework); the Run buttons follow the same rule instead of opening a form
   * that cannot be submitted.
   */
  private initRowRunBlocked(): Signal<Record<string, string>> {
    return computed(() => {
      const blocked: Record<string, string> = {};
      const rows = this.family()?.rows ?? [];
      for (const [assetId, agent] of Object.entries(this.rowRunAgents())) {
        for (const attachment of MKTG_AGENT_INTAKES[agent.id]?.attachments ?? []) {
          if (attachment.format !== 'json' || attachment.optional) continue;
          const approved =
            attachment.sourceAgentId === MKTG_KIT_FRAMEWORK_AGENT_ID
              ? !!this.kit.documents()?.approvedFramework
              : rows.some(
                  (row) =>
                    !!row.document?.approvedCurrent &&
                    MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === row.asset.agentKey)?.catalogAgentId === attachment.sourceAgentId
                );
          if (!approved) {
            blocked[assetId] = `Approve the ${attachment.documentName.toLowerCase()} first: ${agent.name} builds on the approved one.`;
            break;
          }
        }
      }
      return blocked;
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
