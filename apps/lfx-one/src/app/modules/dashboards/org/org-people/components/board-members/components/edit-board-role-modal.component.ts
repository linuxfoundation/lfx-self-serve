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

import { EmployeeAvatarComponent } from '@components/employee-avatar/employee-avatar.component';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';

/** Reassign a single Membership-Entitlement board seat to a new holder. Reuses the committee modal contracts. */
@Component({
  selector: 'lfx-edit-board-role-modal',
  standalone: true,
  imports: [FormsModule, InputTextModule, EmployeeAvatarComponent],
  templateUrl: './edit-board-role-modal.component.html',
})
export class EditBoardRoleModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly directory = inject(OrgPeopleDirectoryStateService);
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
  // Active-descendant pattern: keyboard navigates a highlighted option via ArrowUp/Down while focus
  // stays on the input. -1 means "nothing highlighted yet".
  protected readonly activeOptionIndex = signal<number>(-1);
  protected readonly optionIdPrefix = 'edit-board-employee-option-';

  protected readonly filteredEmployees: Signal<KeyContactEmployee[]> = computed(() => this.initFilteredEmployees());
  protected readonly saveEnabled: Signal<boolean> = computed(() => this.initSaveEnabled());
  protected readonly activeOptionId: Signal<string | null> = computed(() => this.initActiveOptionId());

  private readonly excludedEmails: Signal<Set<string>> = computed(() => this.initExcludedEmails());

  public constructor() {
    if (this.orgUid) {
      this.directory
        .getEmployees(this.orgUid)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (list) => this.employees.set(list),
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
    // The filtered list re-orders with every keystroke — drop the previous highlight so the user
    // doesn't accidentally Enter-select a stale option.
    this.activeOptionIndex.set(-1);
    if (this.duplicateError()) this.duplicateError.set(null);
    if (this.emailFormatError() && EMAIL_REGEX.test(value.trim())) {
      this.emailFormatError.set(null);
    }
  }

  protected onEmailBlur(): void {
    this.suggestionsOpen.set(false);
    this.activeOptionIndex.set(-1);
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
    this.activeOptionIndex.set(-1);
  }

  // Active-descendant keyboard handler: ArrowUp/Down navigate the listbox without moving focus, Enter
  // selects the highlight (else Save), Escape closes — keyboard users can't reach a suggestion otherwise.
  protected onEmailKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.suggestionsOpen()) {
        // Swallow so the parent PrimeNG dialog doesn't also close the modal on the same key.
        event.preventDefault();
        event.stopPropagation();
        this.suggestionsOpen.set(false);
        this.activeOptionIndex.set(-1);
      }
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;

    if (!this.suggestionsOpen() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      this.suggestionsOpen.set(true);
    }

    const options = this.filteredEmployees();
    if (options.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const idx = this.activeOptionIndex();
      this.activeOptionIndex.set(idx < 0 ? 0 : (idx + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const idx = this.activeOptionIndex();
      this.activeOptionIndex.set(idx < 0 ? options.length - 1 : (idx - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      const idx = this.activeOptionIndex();
      if (idx >= 0 && idx < options.length) {
        // A highlighted option wins over the form-level Save handler.
        event.preventDefault();
        event.stopPropagation();
        this.onSelectEmployee(options[idx]);
      }
    }
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

  private initActiveOptionId(): string | null {
    const idx = this.activeOptionIndex();
    if (idx < 0) return null;
    if (idx >= this.filteredEmployees().length) return null;
    return `${this.optionIdPrefix}${idx}`;
  }
}
