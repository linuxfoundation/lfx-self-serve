// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal } from '@angular/core';
import { OsspreyEcosystem, OsspreyFilterChip, OsspreyFilterState, OsspreyHealthBand, OsspreyLifecycle, OsspreyPackage, OsspreyStatusCounts } from '@lfx-one/shared/interfaces';
import { OsspreyService } from '@shared/services/ossprey.service';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  formatStatus,
  getAdvisoryTagSeverity,
  getHealthTagSeverity,
  getLifecycleLabel,
  getLifecycleTagSeverity,
  getStatusTagSeverity,
} from '../../ossprey.utils';

@Component({
  selector: 'lfx-ossprey-packages-tab',
  imports: [ButtonComponent, TableComponent, TagComponent],
  templateUrl: './ossprey-packages-tab.component.html',
  styleUrl: './ossprey-packages-tab.component.scss',
})
export class OsspreyPackagesTabComponent {
  private readonly osspreyService = inject(OsspreyService);

  public readonly packages = input<OsspreyPackage[]>([]);
  public readonly filteredPackages = input<OsspreyPackage[]>([]);
  public readonly statusCounts = input<OsspreyStatusCounts>({
    all: 0,
    unassigned: 0,
    open: 0,
    assessing: 0,
    active: 0,
    needs_attention: 0,
    escalated: 0,
    blocked: 0,
    inactive: 0,
  });
  public readonly filters = input<OsspreyFilterState>({
    search: '',
    tab: 'all',
    sort: 'risk',
    ecosystem: '',
    lifecycle: '',
    healthBand: '',
    vulnFilter: '',
    busFactor1Only: false,
    staleOnly: false,
    unstewardedOnly: false,
  });
  public readonly selectedPackages = input<Set<string>>(new Set());

  public readonly filterChange = output<Partial<OsspreyFilterState>>();
  public readonly sortChange = output<string>();
  public readonly packageClick = output<string>();
  public readonly togglePackage = output<{ id: string; event: Event }>();
  public readonly toggleAll = output<{ checked: boolean }>();
  public readonly clearFilters = output<void>();

  protected readonly sortMenuOpen = signal(false);
  protected readonly filterPanelOpen = signal(false);

  // Draft state — synced from filters() when panel opens, committed on Apply
  protected readonly draftEcosystem = signal<OsspreyEcosystem | ''>('');
  protected readonly draftLifecycle = signal<OsspreyLifecycle | ''>('');
  protected readonly draftHealthBand = signal<OsspreyHealthBand | ''>('');
  protected readonly draftVulnFilter = signal<'critical' | 'high' | 'any' | ''>('');
  protected readonly draftBusFactor1Only = signal(false);
  protected readonly draftStaleOnly = signal(false);
  protected readonly draftUnstewardedOnly = signal(false);

  protected readonly activeFilterChips = computed<OsspreyFilterChip[]>(() => {
    const f = this.filters();
    const chips: OsspreyFilterChip[] = [];
    if (f.ecosystem) chips.push({ label: `Ecosystem: ${f.ecosystem}`, clear: { ecosystem: '' } });
    if (f.lifecycle) chips.push({ label: `Lifecycle: ${f.lifecycle}`, clear: { lifecycle: '' } });
    if (f.healthBand) chips.push({ label: `Health: ${f.healthBand}`, clear: { healthBand: '' } });
    if (f.vulnFilter) chips.push({ label: `Vulns: ${f.vulnFilter}`, clear: { vulnFilter: '' } });
    if (f.busFactor1Only) chips.push({ label: 'Bus factor = 1', clear: { busFactor1Only: false } });
    if (f.staleOnly) chips.push({ label: 'No activity ≥18mo', clear: { staleOnly: false } });
    if (f.unstewardedOnly) chips.push({ label: 'Unstewarded only', clear: { unstewardedOnly: false } });
    return chips;
  });

  protected readonly allSelected = computed(() => {
    const filtered = this.filteredPackages();
    const selected = this.selectedPackages();
    return filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  });

  protected readonly formatStatus = formatStatus;
  protected readonly getLifecycleLabel = getLifecycleLabel;
  protected readonly getStatusTagSeverity = getStatusTagSeverity;
  protected readonly getLifecycleTagSeverity = getLifecycleTagSeverity;
  protected readonly getHealthTagSeverity = getHealthTagSeverity;
  protected readonly getAdvisoryTagSeverity = getAdvisoryTagSeverity;

  protected isPackageSelected(id: string): boolean {
    return this.selectedPackages().has(id);
  }

  protected onToggleAllClick(): void {
    this.toggleAll.emit({ checked: !this.allSelected() });
  }

  protected getStewardNames(stewardIds: string[]): string {
    if (stewardIds.length === 0) return '—';
    if (stewardIds.length === 1) {
      const name = this.osspreyService.getStewardName(stewardIds[0]);
      return name.length > 20 ? name.substring(0, 17) + '...' : name;
    }
    return `${stewardIds.length} stewards`;
  }

  protected toggleSortMenu(): void {
    this.sortMenuOpen.update((v) => !v);
    this.filterPanelOpen.set(false);
  }

  protected toggleFilterPanel(): void {
    const willOpen = !this.filterPanelOpen();
    this.filterPanelOpen.update((v) => !v);
    this.sortMenuOpen.set(false);
    if (willOpen) {
      const f = this.filters();
      this.draftEcosystem.set(f.ecosystem);
      this.draftLifecycle.set(f.lifecycle);
      this.draftHealthBand.set(f.healthBand);
      this.draftVulnFilter.set(f.vulnFilter);
      this.draftBusFactor1Only.set(f.busFactor1Only);
      this.draftStaleOnly.set(f.staleOnly);
      this.draftUnstewardedOnly.set(f.unstewardedOnly);
    }
  }

  protected applyFilters(): void {
    this.filterChange.emit({
      ecosystem: this.draftEcosystem(),
      lifecycle: this.draftLifecycle(),
      healthBand: this.draftHealthBand(),
      vulnFilter: this.draftVulnFilter(),
      busFactor1Only: this.draftBusFactor1Only(),
      staleOnly: this.draftStaleOnly(),
      unstewardedOnly: this.draftUnstewardedOnly(),
    });
    this.filterPanelOpen.set(false);
  }

  protected resetAllFilters(): void {
    this.draftEcosystem.set('');
    this.draftLifecycle.set('');
    this.draftHealthBand.set('');
    this.draftVulnFilter.set('');
    this.draftBusFactor1Only.set(false);
    this.draftStaleOnly.set(false);
    this.draftUnstewardedOnly.set(false);
    this.clearFilters.emit();
    this.filterPanelOpen.set(false);
  }

  protected onSortSelect(value: string): void {
    this.sortChange.emit(value);
    this.sortMenuOpen.set(false);
  }
}
