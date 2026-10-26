// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { TagComponent } from '@components/tag/tag.component';
import { IT_OS_AGENTS, IT_OS_AGENTS_LABEL } from '@lfx-one/shared/constants';
import { ItOsAgent } from '@lfx-one/shared/interfaces';

import { IT_OS_AGENT_ICON_CLASSES } from '../it-os-agent-icon-classes';

// IT OS landing (#4257): the agent catalog. Each available agent opens its own page; chat lands per agent in follow-up PRs.
@Component({
  selector: 'lfx-it-os-agents',
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink, InputTextComponent, PageHeaderComponent, TagComponent],
  templateUrl: './it-os-agents.component.html',
})
export class ItOsAgentsComponent {
  // === Constants ===
  protected readonly labels = IT_OS_AGENTS_LABEL;
  protected readonly iconClasses = IT_OS_AGENT_ICON_CLASSES;

  // === Forms ===
  public readonly searchForm = new FormGroup({ search: new FormControl('', { nonNullable: true }) });

  // === Computed ===
  public readonly agents: Signal<ItOsAgent[]> = this.initAgents();

  private initAgents(): Signal<ItOsAgent[]> {
    const search = toSignal(this.searchForm.controls.search.valueChanges, { initialValue: '' });
    return computed(() => {
      const term = search().trim().toLowerCase();
      if (!term) return IT_OS_AGENTS;
      return IT_OS_AGENTS.filter((agent) => [agent.name, agent.description, ...agent.tags].some((text) => text.toLowerCase().includes(term)));
    });
  }
}
