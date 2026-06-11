// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import {
  OSSPREY_ECOSYSTEM_OPTIONS,
  OSSPREY_HEALTH_OPTIONS,
  OSSPREY_LIFECYCLE_OPTIONS,
  OSSPREY_SORT_OPTIONS,
  OSSPREY_STATUS_PILLS,
  OSSPREY_VULN_OPTIONS,
} from '@lfx-one/shared/constants';
import { OsspreyFilterChip, OsspreyFilterState, OsspreyPackage, OsspreyStatusCounts } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  formatStatus,
  getAdvisoryTagSeverity,
  getEcosystemIconClass,
  getHealthLabel,
  getHealthTagSeverity,
  getLifecycleLabel,
  getLifecycleTagSeverity,
  getStatusTagSeverity,
} from '../../ossprey.utils';

@Component({
  selector: 'lfx-ossprey-packages-tab',
  imports: [ButtonComponent, CheckboxComponent, SelectComponent, TableComponent, TagComponent],
  templateUrl: './ossprey-packages-tab.component.html',
})
export class OsspreyPackagesTabComponent {
  private readonly formBuilder = inject(FormBuilder);

  public readonly packages = input<OsspreyPackage[]>([]);
  public readonly filteredPackages = input<OsspreyPackage[]>([]);
  public readonly loading = input<boolean>(false);
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

  protected readonly statusPills = OSSPREY_STATUS_PILLS;
  protected readonly sortOptions = OSSPREY_SORT_OPTIONS;
  protected readonly ecosystemOptions = OSSPREY_ECOSYSTEM_OPTIONS;
  protected readonly lifecycleOptions = OSSPREY_LIFECYCLE_OPTIONS;
  protected readonly healthOptions = OSSPREY_HEALTH_OPTIONS;
  protected readonly vulnOptions = OSSPREY_VULN_OPTIONS;

  // Draft filter state — synced from filters() when the panel opens, committed on Apply.
  protected readonly filterForm = this.formBuilder.nonNullable.group({
    ecosystem: '',
    lifecycle: '',
    healthBand: '',
    vulnFilter: '',
    busFactor1Only: false,
    staleOnly: false,
    unstewardedOnly: false,
  });

  protected readonly sortLabel = computed(() => this.sortOptions.find((option) => option.value === this.filters().sort)?.label ?? 'Risk priority');

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
  protected readonly getHealthLabel = getHealthLabel;
  protected readonly getAdvisoryTagSeverity = getAdvisoryTagSeverity;
  protected readonly getEcosystemIconClass = getEcosystemIconClass;

  protected isPackageSelected(id: string): boolean {
    return this.selectedPackages().has(id);
  }

  protected onToggleAllClick(): void {
    this.toggleAll.emit({ checked: !this.allSelected() });
  }

  protected getStewardNames(stewardIds: string[]): string {
    if (stewardIds.length === 0) return '—';
    if (stewardIds.length === 1) return stewardIds[0];
    return `${stewardIds.length} stewards`;
  }

  protected onSearchInput(event: Event): void {
    this.filterChange.emit({ search: (event.target as HTMLInputElement).value });
  }

  protected toggleSortMenu(): void {
    this.sortMenuOpen.update((open) => !open);
    this.filterPanelOpen.set(false);
  }

  protected toggleFilterPanel(): void {
    const willOpen = !this.filterPanelOpen();
    this.filterPanelOpen.update((open) => !open);
    this.sortMenuOpen.set(false);
    if (willOpen) {
      const f = this.filters();
      this.filterForm.setValue({
        ecosystem: f.ecosystem,
        lifecycle: f.lifecycle,
        healthBand: f.healthBand,
        vulnFilter: f.vulnFilter,
        busFactor1Only: f.busFactor1Only,
        staleOnly: f.staleOnly,
        unstewardedOnly: f.unstewardedOnly,
      });
    }
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.filterChange.emit({
      ecosystem: value.ecosystem as OsspreyFilterState['ecosystem'],
      lifecycle: value.lifecycle as OsspreyFilterState['lifecycle'],
      healthBand: value.healthBand as OsspreyFilterState['healthBand'],
      vulnFilter: value.vulnFilter as OsspreyFilterState['vulnFilter'],
      busFactor1Only: value.busFactor1Only,
      staleOnly: value.staleOnly,
      unstewardedOnly: value.unstewardedOnly,
    });
    this.filterPanelOpen.set(false);
  }

  protected resetAllFilters(): void {
    this.filterForm.reset();
    this.clearFilters.emit();
    this.filterPanelOpen.set(false);
  }

  protected onSortSelect(value: string): void {
    this.sortChange.emit(value);
    this.sortMenuOpen.set(false);
  }
}
