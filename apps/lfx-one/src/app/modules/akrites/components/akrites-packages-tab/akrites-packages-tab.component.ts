// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder } from '@angular/forms';
import {
  AKRITES_ASSIGNABLE_STATUSES,
  AKRITES_ECOSYSTEM_OPTIONS,
  AKRITES_HEALTH_OPTIONS,
  AKRITES_LIFECYCLE_OPTIONS,
  AKRITES_SORT_OPTIONS,
  AKRITES_STATUS_PILLS,
  AKRITES_VULN_OPTIONS,
} from '@lfx-one/shared/constants';
import { AkritesAssignStewardRequest, AkritesFilterChip, AkritesFilterState, AkritesPackage, AkritesStatusCounts } from '@lfx-one/shared/interfaces';
import { AkritesService } from '@shared/services/akrites.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { MessageService } from 'primeng/api';
import { map, of, switchMap, take } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { AkritesAssignStewardModalComponent } from '../akrites-assign-steward-modal/akrites-assign-steward-modal.component';
import { StewardInitialsPipe } from '../../pipes/steward-initials.pipe';
import {
  formatStatus,
  getAdvisoryTagSeverity,
  getHealthLabel,
  getHealthTagSeverity,
  getLifecycleLabel,
  getLifecycleTagSeverity,
  getStatusTagSeverity,
} from '../../akrites.utils';

@Component({
  selector: 'lfx-akrites-packages-tab',
  imports: [
    AkritesAssignStewardModalComponent,
    ButtonComponent,
    CheckboxComponent,
    MenuComponent,
    SelectComponent,
    StewardInitialsPipe,
    TableComponent,
    TagComponent,
  ],
  templateUrl: './akrites-packages-tab.component.html',
})
export class AkritesPackagesTabComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly formBuilder = inject(FormBuilder);

  public readonly packages = input<AkritesPackage[]>([]);
  public readonly filteredPackages = input<AkritesPackage[]>([]);
  public readonly loading = input<boolean>(false);
  public readonly statusCounts = input<AkritesStatusCounts>({
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
  public readonly filters = input<AkritesFilterState>({
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
    page: 1,
    pageSize: 25,
  });
  public readonly total = input<number>(0);
  public readonly selectedPackages = input<Set<string>>(new Set());

  public readonly filterChange = output<Partial<AkritesFilterState>>();
  public readonly sortChange = output<string>();
  public readonly packageClick = output<string>();
  public readonly togglePackage = output<{ id: string; event: Event }>();
  public readonly toggleAll = output<{ checked: boolean }>();
  public readonly clearFilters = output<void>();
  public readonly pageChange = output<{ page: number; pageSize: number }>();
  public readonly stewardshipChanged = output<void>();

  protected readonly sortMenuOpen = signal(false);
  protected readonly filterPanelOpen = signal(false);
  protected readonly assignModalVisible = signal(false);
  protected readonly assignTargetPackage = signal<AkritesPackage | null>(null);
  protected readonly actionLoading = signal(false);
  protected readonly canWrite = computed(() => this.projectContextService.canWrite());
  protected readonly assignablePackageIds = computed(
    () =>
      new Set(
        this.packages()
          .filter((p) => AKRITES_ASSIGNABLE_STATUSES.has(p.status))
          .map((p) => p.id)
      )
  );

  protected readonly statusPills = AKRITES_STATUS_PILLS;
  protected readonly sortOptions = AKRITES_SORT_OPTIONS;
  protected readonly ecosystemOptions = AKRITES_ECOSYSTEM_OPTIONS;
  protected readonly lifecycleOptions = AKRITES_LIFECYCLE_OPTIONS;
  protected readonly healthOptions = AKRITES_HEALTH_OPTIONS;
  protected readonly vulnOptions = AKRITES_VULN_OPTIONS;

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

  protected readonly activeFilterChips = computed<AkritesFilterChip[]>(() => {
    const f = this.filters();
    const chips: AkritesFilterChip[] = [];
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

  protected readonly rowActionItems = computed(() => [
    {
      label: 'Assign stewardship',
      icon: 'fa-light fa-user-plus',
      command: () => {
        this.assignModalVisible.set(true);
      },
    },
  ]);

  protected isPackageSelected(id: string): boolean {
    return this.selectedPackages().has(id);
  }

  protected onToggleAllClick(): void {
    this.toggleAll.emit({ checked: !this.allSelected() });
  }

  protected onSearchInput(event: Event): void {
    this.filterChange.emit({ search: (event.target as HTMLInputElement).value });
  }

  protected onChipRemove(clear: Partial<AkritesFilterState>): void {
    this.filterChange.emit(clear);
    this.filterForm.patchValue(clear as Parameters<typeof this.filterForm.patchValue>[0]);
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
      ecosystem: value.ecosystem as AkritesFilterState['ecosystem'],
      lifecycle: value.lifecycle as AkritesFilterState['lifecycle'],
      healthBand: value.healthBand as AkritesFilterState['healthBand'],
      vulnFilter: value.vulnFilter as AkritesFilterState['vulnFilter'],
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

  protected onTablePage(event: { first: number; rows: number }): void {
    const page = Math.floor(event.first / event.rows) + 1;
    this.pageChange.emit({ page, pageSize: event.rows });
  }

  protected onRowMenuOpen(event: Event, pkg: AkritesPackage, menu: { toggle: (e: Event) => void }): void {
    this.assignTargetPackage.set(pkg);
    menu.toggle(event);
  }

  protected onAssignStewardConfirm(body: AkritesAssignStewardRequest): void {
    const pkg = this.assignTargetPackage();
    if (!pkg || this.actionLoading()) return;
    this.actionLoading.set(true);

    const stewardshipId$ =
      pkg.stewardshipId !== null ? of(String(pkg.stewardshipId)) : this.akritesService.openStewardship(pkg.purl).pipe(map((res) => res.stewardship.id));

    stewardshipId$
      .pipe(
        switchMap((id) => this.akritesService.assignSteward(id, body)),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.assignModalVisible.set(false);
          this.assignTargetPackage.set(null);
          this.actionLoading.set(false);
          this.messageService.add({ severity: 'success', summary: 'Assigned', detail: `Steward assigned to ${pkg.name}.` });
          this.stewardshipChanged.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not assign steward. Please try again.' });
        },
      });
  }
}
