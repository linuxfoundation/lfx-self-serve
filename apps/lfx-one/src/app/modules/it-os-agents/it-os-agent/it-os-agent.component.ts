// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { IT_OS_AGENTS } from '@lfx-one/shared/constants';
import { ItOsAgent } from '@lfx-one/shared/interfaces';

import { IT_OS_AGENT_ICON_CLASSES } from '../it-os-agent-icon-classes';
import { ItOsDnsAgentComponent } from '../it-os-dns-agent/it-os-dns-agent.component';
import { ItOsForwardingAgentComponent } from '../it-os-forwarding-agent/it-os-forwarding-agent.component';
import { ItOsGithubAgentComponent } from '../it-os-github-agent/it-os-github-agent.component';
import { ItOsMailingListAgentComponent } from '../it-os-mailing-list-agent/it-os-mailing-list-agent.component';

// One IT OS agent's page (#4257). Agents with a chat render it here; the others show a placeholder for now.
@Component({
  selector: 'lfx-it-os-agent',
  imports: [
    RouterLink,
    CardComponent,
    EmptyStateComponent,
    TagComponent,
    ItOsDnsAgentComponent,
    ItOsForwardingAgentComponent,
    ItOsGithubAgentComponent,
    ItOsMailingListAgentComponent,
  ],
  templateUrl: './it-os-agent.component.html',
})
export class ItOsAgentComponent {
  // === Injections ===
  private readonly route = inject(ActivatedRoute);

  // === Constants ===
  protected readonly iconClasses = IT_OS_AGENT_ICON_CLASSES;

  /** The agent for this page, or undefined for an unknown id or one that is not available yet. */
  public readonly agent: ItOsAgent | undefined = this.findAgent();

  private findAgent(): ItOsAgent | undefined {
    const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';
    return IT_OS_AGENTS.find((agent) => agent.id === agentId && !agent.comingSoon);
  }
}
