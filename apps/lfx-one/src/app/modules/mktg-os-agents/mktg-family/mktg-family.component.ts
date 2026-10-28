// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, Location } from '@angular/common';
import { afterNextRender, Component, computed, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MktgSkeletonComponent } from '@components/mktg-skeleton/mktg-skeleton.component';
import { MKTG_KIT_FAMILIES, MKTG_KIT_POSITIONING_FAMILY_ID, MKTG_REBUILD_NAVIGATION_STATE_KEY, MKTG_RUN_NEW_MODE } from '@lfx-one/shared/constants';
import { MktgRebuildNavigationIntent } from '@lfx-one/shared/interfaces';
import {
  isMktgKitFamilyLive,
  mktgFamilyExportAgentKeys,
  readMktgRebuildNavigationIntent,
  resolveMktgFamilyActions,
  resolveMktgFamilyRun,
} from '@lfx-one/shared/utils';
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
    MktgSkeletonComponent,
  ],
  providers: [MktgKitService],
  templateUrl: './mktg-family.component.html',
})
export class MktgFamilyComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly platform = inject(PLATFORM_ID);
  private readonly location = inject(Location);
  private readonly exports = inject(MktgFamilyExportService);
  private readonly context = inject(ProjectContextService);
  protected readonly kit = inject(MktgKitService);

  // Writable signals
  private readonly navigationIntent = signal<MktgRebuildNavigationIntent | null>(null);
  protected readonly rebuildPanel = viewChild(MktgRebuildComponent);
  protected readonly exportPanel = viewChild(MktgFamilyExportActionsComponent);
  protected readonly rebuildFamilyId = MKTG_KIT_POSITIONING_FAMILY_ID;
  protected readonly hasStale = computed(() => this.family()?.rows.some((row) => row.state === 'needs-rebuild') ?? false);
  private readonly familyId = toSignal(this.route.paramMap.pipe(map((params) => params.get('familyId'))), { initialValue: '' });
  protected readonly definition = computed(() => MKTG_KIT_FAMILIES.find((family) => family.id === this.familyId()));
  protected readonly family = computed(() => this.kit.families().find((family) => family.family.id === this.familyId()));
  protected readonly live: Signal<boolean> = this.initLive();
  protected readonly actions = this.initActions();
  protected readonly headerQueryParams = computed((): Record<string, string> => {
    const header = this.actions()?.header;
    if (header?.link) return { ...this.runQueryParams().plain, ...header.link.queryParams };
    return header?.mode ? this.runQueryParams().fresh : this.runQueryParams().plain;
  });
  protected readonly rows = computed(() =>
    Object.values(this.actions()?.rows ?? {}).map((entry) => {
      const run = resolveMktgFamilyRun(entry.row.asset.agentKey, this.kit.documents()?.runs, ['../../'], entry.row.document);
      const link = run?.link;
      return { ...entry, run: link ? { ...run, link: { ...link, queryParams: { ...this.kit.projectQueryParams(), ...link.queryParams } } } : null };
    })
  );
  protected readonly headerRun = this.initHeaderRun();
  /** Replace (never merge) query params: no creator/revision selectors travel to a new run. */
  protected readonly runQueryParams = computed(
    (): Record<'fresh' | 'plain', Record<string, string>> => ({
      fresh: { project: this.kit.projectQueryParams().project ?? '', mode: MKTG_RUN_NEW_MODE },
      plain: { project: this.kit.projectQueryParams().project ?? '' },
    })
  );
  protected readonly autoRebuild = computed(() =>
    this.navigationIntent()?.project === this.kit.projectUid() ? (this.navigationIntent()?.frameworkRevisionId ?? '') : ''
  );

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

  protected rebuildStarted(): void {
    this.navigationIntent.set(null);
  }

  private initHeaderRun() {
    return computed(() => {
      if (!this.kit.documents() || this.kit.accessDenied() || !this.context.canWrite()) return null;
      const rows = this.rows();
      const newest = [...(this.kit.documents()?.runs ?? [])]
        .filter((run) => run.state !== 'failed')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .find((run) => rows.some((entry) => entry.run && entry.row.asset.agentKey === run.agentKey));
      const entry = rows.find(({ row }) => row.asset.agentKey === newest?.agentKey);
      return entry?.run ? { ...entry.run, caption: `${entry.row.asset.label} · ${entry.run.caption}` } : null;
    });
  }

  private initActions() {
    return computed(() => {
      const definition = this.definition();
      if (!definition) return null;
      return resolveMktgFamilyActions(this.family() ?? { family: definition, rows: [], agents: [], live: this.live() }, {
        loaded: !!this.kit.documents() || (!this.kit.loading() && (!this.kit.error() || this.kit.accessDenied())),
        canWrite: this.context.canWrite() && !this.kit.accessDenied(),
        approvedFramework: !!this.kit.documents()?.approvedFramework,
      });
    });
  }

  private initLive(): Signal<boolean> {
    return computed(() => {
      const family = this.definition();
      return family ? isMktgKitFamilyLive(family) : false;
    });
  }
}
