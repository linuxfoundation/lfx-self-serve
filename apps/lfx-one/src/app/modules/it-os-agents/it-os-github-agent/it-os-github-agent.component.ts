// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { IT_OS_GITHUB_LF_LABELS, IT_OS_GITHUB_LINKED_LABELS, IT_OS_LF_GITHUB_ACCOUNT } from '@lfx-one/shared/constants';
import { ItOsGithubMember, ItOsGithubOrgRow } from '@lfx-one/shared/interfaces';

import { ItOsAgentShellComponent } from '../it-os-agent-shell/it-os-agent-shell.component';
import { ItOsGithubAgentService } from '../services/it-os-github-agent.service';

// GitHub Org agent (#4257): makes sure thelinuxfoundation is an owner of each of the project's GitHub orgs.
// The Details tab lists the orgs, pending invitations and the first org's owners. Sample data only.
@Component({
  selector: 'lfx-it-os-github-agent',
  imports: [ButtonComponent, TagComponent, ItOsAgentShellComponent],
  templateUrl: './it-os-github-agent.component.html',
})
export class ItOsGithubAgentComponent {
  // === Injections ===
  protected readonly agent = inject(ItOsGithubAgentService);

  // === Constants ===
  protected readonly lfAccount = IT_OS_LF_GITHUB_ACCOUNT;
  protected readonly lfLabels = IT_OS_GITHUB_LF_LABELS;

  // === Simple WritableSignals ===
  public readonly tab = signal('agent');

  // === Computed ===
  protected readonly rows: Signal<ItOsGithubOrgRow[]> = computed(() =>
    this.agent.orgs().map((org) => ({ org, linked: IT_OS_GITHUB_LINKED_LABELS[this.agent.linked(org)] }))
  );
  /** Owners of the first org, which the Details tab lists. */
  protected readonly firstOwners: Signal<ItOsGithubMember[]> = computed(() => {
    const first = this.agent.orgs()[0];
    return first ? this.agent.owners(first) : [];
  });

  public connectAnother(): void {
    this.tab.set('agent');
    this.agent.send('We have another GitHub org');
  }
}
