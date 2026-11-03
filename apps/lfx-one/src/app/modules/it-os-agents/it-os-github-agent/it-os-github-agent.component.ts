// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { IT_OS_GITHUB_LF_LABELS, IT_OS_GITHUB_LINKED_LABELS, IT_OS_LF_GITHUB_ACCOUNT } from '@lfx-one/shared/constants';

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
  protected readonly linkedLabels = IT_OS_GITHUB_LINKED_LABELS;
  protected readonly lfLabels = IT_OS_GITHUB_LF_LABELS;

  // === Simple WritableSignals ===
  public readonly tab = signal('agent');

  public connectAnother(): void {
    this.tab.set('agent');
    this.agent.send('We have another GitHub org');
  }
}
