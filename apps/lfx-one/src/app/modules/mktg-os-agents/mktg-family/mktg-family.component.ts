// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_KIT_FAMILIES, MKTG_AGENTS, MKTG_KIT_EXCLUDED_AGENT_IDS, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgAgent } from '@lfx-one/shared/interfaces';
import { isMktgKitFamilyLive } from '@lfx-one/shared/utils';
import { MktgKitService } from '@services/mktg-kit.service';
import { map } from 'rxjs';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { MktgKitStatusComponent } from '../components/mktg-kit-status/mktg-kit-status.component';
import { MktgFamilyExportActionsComponent } from '../components/mktg-family-export-actions/mktg-family-export-actions.component';
import { MktgFamilyDetailsComponent } from '../components/mktg-family-details/mktg-family-details.component';

@Component({
  selector: 'lfx-mktg-family',
  imports: [DatePipe, RouterLink, ButtonComponent, MktgKitStatusComponent, MktgFamilyExportActionsComponent, MktgFamilyDetailsComponent, PageHeaderComponent],
  providers: [MktgKitService],
  templateUrl: './mktg-family.component.html',
})
export class MktgFamilyComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly kit = inject(MktgKitService);
  private readonly familyId = toSignal(this.route.paramMap.pipe(map((params) => params.get('familyId'))), { initialValue: '' });
  protected readonly definition = computed(() => MKTG_KIT_FAMILIES.find((family) => family.id === this.familyId()));
  protected readonly family = computed(() => this.kit.families().find((family) => family.family.id === this.familyId()));
  protected readonly live: Signal<boolean> = this.initLive();
  protected readonly firstAgent: Signal<MktgAgent | undefined> = this.initFirstAgent();
  protected readonly rowRunAgents: Signal<Record<string, MktgAgent>> = this.initRowRunAgents();
  private readonly routeQueryParams = toSignal(this.route.queryParams, { initialValue: {} });
  protected readonly runQueryParams = computed(() => ({ ...this.routeQueryParams(), project: this.kit.projectQueryParams().project ?? '' }));

  public constructor() {
    bindLfxDocumentTitle(computed(() => this.definition()?.name));
  }

  protected runFirstAgent(): void {
    const agent = this.firstAgent();
    if (this.live() && agent?.status === 'active') {
      this.router.navigate(['../../', agent.id], { relativeTo: this.route, queryParams: this.kit.projectQueryParams(), queryParamsHandling: 'merge' });
    }
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
