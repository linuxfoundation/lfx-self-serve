// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MAX_ORG_TRAINING_GROUP_EMPLOYEES } from '@lfx-one/shared/constants';
import type { OrgTrainingGroupEmployeeVm, OrgTrainingGroupEmployeesParams, OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
import { avatarColorClass } from '@lfx-one/shared/utils';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { computePersonInitials } from '@shared/utils/person-avatar.util';
import { DrawerModule } from 'primeng/drawer';
import { catchError, finalize, map, of, switchMap } from 'rxjs';

/** The one drill-down drawer of the Training page's group table: certified or in-progress person-course pairs of one row. */
@Component({
  selector: 'lfx-org-training-group-employees-drawer',
  imports: [ReactiveFormsModule, DrawerModule, DecimalPipe, ButtonComponent, InputTextComponent],
  templateUrl: './org-training-group-employees-drawer.component.html',
})
export class OrgTrainingGroupEmployeesDrawerComponent {
  private readonly trainingService = inject(OrgLensTrainingService);
  private readonly drawer = inject(PersonDetailDrawerService);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  /** Range and filters the table is showing; the drawer lists the same pairs. */
  public readonly query = input.required<OrgTrainingStatsQuery>();
  /** Which cell was clicked; null until one is. */
  public readonly params = input<OrgTrainingGroupEmployeesParams | null>(null);
  /** Row label shown in the subtitle. */
  public readonly label = input<string>('');
  /** Pair count of the clicked cell. */
  public readonly count = input<number>(0);

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });
  protected readonly loading = signal(false);
  // A failed fetch is stated as such (with Retry), never rendered as an empty list or a zero count.
  protected readonly error = signal(false);
  private readonly retryTrigger = signal(0);

  protected readonly searchTerm = toSignal(this.searchForm.controls.search.valueChanges.pipe(map((value) => value.trim())), { initialValue: '' });

  private readonly employeesData = this.initEmployeesData();

  private readonly isCompleted = computed<boolean>(() => this.params()?.status === 'completed');
  private readonly isCertificationsTab = computed<boolean>(() => this.params()?.tab === 'certifications');

  protected readonly statusLabel = computed<string>(() => {
    if (!this.isCompleted()) return 'In progress';
    return this.isCertificationsTab() ? 'Certified' : 'Completed';
  });
  protected readonly heading = computed<string>(() => `${this.statusLabel()} — ${this.isCertificationsTab() ? 'certifications' : 'trainings'}`);
  protected readonly statusBadgeClass = computed<string>(() => (this.isCompleted() ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'));
  // The clicked cell's pair count; the response's own total once it has loaded (the two are the same number).
  protected readonly pairCount = computed<number>(() => this.employeesData()?.total ?? this.count());

  protected readonly filteredEmployees = computed<OrgTrainingGroupEmployeeVm[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const data = this.employeesData()?.data ?? [];
    const matched = !term ? data : data.filter((e) => e.name.toLowerCase().includes(term) || (e.jobTitle ?? '').toLowerCase().includes(term));
    return matched.map((e) => ({ ...e, initials: computePersonInitials(e.name), avatarColorClass: avatarColorClass(e.contactId) }));
  });

  // The roster is capped server-side while the count is the number of person-course pairs — surface the gap so a truncated list isn't mistaken for the full set.
  protected readonly rosterCap = MAX_ORG_TRAINING_GROUP_EMPLOYEES;
  protected readonly isRosterCapped = computed<boolean>(() => (this.employeesData()?.data.length ?? 0) >= MAX_ORG_TRAINING_GROUP_EMPLOYEES);

  protected onPersonClick(employee: OrgTrainingGroupEmployeeVm): void {
    this.drawer.open({
      personKey: employee.contactId,
      name: employee.name,
      title: employee.jobTitle,
      initials: employee.initials,
      avatarColorClass: employee.avatarColorClass,
      defaultTab: 'training',
      // The Code tab's Maintainer pills follow the range this drawer lists the person in.
      range: this.query().range,
    });
  }

  protected retry(): void {
    this.retryTrigger.update((value) => value + 1);
  }

  private initEmployeesData() {
    // Key the fetch off the full target (visible + org + view + cell), so the list refreshes if the clicked cell changes while the drawer stays open.
    const trigger$ = toObservable(
      computed(() => ({
        visible: this.visible(),
        orgUid: this.orgUid(),
        query: this.query(),
        params: this.params(),
        retry: this.retryTrigger(),
      }))
    );

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, query, params }) => {
          if (!visible || !orgUid || !params) {
            this.error.set(false);
            return of(null);
          }
          this.searchForm.controls.search.setValue('');
          this.loading.set(true);
          this.error.set(false);
          return this.trainingService.getGroupEmployees(orgUid, query, params).pipe(
            catchError((error: unknown) => {
              console.error('Failed to load training group employees', error);
              this.error.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
