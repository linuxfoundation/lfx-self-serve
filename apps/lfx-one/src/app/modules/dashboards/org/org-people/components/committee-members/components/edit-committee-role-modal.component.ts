// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EMAIL_REGEX, votingStatusPillClass } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, EditCommitteeRoleDialogData, EditCommitteeRoleSubmitEvent, KeyContactEmployee } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { take } from 'rxjs';

import { CommitteeMembersService } from '../../../services/committee-members.service';

/** Spec 027 US4 — reassign a single Membership-Entitlement committee seat to a new holder. */
@Component({
  selector: 'lfx-edit-committee-role-modal',
  standalone: true,
  imports: [FormsModule, InputTextModule],
  templateUrl: './edit-committee-role-modal.component.html',
})
export class EditCommitteeRoleModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dataService = inject(CommitteeMembersService);
  private readonly dialogConfig = inject<DynamicDialogConfig<EditCommitteeRoleDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly assignment: CommitteeMemberAssignment | null = this.dialogConfig.data?.assignment ?? null;
  private readonly orgUid: string = this.dialogConfig.data?.orgUid ?? '';

  protected readonly votingStatusPillClass = votingStatusPillClass;

  protected readonly emailField = signal('');
  protected readonly firstNameField = signal('');
  protected readonly lastNameField = signal('');
  protected readonly emailFormatError = signal<string | null>(null);
  protected readonly duplicateError = signal<string | null>(null);

  protected readonly isSaving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly employees = signal<KeyContactEmployee[]>([]);
  protected readonly employeeSearchUnavailable = signal(false);
  protected readonly suggestionsOpen = signal(false);

  protected readonly filteredEmployees: Signal<KeyContactEmployee[]> = computed(() => this.initFilteredEmployees());
  protected readonly saveEnabled: Signal<boolean> = computed(() => this.initSaveEnabled());

  private readonly excludedEmails: Signal<Set<string>> = computed(() => this.initExcludedEmails());

  public constructor() {
    if (this.orgUid) {
      this.dataService
        .getEmployees(this.orgUid)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => this.employees.set(res.employees ?? []),
          error: () => this.employeeSearchUnavailable.set(true),
        });
    }
  }

  protected onEmailFocus(): void {
    this.suggestionsOpen.set(true);
  }

  protected onEmailChange(value: string): void {
    this.emailField.set(value);
    this.suggestionsOpen.set(true);
    if (this.duplicateError()) this.duplicateError.set(null);
    if (this.emailFormatError() && EMAIL_REGEX.test(value.trim())) {
      this.emailFormatError.set(null);
    }
  }

  protected onEmailBlur(): void {
    this.suggestionsOpen.set(false);
    this.duplicateError.set(null);
    const value = this.emailField().trim();
    if (value && !EMAIL_REGEX.test(value)) {
      this.emailFormatError.set('Enter a valid email address');
    } else {
      this.emailFormatError.set(null);
    }
  }

  protected onSelectEmployee(employee: KeyContactEmployee): void {
    this.emailField.set(employee.email);
    this.firstNameField.set(employee.firstName);
    this.lastNameField.set(employee.lastName);
    this.emailFormatError.set(null);
    this.duplicateError.set(null);
    this.suggestionsOpen.set(false);
  }

  protected onFormKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.saveEnabled()) {
      event.preventDefault();
      this.onSave();
    }
  }

  protected onSave(): void {
    if (!this.saveEnabled() || !this.assignment) return;

    const enteredEmail = this.emailField().trim().toLowerCase();
    const currentEmail = this.assignment.person.email?.trim().toLowerCase() ?? '';
    if (enteredEmail === currentEmail) {
      this.duplicateError.set('This person already holds this role.');
      return;
    }

    const intent: EditCommitteeRoleSubmitEvent = {
      memberUid: this.assignment.memberUid,
      committeeUid: this.assignment.committeeUid,
      newPerson: {
        email: this.emailField().trim(),
        firstName: this.firstNameField().trim(),
        lastName: this.lastNameField().trim(),
      },
    };

    const submit = this.dialogConfig.data?.submit;
    if (!submit) {
      this.dialogRef.close(null);
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);
    submit(intent)
      .then(() => this.dialogRef.close(null))
      .catch((e: unknown) => {
        this.isSaving.set(false);
        this.saveError.set(e instanceof Error ? e.message : 'Could not save changes. Please try again.');
      });
  }

  protected onCancel(): void {
    if (this.isSaving()) return;
    this.dialogRef.close(null);
  }

  private initExcludedEmails(): Set<string> {
    const set = new Set<string>();
    const currentEmail = this.assignment?.person.email?.trim().toLowerCase();
    if (currentEmail) set.add(currentEmail);
    return set;
  }

  private initFilteredEmployees(): KeyContactEmployee[] {
    const query = this.emailField().trim().toLowerCase();
    if (!query) return [];
    const excluded = this.excludedEmails();
    return this.employees()
      .filter((e) => !excluded.has(e.email.trim().toLowerCase()))
      .filter((e) => e.email.toLowerCase().includes(query) || e.fullName.toLowerCase().includes(query))
      .slice(0, 8);
  }

  private initSaveEnabled(): boolean {
    if (this.isSaving()) return false;
    const email = this.emailField().trim();
    if (!email || !EMAIL_REGEX.test(email)) return false;
    if (this.firstNameField().trim().length === 0) return false;
    if (this.lastNameField().trim().length === 0) return false;
    if (this.emailFormatError() || this.duplicateError()) return false;
    return true;
  }
}
