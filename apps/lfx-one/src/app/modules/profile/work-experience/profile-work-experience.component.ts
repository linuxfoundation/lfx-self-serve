// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TableComponent } from '@components/table/table.component';
import { LFX_ONE_WORK_EXPERIENCE_SOURCE, MONTH_OPTIONS } from '@lfx-one/shared/constants';
import { WorkExperienceCreateUpdateBody, WorkExperienceEntry, WorkExperienceFormDialogData } from '@lfx-one/shared/interfaces';
import { monthYearToIsoDate } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, Subject, switchMap, take } from 'rxjs';

import { UserService } from '../../../shared/services/user.service';
import { WorkExperienceDeleteDialogComponent } from '../components/work-experience-delete-dialog/work-experience-delete-dialog.component';
import { WorkExperienceFormDialogComponent } from '../components/work-experience-form-dialog/work-experience-form-dialog.component';

@Component({
  selector: 'lfx-profile-work-experience',
  imports: [ButtonComponent, CardComponent, MenuComponent, TableComponent],
  providers: [DialogService],
  templateUrl: './profile-work-experience.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileWorkExperienceComponent {
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);

  public readonly hideHeader = input(false);
  public readonly workExperienceChanged = output<void>();

  public readonly refreshTrigger$ = new Subject<void>();
  public readonly apiWorkExperience: Signal<WorkExperienceEntry[]> = this.initApiWorkExperience();

  public readonly workExperience: Signal<WorkExperienceEntry[]> = computed(() => this.apiWorkExperience());
  public readonly sortedExperience: Signal<WorkExperienceEntry[]> = this.initSortedExperience();
  public readonly isEmpty: Signal<boolean> = computed(() => this.workExperience().length === 0);
  public readonly menuItemsMap: Signal<Map<string, MenuItem[]>> = this.initMenuItemsMap();

  public onAdd(): void {
    const data: WorkExperienceFormDialogData = { mode: 'add' };

    const dialogRef = this.dialogService.open(WorkExperienceFormDialogComponent, {
      header: 'Add work experience',
      width: '672px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        const body: WorkExperienceCreateUpdateBody = {
          organizationId: result.organizationId,
          jobTitle: result.role,
          source: LFX_ONE_WORK_EXPERIENCE_SOURCE,
          startDate: monthYearToIsoDate(result.startMonth, result.startYear),
          endDate: result.currentlyWorkHere ? null : monthYearToIsoDate(result.endMonth, result.endYear),
        };

        this.userService
          .createWorkExperience(body)
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.refreshTrigger$.next();
              this.workExperienceChanged.emit();
            },
            error: () => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to add work experience.' });
            },
          });
      }
    });
  }

  public onEdit(item: WorkExperienceEntry): void {
    const data: WorkExperienceFormDialogData = {
      mode: 'edit',
      experience: {
        id: item.id,
        organization: item.organization,
        organizationId: item.organizationId,
        role: item.jobTitle,
        startDate: item.startDate,
        endDate: item.endDate,
        status: 'Verified',
      },
    };

    const dialogRef = this.dialogService.open(WorkExperienceFormDialogComponent, {
      header: 'Edit work experience',
      width: '672px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        const body: WorkExperienceCreateUpdateBody = {
          organizationId: result.organizationId || item.organizationId || '',
          jobTitle: result.role,
          source: item.cdpSource || LFX_ONE_WORK_EXPERIENCE_SOURCE,
          startDate: monthYearToIsoDate(result.startMonth, result.startYear),
          endDate: result.currentlyWorkHere ? null : monthYearToIsoDate(result.endMonth, result.endYear),
        };

        this.userService
          .updateWorkExperience(item.id, body)
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.refreshTrigger$.next();
              this.workExperienceChanged.emit();
            },
            error: () => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update work experience.' });
            },
          });
      }
    });
  }

  public onDelete(item: WorkExperienceEntry): void {
    const dialogRef = this.dialogService.open(WorkExperienceDeleteDialogComponent, {
      header: 'Delete work experience',
      width: '448px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: {
        experience: {
          id: item.id,
          organization: item.organization,
          role: item.jobTitle,
          startDate: item.startDate,
          endDate: item.endDate,
          status: 'Verified',
        },
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        this.userService
          .deleteWorkExperience(item.id)
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.refreshTrigger$.next();
              this.workExperienceChanged.emit();
            },
            error: () => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete work experience.' });
            },
          });
      }
    });
  }

  public parseDate(dateStr: string): Date {
    const parts = dateStr.split(' ');
    if (parts.length !== 2) {
      return new Date(0);
    }
    const monthEntry = MONTH_OPTIONS.find((m) => m.label.startsWith(parts[0]));
    const monthIndex = monthEntry ? parseInt(monthEntry.value, 10) - 1 : 0;
    return new Date(parseInt(parts[1], 10), monthIndex);
  }

  private initMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      for (const item of this.sortedExperience()) {
        map.set(item.id, [
          { label: 'Edit', icon: 'fa-light fa-pencil', command: () => this.onEdit(item) },
          { label: 'Delete', icon: 'fa-light fa-trash', styleClass: 'text-red-500', command: () => this.onDelete(item) },
        ]);
      }
      return map;
    });
  }

  private initApiWorkExperience(): Signal<WorkExperienceEntry[]> {
    return toSignal(
      this.refreshTrigger$.pipe(
        startWith(undefined),
        switchMap(() => this.userService.getWorkExperiences())
      ),
      { initialValue: [] }
    );
  }

  private initSortedExperience(): Signal<WorkExperienceEntry[]> {
    return computed(() => [...this.workExperience()].sort((a, b) => this.parseDate(b.startDate).getTime() - this.parseDate(a.startDate).getTime()));
  }
}
