// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { PersonProfilePanelService } from '@services/person-profile-panel.service';
import { EMPTY_ORG_KEY_CONTACTS_RESPONSE } from '@lfx-one/shared/constants';
import type {
  OrgKeyContactAssignment,
  OrgKeyContactAssignmentVm,
  OrgKeyContactDropdownOption,
  OrgKeyContactPersonGroupVm,
  OrgKeyContactSortColumn,
  OrgKeyContactSortDirection,
  OrgKeyContactsResponse,
} from '@lfx-one/shared/interfaces';
import { SkeletonModule } from 'primeng/skeleton';

import { KeyContactsService } from '../../services/key-contacts.service';
import { rolePillClass } from './helpers/key-contacts.helper';

/** Org Lens — People → Key Contacts tab. V1 is pure-read (stat strip + grouped expandable table); both edit paths are gated on LFXV2-1677. */
@Component({
  selector: 'lfx-org-people-key-contacts',
  imports: [DecimalPipe, ReactiveFormsModule, InputTextComponent, SelectComponent, SkeletonModule, EmptyStateComponent],
  templateUrl: './key-contacts.component.html',
})
export class KeyContactsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(KeyContactsService);
  private readonly personPanel = inject(PersonProfilePanelService);

  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    role: new FormControl<string>('', { nonNullable: true }),
  });

  // WritableSignals — keep grouped per component-organization.md (writables → computed/toSignal).
  protected readonly sortColumn = signal<OrgKeyContactSortColumn>('name');
  protected readonly sortDirection = signal<OrgKeyContactSortDirection>(1);
  protected readonly expansion = signal<Record<string, boolean>>({});
  protected readonly retryTrigger = signal<number>(0);
  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);

  // Computed / toSignal / readonly views — derived signals follow the writable block.
  protected readonly isLoading = this.loadingState.asReadonly();
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  // Mirror reactive form into a signal so computeds re-run on input — FormGroup.value is not a signal.
  private readonly filterValues = toSignal(this.filterForm.valueChanges.pipe(debounceTime(150)), {
    initialValue: this.filterForm.getRawValue(),
  });

  // Scoped on b2b_org UUID (not legacy sfid); gated on `!!uid` so skeleton holds until org-selector populates it.
  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgKeyContactsResponse> = this.initResponse();

  protected readonly stats = computed(() => this.response().stats);

  protected readonly foundationOptions: Signal<OrgKeyContactDropdownOption[]> = computed(() => this.initFoundationOptions());
  protected readonly roleOptions: Signal<OrgKeyContactDropdownOption[]> = computed(() => this.initRoleOptions());
  protected readonly groupedPeople: Signal<OrgKeyContactPersonGroupVm[]> = computed(() => this.initGroupedPeople());
  protected readonly filteredGroups: Signal<OrgKeyContactPersonGroupVm[]> = computed(() => this.initFilteredGroups());
  protected readonly sortedGroups: Signal<OrgKeyContactPersonGroupVm[]> = computed(() => this.initSortedGroups());

  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());

  protected readonly hasUnfilledRoles: Signal<boolean> = computed(() => this.stats().unfilledRequiredRoleCount > 0);

  protected readonly ariaSortMap: Signal<Record<OrgKeyContactSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());
  protected readonly sortIconMap: Signal<Record<OrgKeyContactSortColumn, string>> = computed(() => this.initSortIconMap());

  public constructor() {
    // Clear expansion/filter state only when the org uid actually changes (skip(1) drops the initial sync emission).
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.resetAllState());
  }

  protected onSort(column: OrgKeyContactSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    this.sortDirection.set(column === 'name' ? 1 : -1);
  }

  protected toggleExpansion(email: string): void {
    this.expansion.update((state) => {
      const next = { ...state };
      if (next[email]) delete next[email];
      else next[email] = true;
      return next;
    });
  }

  protected onRowKeydown(event: KeyboardEvent, email: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleExpansion(email);
  }

  protected onPersonClick(group: OrgKeyContactPersonGroupVm, event: Event): void {
    event.stopPropagation();
    this.personPanel.open(group.displayName);
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initFoundationOptions(): OrgKeyContactDropdownOption[] {
    const slugs = new Map<string, string>();
    for (const a of this.response().assignments) {
      if (!slugs.has(a.foundationSlug)) {
        slugs.set(a.foundationSlug, a.foundationName ?? a.foundationSlug);
      }
    }
    const options = [...slugs.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ label, value }));
    return [{ label: 'All Foundations', value: '' }, ...options];
  }

  private initRoleOptions(): OrgKeyContactDropdownOption[] {
    const roles = [...new Set(this.response().assignments.map((a) => a.role))].sort((a, b) => a.localeCompare(b));
    return [{ label: 'All Roles', value: '' }, ...roles.map((role) => ({ label: role, value: role }))];
  }

  private initGroupedPeople(): OrgKeyContactPersonGroupVm[] {
    const byEmail = new Map<string, OrgKeyContactAssignment[]>();
    for (const a of this.response().assignments) {
      const key = a.email.toLowerCase();
      const list = byEmail.get(key) ?? [];
      list.push(a);
      byEmail.set(key, list);
    }

    return [...byEmail.values()].map((assignments) => {
      const first = assignments[0];
      const roles = [...new Set(assignments.map((a) => a.role))].sort();
      const foundationSlugs = new Set(assignments.map((a) => a.foundationSlug));
      const sortedRaw = [...assignments].sort((a, b) => {
        const slugCmp = a.foundationSlug.localeCompare(b.foundationSlug);
        if (slugCmp !== 0) return slugCmp;
        return a.role.localeCompare(b.role);
      });
      const sortedAssignments: OrgKeyContactAssignmentVm[] = sortedRaw.map((a, idx) => ({
        ...a,
        pillClass: rolePillClass(a.role),
        showFoundationLabel: idx === 0 || sortedRaw[idx - 1].foundationSlug !== a.foundationSlug,
        foundationLabel: a.foundationName ?? a.foundationSlug,
      }));
      return {
        email: first.email,
        displayName: first.displayName,
        title: first.title,
        roles,
        foundationCount: foundationSlugs.size,
        assignments,
        canEditAny: assignments.some((a) => a.canEdit),
        rolePills: roles.map((role) => ({ role, pillClass: rolePillClass(role) })),
        sortedAssignments,
      };
    });
  }

  private initIsFiltering(): boolean {
    const values = this.filterValues();
    const search = (values.search ?? '').trim();
    return search.length > 0 || !!(values.foundation ?? '') || !!(values.role ?? '');
  }

  private initFilteredGroups(): OrgKeyContactPersonGroupVm[] {
    const values = this.filterValues();
    const q = (values.search ?? '').trim().toLowerCase();
    const foundation = values.foundation ?? '';
    const role = values.role ?? '';

    return this.groupedPeople().filter((group) => {
      if (q) {
        const inName = group.displayName.toLowerCase().includes(q);
        const inTitle = (group.title ?? '').toLowerCase().includes(q);
        const inEmail = group.email.toLowerCase().includes(q);
        if (!inName && !inTitle && !inEmail) return false;
      }
      if (foundation && !group.assignments.some((a) => a.foundationSlug === foundation)) return false;
      if (role && !group.assignments.some((a) => a.role === role)) return false;
      return true;
    });
  }

  private initSortedGroups(): OrgKeyContactPersonGroupVm[] {
    const filtered = this.filteredGroups();
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...filtered];

    copy.sort((a, b) => {
      if (col === 'name') {
        return a.displayName.localeCompare(b.displayName) * dir;
      }
      if (col === 'roles') {
        const ra = a.roles.join(', ');
        const rb = b.roles.join(', ');
        const cmp = ra.localeCompare(rb);
        if (cmp !== 0) return cmp * dir;
        return a.displayName.localeCompare(b.displayName);
      }
      if (a.foundationCount !== b.foundationCount) {
        return (a.foundationCount - b.foundationCount) * dir;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return copy;
  }

  private initAriaSortMap(): Record<OrgKeyContactSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      roles: active === 'roles' ? direction : 'none',
      foundations: active === 'foundations' ? direction : 'none',
    };
  }

  private initResponse(): Signal<OrgKeyContactsResponse> {
    return toSignal(
      combineLatest([this.orgUid$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid]) => {
          if (!orgUid) {
            // Hold the skeleton until the org selector populates a uid — flipping loadingState to false here would
            // briefly render the "no data" empty state on mount before the account-context emits the real uid.
            return of(EMPTY_ORG_KEY_CONTACTS_RESPONSE);
          }
          return this.dataService.getKeyContacts(orgUid).pipe(
            tap(() => this.loadingState.set(false)),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of(EMPTY_ORG_KEY_CONTACTS_RESPONSE);
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_KEY_CONTACTS_RESPONSE }
    );
  }

  private initSortIconMap(): Record<OrgKeyContactSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: OrgKeyContactSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      roles: iconFor('roles'),
      foundations: iconFor('foundations'),
    };
  }

  private resetAllState(): void {
    this.filterForm.reset({ search: '', foundation: '', role: '' });
    this.sortColumn.set('name');
    this.sortDirection.set(1);
    this.expansion.set({});
  }
}
