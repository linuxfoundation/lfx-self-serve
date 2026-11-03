// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';

import { ItOsAgentShellComponent } from '../it-os-agent-shell/it-os-agent-shell.component';
import { ItOsMailingListAgentService } from '../services/it-os-mailing-list-agent.service';

// Mailing List agent (#4257): sub-lists on groups.io, bulk adds and committee sync. The Details tab lists
// main and its sub-lists with each list's committee sync. Sample data only.
@Component({
  selector: 'lfx-it-os-mailing-list-agent',
  imports: [TagComponent, ItOsAgentShellComponent],
  templateUrl: './it-os-mailing-list-agent.component.html',
})
export class ItOsMailingListAgentComponent {
  // === Injections ===
  protected readonly agent = inject(ItOsMailingListAgentService);

  // === Simple WritableSignals ===
  public readonly tab = signal('agent');
}
