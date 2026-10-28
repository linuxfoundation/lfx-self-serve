// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_KIT_FILTERS, MKTG_KIT_FAMILIES, MKTG_KIT_POSITIONING_FAMILY_ID } from '@lfx-one/shared/constants';
import { MktgKitFilter } from '@lfx-one/shared/interfaces';
import { resolveMktgFamilyActions, resolveMktgFamilyNextStep, resolveMktgFamilyRun } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { MktgKitService } from '@services/mktg-kit.service';
import { MktgKitTabsComponent } from '../components/mktg-kit-tabs/mktg-kit-tabs.component';
import { MktgKitStatusComponent } from '../components/mktg-kit-status/mktg-kit-status.component';
import { MktgKitHeaderComponent } from '../components/mktg-kit-header/mktg-kit-header.component';

@Component({
  selector: 'lfx-mktg-kit',
  imports: [RouterLink, ButtonComponent, FilterPillsComponent, MktgKitHeaderComponent, MktgKitTabsComponent, MktgKitStatusComponent],
  providers: [MktgKitService],
  templateUrl: './mktg-kit.component.html',
})
export class MktgKitComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly context = inject(ProjectContextService);
  protected readonly kit = inject(MktgKitService);
  protected readonly filters = MKTG_KIT_FILTERS;
  protected readonly familyCount = MKTG_KIT_FAMILIES.length;
  protected readonly selectedFilter = this.initSelectedFilter();
  protected readonly cards = this.initCards();
  protected readonly nextStep = this.initNextStep();

  protected selectFilter(id: string): void {
    const filter = this.filters.find((option) => option.id === id);
    if (filter)
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { ...this.kit.projectQueryParams(), state: filter.id === 'all' ? null : filter.id },
        queryParamsHandling: 'merge',
      });
  }

  private initNextStep() {
    return computed(() => {
      const family = this.kit.families().find((view) => view.family.id === MKTG_KIT_POSITIONING_FAMILY_ID);
      if (!family) return null;
      const step = resolveMktgFamilyNextStep(family, {
        loaded: !this.kit.loading() && !this.kit.error(),
        canWrite: this.context.canWrite(),
        approvedFramework: !!this.kit.documents()?.approvedFramework,
      });
      return step ? { ...step, queryParams: { project: this.kit.projectQueryParams().project ?? '', ...step.queryParams } } : null;
    });
  }

  private initSelectedFilter(): Signal<MktgKitFilter> {
    return toSignal(
      this.route.queryParamMap.pipe(map((params): MktgKitFilter => this.filters.find((filter) => filter.id === params.get('state'))?.id ?? 'all')),
      { initialValue: 'all' }
    );
  }

  private initCards() {
    return computed(() =>
      this.kit.families().map((family) => {
        const actions = resolveMktgFamilyActions(family, {
          loaded: !this.kit.loading() && !this.kit.error(),
          canWrite: this.context.canWrite(),
          approvedFramework: !!this.kit.documents()?.approvedFramework,
        });
        const rows = Object.values(actions.rows).map(({ row }) => {
          const run = resolveMktgFamilyRun(row.asset.agentKey, this.kit.documents()?.runs, [], row.document);
          const link = run?.link;
          return { ...row, run: link ? { ...run, link: { ...link, queryParams: { ...this.kit.projectQueryParams(), ...link.queryParams } } } : null };
        });
        return {
          ...family,
          needsRebuild: rows.some((row) => row.state === 'needs-rebuild'),
          rows: family.live ? rows.filter((row) => this.selectedFilter() === 'all' || row.state === this.selectedFilter()) : [],
          agentNames: family.family.leadSummary ?? family.agents.map((agent) => agent.name).join(', '),
        };
      })
    );
  }
}
