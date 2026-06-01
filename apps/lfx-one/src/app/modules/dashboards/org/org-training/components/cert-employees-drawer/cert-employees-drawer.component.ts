// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OrgLensTrainingService } from '@app/shared/services/org-lens-training.service';
import type { OrgCertEmployee, OrgCertEmployeesResponse, OrgCertEmployeeStatus } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, finalize, of, skip, switchMap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

const AVATAR_COLORS = ['bg-blue-600', 'bg-purple-600', 'bg-emerald-600', 'bg-orange-500', 'bg-red-500', 'bg-teal-600', 'bg-indigo-600', 'bg-amber-500'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[Math.abs(hash)];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

@Component({
  selector: 'lfx-cert-employees-drawer',
  imports: [FormsModule, DrawerModule, InputTextModule],
  templateUrl: './cert-employees-drawer.component.html',
})
export class CertEmployeesDrawerComponent {
  private readonly trainingService = inject(OrgLensTrainingService);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  public readonly courseId = input<string>('');
  public readonly certificationName = input<string>('');
  public readonly status = input<OrgCertEmployeeStatus>('certified');
  public readonly count = input<number>(0);

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);

  private readonly employeesData = this.initEmployeesData();

  protected readonly heading = computed<string>(() => (this.status() === 'certified' ? 'Certified Employees' : 'In Progress'));
  protected readonly statusLabel = computed<string>(() => (this.status() === 'certified' ? 'Certified' : 'In Progress'));
  protected readonly statusBadgeClass = computed<string>(() =>
    this.status() === 'certified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
  );

  protected readonly filteredEmployees = computed<OrgCertEmployee[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const data = this.employeesData()?.data ?? [];
    if (!term) return [...data];
    return data.filter((e) => e.name.toLowerCase().includes(term) || (e.jobTitle ?? '').toLowerCase().includes(term));
  });

  protected avatarColor(name: string): string {
    return avatarColor(name);
  }

  protected initials(name: string): string {
    return initials(name);
  }

  private initEmployeesData() {
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((isVisible) => {
          if (!isVisible || !this.orgUid() || !this.courseId()) return of(null);
          this.searchTerm.set('');
          this.loading.set(true);
          return this.trainingService.getCertificationEmployees(this.orgUid(), this.courseId(), this.status()).pipe(
            catchError(() =>
              of({
                courseId: this.courseId(),
                certificationName: this.certificationName(),
                status: this.status(),
                total: 0,
                data: [],
              } as OrgCertEmployeesResponse)
            ),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
