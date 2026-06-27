// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { OrgLensTrainingService } from '@app/shared/services/org-lens-training.service';
import { computePersonInitials } from '@app/shared/utils/person-avatar.util';
import { MAX_ORG_TRAINING_EMPLOYEES } from '@lfx-one/shared/constants';
import type { OrgCertEmployeeVm, OrgTrainingEmployeesResponse, OrgTrainingEmployeeStatus } from '@lfx-one/shared/interfaces';
import { avatarColorClass } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, finalize, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-training-employees-drawer',
  imports: [FormsModule, DrawerModule, InputTextModule, DecimalPipe],
  templateUrl: './training-employees-drawer.component.html',
})
export class TrainingEmployeesDrawerComponent {
  private readonly trainingService = inject(OrgLensTrainingService);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  public readonly courseId = input<string>('');
  public readonly trainingName = input<string>('');
  public readonly status = input<OrgTrainingEmployeeStatus>('completed');
  public readonly count = input<number>(0);

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);

  private readonly employeesData = this.initEmployeesData();

  protected readonly heading = computed<string>(() => (this.status() === 'completed' ? 'Completed Employees' : 'In Progress Employees'));
  protected readonly statusLabel = computed<string>(() => (this.status() === 'completed' ? 'Completed' : 'In Progress'));
  protected readonly statusBadgeClass = computed<string>(() =>
    this.status() === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
  );

  protected readonly filteredEmployees = computed<OrgCertEmployeeVm[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const data = this.employeesData()?.data ?? [];
    const matched = !term ? data : data.filter((e) => e.name.toLowerCase().includes(term) || (e.jobTitle ?? '').toLowerCase().includes(term));
    return matched.map((e) => ({ ...e, initials: computePersonInitials(e.name), avatarColorClass: avatarColorClass(e.contactId) }));
  });

  protected readonly rosterCap = MAX_ORG_TRAINING_EMPLOYEES;
  protected readonly isRosterCapped = computed<boolean>(() => this.count() > MAX_ORG_TRAINING_EMPLOYEES);

  private initEmployeesData() {
    const trigger$ = toObservable(
      computed(() => ({
        visible: this.visible(),
        orgUid: this.orgUid(),
        courseId: this.courseId(),
        status: this.status(),
      }))
    );

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, courseId, status }) => {
          if (!visible || !orgUid || !courseId) return of(null);
          this.searchTerm.set('');
          this.loading.set(true);
          return this.trainingService.getTrainingEmployees(orgUid, courseId, status).pipe(
            catchError(() =>
              of({
                courseId,
                trainingName: this.trainingName(),
                status,
                total: 0,
                data: [],
              } as OrgTrainingEmployeesResponse)
            ),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
