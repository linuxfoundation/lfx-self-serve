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
import { IT_OS_DNS_SUGGESTIONS, IT_OS_DOMAIN_FILTERS, IT_OS_DOMAIN_STATE_LABELS, IT_OS_LF_NAMESERVERS } from '@lfx-one/shared/constants';
import { ItOsChatMessage, ItOsDnsRecord, ItOsDomain, ItOsPlan, ItOsProposal } from '@lfx-one/shared/interfaces';

import { formatDate } from '../services/it-os-dns-html';
import { ItOsDnsAgentService } from '../services/it-os-dns-agent.service';

// Domains & DNS agent (#4257): a chat-first agent plus a Details tab listing every domain. Sample data only.
@Component({
  selector: 'lfx-it-os-dns-agent',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, SelectButtonComponent, TagComponent],
  templateUrl: './it-os-dns-agent.component.html',
})
export class ItOsDnsAgentComponent {
  // === Injections ===
  protected readonly agent = inject(ItOsDnsAgentService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Constants ===
  protected readonly suggestions = IT_OS_DNS_SUGGESTIONS;
  protected readonly filters = IT_OS_DOMAIN_FILTERS;
  protected readonly stateLabels = IT_OS_DOMAIN_STATE_LABELS;
  protected readonly nameservers = IT_OS_LF_NAMESERVERS;
  protected readonly roleOptions = [
    { label: 'LF staff', value: 'staff' },
    { label: 'External maintainer', value: 'external' },
  ];
  protected readonly formatDate = formatDate;

  // === Forms ===
  public readonly chatForm = new FormGroup({ message: new FormControl('', { nonNullable: true }) });
  public readonly viewForm = new FormGroup({ role: new FormControl('staff', { nonNullable: true }) });
  public readonly searchForm = new FormGroup({ query: new FormControl('', { nonNullable: true }) });

  // === Simple WritableSignals ===
  public readonly tab = signal('agent');
  public readonly filter = signal('all');
  public readonly selectedName = signal<string | null>(null);
  public readonly copied = signal(false);

  // === Computed ===
  public readonly filteredDomains: Signal<ItOsDomain[]> = this.initFilteredDomains();
  public readonly filterCounts: Signal<Record<string, number>> = this.initFilterCounts();
  public readonly selected: Signal<ItOsDomain | undefined> = computed(() => {
    const name = this.selectedName();
    return name ? this.agent.domains().find((d) => d.name === name) : undefined;
  });
  public readonly selectedRecords: Signal<ItOsDnsRecord[]> = computed(() =>
    [...(this.selected()?.records ?? [])].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  );

  private readonly conversation = viewChild<ElementRef<HTMLElement>>('conversation');

  public constructor() {
    this.agent.start();
    // The service keeps the demo across visits, so start the switch from its current value.
    this.viewForm.reset({ role: this.agent.staff() ? 'staff' : 'external' }, { emitEvent: false });
    this.viewForm.controls.role.valueChanges.pipe(takeUntilDestroyed()).subscribe((role) => this.agent.staff.set(role === 'staff'));
    // Keep the newest message in view.
    effect(() => {
      this.agent.messages();
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

  public askAgent(): void {
    this.selectedName.set(null);
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

  /** Only the newest message's controls are live; earlier ones are history. */
  protected isActive(index: number, message: ItOsChatMessage): boolean {
    return index === this.agent.messages().length - 1 && !message.used;
  }

  protected planCounts(plan: ItOsPlan): { on: number; approval: number } {
    const on = plan.proposals.filter((p) => p.on);
    return { on: on.length, approval: on.filter((p) => this.agent.needsApproval(p)).length };
  }

  protected planConfirmLabel(plan: ItOsPlan): string {
    const { on, approval } = this.planCounts(plan);
    if (on && approval === on) return 'Submit for approval';
    if (approval) return `Apply ${on - approval}, submit ${approval}`;
    return `Apply ${on === 1 ? '1 change' : `${on} changes`}`;
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
