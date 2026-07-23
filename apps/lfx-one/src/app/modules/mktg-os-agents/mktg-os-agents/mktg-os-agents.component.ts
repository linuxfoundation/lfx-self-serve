// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { MKTG_AGENTS, MKTG_OS_AGENTS_LABEL } from '@lfx-one/shared/constants';
import { MktgAgent, MktgAgentAccent } from '@lfx-one/shared/interfaces';

import { MktgChatPanelComponent } from '../mktg-chat-panel/mktg-chat-panel.component';

// Marketplace landing for the Marketing OS marketplace (LFXAI-98). Renders the
// catalog tiles, client-side search, and the placeholder Alerts / Agents-in-Process
// sections from the mockup. Tile clicks open a per-agent chat surface — wired here
// as a signal-driven selection (`selectedAgentId`) rather than a route param,
// because the chat panel (LFXAI-99) is an in-page side panel, not a separate page.
@Component({
  selector: 'lfx-mktg-os-agents',
  imports: [NgClass, ReactiveFormsModule, CardComponent, InputTextComponent, TagComponent, EmptyStateComponent, MktgChatPanelComponent],
  templateUrl: './mktg-os-agents.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MktgOsAgentsComponent {
  // === Constants ===
  protected readonly labels = MKTG_OS_AGENTS_LABEL;

  // Placeholder feed content from the mockup — replaced by real data in a later
  // story once Alerts / in-progress sessions have a backend.
  protected readonly alerts: string[] = ['No new marketing alerts.'];
  protected readonly agentsInProcess: string[] = ['No agents are currently running.'];

  // === Forms ===
  protected readonly searchForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
  });

  // === Signals ===
  private readonly searchTerm = toSignal(this.searchForm.controls.search.valueChanges, { initialValue: '' });
  // Agent whose chat surface is open; null = grid view. The chat panel lands in LFXAI-99.
  protected readonly selectedAgentId = signal<string | null>(null);

  // === Computed ===
  protected readonly tiles: Signal<{ agent: MktgAgent; iconClass: string; borderClass: string }[]> = this.initTiles();
  protected readonly selectedAgent = computed(() => MKTG_AGENTS.find((agent) => agent.id === this.selectedAgentId()) ?? null);

  // Accent → Tailwind classes. Kept as class fields (not module-level) with literal
  // class names so Tailwind's content scan (./src/**/*.ts) generates them.
  private readonly accentIcon: Record<MktgAgentAccent, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  private readonly accentBorder: Record<MktgAgentAccent, string> = {
    blue: 'border-l-blue-500',
    emerald: 'border-l-emerald-500',
    violet: 'border-l-violet-500',
    amber: 'border-l-amber-500',
    red: 'border-l-red-500',
    gray: 'border-l-gray-300',
  };

  // === Protected methods ===
  protected onSelectAgent(agent: MktgAgent): void {
    // Only `active` agents have a chat surface; `coming-soon` tiles are inert.
    if (agent.status !== 'active') {
      return;
    }
    this.selectedAgentId.set(agent.id);
  }

  protected clearSelection(): void {
    this.selectedAgentId.set(null);
  }

  // === Private initializers ===
  private initTiles(): Signal<{ agent: MktgAgent; iconClass: string; borderClass: string }[]> {
    return computed(() => {
      const term = this.searchTerm().trim().toLowerCase();
      const matches = term
        ? MKTG_AGENTS.filter(
            (agent) =>
              agent.name.toLowerCase().includes(term) ||
              agent.description.toLowerCase().includes(term) ||
              agent.tags.some((tag) => tag.toLowerCase().includes(term))
          )
        : MKTG_AGENTS;

      return matches.map((agent) => {
        const accent = agent.accent ?? 'gray';
        return { agent, iconClass: this.accentIcon[accent], borderClass: this.accentBorder[accent] };
      });
    });
  }
}
