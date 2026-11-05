// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { IT_OS_FORWARD_TIER_LABELS } from '@lfx-one/shared/constants';
import { ItOsDomainStateLabel, ItOsForward, ItOsForwardMissingRow, ItOsForwardRow } from '@lfx-one/shared/interfaces';

import { ItOsAgentShellComponent } from '../it-os-agent-shell/it-os-agent-shell.component';
import { ItOsForwardingAgentService } from '../services/it-os-forwarding-agent.service';

// Email Forwarding agent (#4257): LF's standard addresses on the primary domain, any others the project
// needs, and a check of existing forwards against the standard. The Details tab lists every address.
@Component({
  selector: 'lfx-it-os-forwarding-agent',
  imports: [ButtonComponent, TagComponent, ItOsAgentShellComponent],
  templateUrl: './it-os-forwarding-agent.component.html',
})
export class ItOsForwardingAgentComponent {
  // === Injections ===
  protected readonly agent = inject(ItOsForwardingAgentService);

  // === Constants ===
  protected readonly tierLabels = IT_OS_FORWARD_TIER_LABELS;

  // === Simple WritableSignals ===
  public readonly tab = signal('agent');

  // === Computed ===
  protected readonly summary: Signal<string> = computed(
    () => `${this.agent.enabled() ? 'Forwarding is on' : 'Forwarding is not on yet'} · ${this.agent.status().text}`
  );
  protected readonly rows: Signal<ItOsForwardRow[]> = computed(() =>
    this.agent.forwards().map((forward) => ({
      forward,
      tier: this.agent.tierLabel(forward.alias),
      fix: this.agent.findingFor(forward.alias)?.fix,
      status: this.statusOf(forward),
    }))
  );
  protected readonly missingRows: Signal<ItOsForwardMissingRow[]> = computed(() =>
    this.agent.missing().map((standard) => ({ standard, destination: this.agent.destinationFor(standard) }))
  );
  protected readonly dontList = this.agent.dontList();

  public checkAgainstStandard(): void {
    this.tab.set('agent');
    this.agent.send('Check our forwards against the standard');
  }

  private statusOf(forward: ItOsForward): ItOsDomainStateLabel {
    if (forward.autoReply) return { label: 'Auto-reply', severity: 'info' };
    const finding = this.agent.findingFor(forward.alias);
    if (!finding) return { label: 'Matches', severity: 'success' };
    if (finding.tone === 'bad') return { label: 'Not allowed', severity: 'danger' };
    if (finding.tone === 'warn') return { label: 'Needs a fix', severity: 'warn' };
    return { label: 'Check', severity: 'secondary' };
  }
}
