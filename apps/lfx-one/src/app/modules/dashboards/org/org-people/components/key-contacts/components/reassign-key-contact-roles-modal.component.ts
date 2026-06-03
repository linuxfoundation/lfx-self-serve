// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectorRef, Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { EMAIL_REGEX } from '@lfx-one/shared/constants';
import type {
  KeyContactEmployee,
  ReassignKeyContactRolesDialogData,
  ReassignKeyContactRolesPersonRef,
  ReassignKeyContactRolesRoleKey,
  ReassignKeyContactRolesRoleOption,
  ReassignKeyContactRolesSubmitEvent,
} from '@lfx-one/shared/interfaces';
import { CheckboxModule } from 'primeng/checkbox';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { take } from 'rxjs';

/** LFXV2-2067 — bulk-reassign one person's N (membership, role-TYPE) tuples; parent fans out the PUTs. */
@Component({
  selector: 'lfx-reassign-key-contact-roles-modal',
  standalone: true,
  imports: [FormsModule, InputTextModule, CheckboxModule],
  templateUrl: './reassign-key-contact-roles-modal.component.html',
})
export class ReassignKeyContactRolesModalComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly membershipsService = inject(OrgLensMembershipsService);
  private readonly dialogConfig = inject<DynamicDialogConfig<ReassignKeyContactRolesDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  // === Dialog-injected data ===
  protected readonly person: ReassignKeyContactRolesPersonRef | null = this.dialogConfig.data?.person ?? null;
  protected readonly roles: readonly ReassignKeyContactRolesRoleOption[] = this.dialogConfig.data?.roles ?? [];
  private readonly orgUid: string = this.dialogConfig.data?.orgUid ?? '';

  // Default: all selected so the most common workflow (full reassign) is one click.
  protected readonly selectedKeys = signal<Set<ReassignKeyContactRolesRoleKey>>(new Set(this.roles.map((r) => r.key)));

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

  protected readonly checkedCount: Signal<number> = computed(() => this.selectedKeys().size);
  protected readonly allChecked: Signal<boolean> = computed(() => this.roles.length > 0 && this.selectedKeys().size === this.roles.length);
  protected readonly noneChecked: Signal<boolean> = computed(() => this.selectedKeys().size === 0);
  protected readonly checkedFoundationCount: Signal<number> = computed(() => this.initCheckedFoundationCount());
  protected readonly subtitle: Signal<string> = computed(() => this.initSubtitle());
  protected readonly primaryButtonLabel: Signal<string> = computed(() => this.initPrimaryButtonLabel());
  protected readonly checkedKeyMap: Signal<Record<string, boolean>> = computed(() => this.initCheckedKeyMap());
  protected readonly filteredEmployees: Signal<KeyContactEmployee[]> = computed(() => this.initFilteredEmployees());
  protected readonly saveEnabled: Signal<boolean> = computed(() => this.initSaveEnabled());

  // Hide the current contact's own email from the typeahead — reassigning Hideo to Hideo is a no-op.
  private readonly excludedEmails: Signal<Set<string>> = computed(() => this.initExcludedEmails());

  public constructor() {
    if (this.orgUid) {
      this.membershipsService
        .getKeyContactEmployees(this.orgUid)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => this.employees.set(res.employees ?? []),
          error: () => this.employeeSearchUnavailable.set(true),
        });
    }
  }

  // === Selection handlers ===
  protected toggleSelectAll(): void {
    if (this.isSaving()) return;
    if (this.allChecked()) {
      this.selectedKeys.set(new Set());
    } else {
      this.selectedKeys.set(new Set(this.roles.map((r) => r.key)));
    }
  }

  protected toggleRole(key: ReassignKeyContactRolesRoleKey): void {
    if (this.isSaving()) return;
    this.selectedKeys.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    // Mousedown on a suggestion preventDefaults so click fires before blur — safe to close on blur.
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

  // === Save / cancel ===
  protected onSave(): void {
    if (!this.saveEnabled()) return;

    const enteredEmail = this.emailField().trim().toLowerCase();
    const currentEmail = this.person?.email?.trim().toLowerCase() ?? '';
    if (enteredEmail === currentEmail) {
      this.duplicateError.set('This person already holds the selected role(s).');
      return;
    }

    const selectedKeySet = this.selectedKeys();
    const selected = this.roles.filter((r) => selectedKeySet.has(r.key));
    if (selected.length === 0) return;

    const intent: ReassignKeyContactRolesSubmitEvent = {
      newPerson: {
        email: this.emailField().trim(),
        firstName: this.firstNameField().trim(),
        lastName: this.lastNameField().trim(),
        jobTitle: null,
      },
      selected,
    };

    const submit = this.dialogConfig.data?.submit;
    if (!submit) {
      // Defensive — production flows always inject submit; fall back to closing so the dialog isn't stuck.
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
        this.cdr.markForCheck();
      });
  }

  protected onCancel(): void {
    if (this.isSaving()) return;
    this.dialogRef.close(null);
  }

  // === Computed helpers ===
  private initCheckedFoundationCount(): number {
    const selected = this.selectedKeys();
    const slugs = new Set<string>();
    for (const r of this.roles) if (selected.has(r.key)) slugs.add(r.foundationSlug);
    return slugs.size;
  }

  private initSubtitle(): string {
    const n = this.checkedCount();
    const m = this.checkedFoundationCount();
    return `${n} ${n === 1 ? 'role' : 'roles'} across ${m} ${m === 1 ? 'foundation' : 'foundations'}`;
  }

  private initPrimaryButtonLabel(): string {
    if (this.isSaving()) return 'Reassigning…';
    const n = this.checkedCount();
    return `Save Changes (${n} ${n === 1 ? 'role' : 'roles'})`;
  }

  // O(1) per-row template lookup — avoids `isRoleChecked(role.key)` method calls inside @for.
  private initCheckedKeyMap(): Record<string, boolean> {
    const selected = this.selectedKeys();
    const map: Record<string, boolean> = {};
    for (const r of this.roles) map[r.key] = selected.has(r.key);
    return map;
  }

  private initExcludedEmails(): Set<string> {
    const set = new Set<string>();
    const currentEmail = this.person?.email?.trim().toLowerCase();
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
    if (this.noneChecked()) return false;
    const email = this.emailField().trim();
    if (!email || !EMAIL_REGEX.test(email)) return false;
    if (this.firstNameField().trim().length === 0) return false;
    if (this.lastNameField().trim().length === 0) return false;
    if (this.emailFormatError() || this.duplicateError()) return false;
    return true;
  }
}
