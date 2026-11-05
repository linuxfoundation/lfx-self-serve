// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  IT_OS_CHAT_MODE_OPTIONS,
  IT_OS_DNS_SUGGESTIONS,
  IT_OS_DOMAIN_FILTERS,
  IT_OS_DOMAIN_STATE_LABELS,
  IT_OS_LF_NAMESERVERS,
  IT_OS_LIVE_DNS_SUGGESTIONS,
} from '@lfx-one/shared/constants';
import { ItOsChatMessage, ItOsDnsRecord, ItOsDomain, ItOsPlan, ItOsPlanView, ItOsProposal } from '@lfx-one/shared/interfaces';

import { formatDate, planView, scrollKeyOf } from '../services/it-os-dns-html';
import { ItOsLiveChatComponent } from '../it-os-live-chat/it-os-live-chat.component';
import { ItOsDnsAgentService } from '../services/it-os-dns-agent.service';
import { ItOsLiveStatusService } from '../services/it-os-live-status.service';

// Domains & DNS agent (#4257): a chat-first agent plus a Details tab listing every domain. Sample data only.
@Component({
  selector: 'lfx-it-os-dns-agent',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, SelectButtonComponent, TagComponent, ItOsLiveChatComponent],
  templateUrl: './it-os-dns-agent.component.html',
})
export class ItOsDnsAgentComponent {
  // === Injections ===
  protected readonly agent = inject(ItOsDnsAgentService);
  private readonly liveStatus = inject(ItOsLiveStatusService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Constants ===
  protected readonly suggestions = IT_OS_DNS_SUGGESTIONS;
  protected readonly liveSuggestions = IT_OS_LIVE_DNS_SUGGESTIONS;
  protected readonly modeOptions = IT_OS_CHAT_MODE_OPTIONS;
  protected readonly filters = IT_OS_DOMAIN_FILTERS;
  protected readonly stateLabels = IT_OS_DOMAIN_STATE_LABELS;
  protected readonly nameservers = IT_OS_LF_NAMESERVERS;
  protected readonly roleOptions = [
    { label: 'LF staff', value: 'staff' },
    { label: 'External maintainer', value: 'external' },
  ];

  // === Forms ===
  public readonly chatForm = new FormGroup({ message: new FormControl('', { nonNullable: true }) });
  public readonly viewForm = new FormGroup({ role: new FormControl('staff', { nonNullable: true }) });
  public readonly searchForm = new FormGroup({ query: new FormControl('', { nonNullable: true }) });
  /** Sample data or the live agent. Live is offered only where the server has the IT OS route on (dev). */
  public readonly modeForm = new FormGroup({ mode: new FormControl('sample', { nonNullable: true }) });

  // === Simple WritableSignals ===
  public readonly tab = signal('agent');
  public readonly filter = signal('all');
  public readonly selectedName = signal<string | null>(null);
  public readonly copied = signal(false);

  // === Computed ===
  public readonly liveAvailable: Signal<boolean> = computed(() => this.liveStatus.agents().includes('domains'));
  public readonly liveMode: Signal<boolean> = this.initLiveMode();
  public readonly filteredDomains: Signal<ItOsDomain[]> = this.initFilteredDomains();
  public readonly filterCounts: Signal<Record<string, number>> = this.initFilterCounts();
  public readonly selected: Signal<ItOsDomain | undefined> = computed(() => {
    const name = this.selectedName();
    return name ? this.agent.domains().find((d) => d.name === name) : undefined;
  });
  /**
   * Reads the domain list itself rather than `selected()`: the service updates domains in place and
   * re-emits the list, so `selected()` keeps the same reference and would not trigger a recompute.
   */
  public readonly selectedRecords: Signal<ItOsDnsRecord[]> = computed(() => {
    const name = this.selectedName();
    const domain = name ? this.agent.domains().find((d) => d.name === name) : undefined;
    return [...(domain?.records ?? [])].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  });
  /** Expiry dates as shown, by domain name. */
  public readonly expiresLabels: Signal<Record<string, string>> = computed(() =>
    Object.fromEntries(this.agent.domains().map((d) => [d.name, formatDate(d.expires)]))
  );
  /** What each plan in the conversation shows, recomputed when the messages change. */
  protected readonly planViews: Signal<Map<ItOsPlan, ItOsPlanView>> = computed(
    () =>
      new Map(
        this.agent
          .messages()
          .filter((m) => m.plan)
          .map((m) => {
            const plan = m.plan as ItOsPlan;
            return [
              plan,
              planView(plan.proposals, (p) => ({
                title: this.agent.describe(p),
                details: this.agent.details(p.payload),
                needsApproval: this.agent.needsApproval(p),
                reason: this.agent.reason(p),
              })),
            ];
          })
      )
  );
  /** Changes only when a message is added or a progress step appears, not when a field is edited. */
  private readonly scrollKey = computed(() => scrollKeyOf(this.agent.messages()));

  private readonly conversation = viewChild<ElementRef<HTMLElement>>('conversation');

  public constructor() {
    this.agent.start();
    // The service keeps the demo across visits, so start the switch from its current value.
    this.viewForm.reset({ role: this.agent.staff() ? 'staff' : 'external' }, { emitEvent: false });
    this.viewForm.controls.role.valueChanges.pipe(takeUntilDestroyed()).subscribe((role) => this.agent.staff.set(role === 'staff'));
    // Keep the newest message in view, without jumping while the user edits a form further up.
    effect(() => {
      this.scrollKey();
      const el = this.conversation()?.nativeElement;
      if (el && isPlatformBrowser(this.platformId)) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  public send(): void {
    const text = this.chatForm.controls.message.value;
    if (!text.trim() || this.agent.busy()) return;
    this.chatForm.reset();
    this.agent.send(text);
  }

  public reset(): void {
    this.agent.reset();
    this.viewForm.reset({ role: 'staff' }, { emitEvent: false });
    this.tab.set('agent');
    this.filter.set('all');
    this.selectedName.set(null);
    this.searchForm.reset();
  }

  public openDomain(name: string): void {
    this.selectedName.set(name);
  }

  /** Back to the chat with the open domain named in the composer, so the request goes to that domain. */
  public askAgent(): void {
    const name = this.selectedName();
    this.selectedName.set(null);
    if (name) this.chatForm.controls.message.setValue(`For ${name}: `);
    this.tab.set('agent');
  }

  public copyNameservers(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard
      ?.writeText(this.nameservers.join('\n'))
      .then(() => this.copied.set(true))
      .catch(() => this.copied.set(false));
  }

  public onZoneFiles(message: ItOsChatMessage, event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    this.agent.uploadZoneFiles(
      message,
      Array.from(files ?? []).map((f) => f.name)
    );
  }

  protected toggle(proposal: ItOsProposal, event: Event): void {
    this.agent.togglePlan(proposal, (event.target as HTMLInputElement).checked);
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  private initLiveMode(): Signal<boolean> {
    const mode = toSignal(this.modeForm.controls.mode.valueChanges, { initialValue: this.modeForm.controls.mode.value });
    return computed(() => this.liveAvailable() && mode() === 'live');
  }

  private initFilteredDomains(): Signal<ItOsDomain[]> {
    const query = toSignal(this.searchForm.controls.query.valueChanges, { initialValue: '' });
    return computed(() => {
      const term = query().trim().toLowerCase();
      const filter = this.filters.find((f) => f.id === this.filter()) ?? this.filters[0];
      return this.agent
        .domains()
        .filter((d) => filter.matches(d) && (!term || `${d.name} ${d.uses.join(' ')} ${d.registrar}`.toLowerCase().includes(term)))
        .sort((a, b) => Number(a.state === 'Registered') - Number(b.state === 'Registered') || a.name.localeCompare(b.name));
    });
  }

  private initFilterCounts(): Signal<Record<string, number>> {
    return computed(() => Object.fromEntries(this.filters.map((f) => [f.id, this.agent.domains().filter(f.matches).length])));
  }
}
