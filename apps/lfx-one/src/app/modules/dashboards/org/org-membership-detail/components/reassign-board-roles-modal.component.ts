// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { OrgLensBoardCommitteeService } from '@services/org-lens-board-committee.service';
import { EMAIL_REGEX, SIMULATED_SAVE_DELAY_MS } from '@lfx-one/shared/constants';
import type { BoardSeat, CommitteeSeat, KeyContactEmployee, ReassignBoardRolesDialogData, ReassignBoardRolesDialogResult } from '@lfx-one/shared/interfaces';
import { CheckboxModule } from 'primeng/checkbox';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-reassign-board-roles-modal',
  standalone: true,
  imports: [FormsModule, InputTextModule, CheckboxModule],
  templateUrl: './reassign-board-roles-modal.component.html',
})
export class ReassignBoardRolesModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<ReassignBoardRolesDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly boardCommitteeService = inject(OrgLensBoardCommitteeService);

  // === Dialog-injected data ===
  protected readonly seat: BoardSeat | CommitteeSeat | null = this.dialogConfig.data?.seat ?? null;
  protected readonly seatKind: 'board' | 'committee' = this.dialogConfig.data?.seatKind ?? 'board';
  protected readonly foundationName: string = this.dialogConfig.data?.foundationName ?? '';
  private readonly orgUid: string = this.dialogConfig.data?.orgUid ?? '';

  // === Employee picker (loaded once on open, filtered client-side; manual entry stays available on failure) ===
  protected readonly employees = signal<KeyContactEmployee[]>([]);
  protected readonly employeeSearchUnavailable = signal(false);
  protected readonly suggestionsOpen = signal(false);
  /** Index of the keyboard-highlighted suggestion (ARIA active descendant); -1 = none highlighted. */
  protected readonly activeIndex = signal<number>(-1);

  // === Internal state ===
  protected readonly isSaving = signal(false);
  protected readonly roleChecked = signal(true);
  protected readonly emailField = signal('');
  protected readonly firstNameField = signal('');
  protected readonly lastNameField = signal('');
  protected readonly emailTouched = signal(false);
  protected readonly emailFormatError = signal<string | null>(null);
  protected readonly duplicateError = signal<string | null>(null);

  // === Derived signals (computed) ===
  protected readonly checkedCount = computed(() => (this.roleChecked() ? 1 : 0));
  protected readonly checkedFoundationCount = computed(() => (this.roleChecked() ? 1 : 0));

  protected readonly subtitle: Signal<string> = computed(() => this.initSubtitle());
  protected readonly primaryButtonLabel: Signal<string> = computed(() => this.initPrimaryButtonLabel());
  protected readonly currentMember = computed(() => this.seat?.person ?? null);

  /** Suggestions matching the typed query (email or name), excluding the current member, capped at 8. */
  protected readonly filteredEmployees = computed<KeyContactEmployee[]>(() => {
    const query = this.emailField().trim().toLowerCase();
    if (!query) return [];
    const currentEmail = this.currentMember()?.email?.trim().toLowerCase() ?? '';
    return this.employees()
      .filter((e) => e.email.trim().toLowerCase() !== currentEmail)
      .filter((e) => e.email.trim().toLowerCase().includes(query) || e.fullName.toLowerCase().includes(query))
      .slice(0, 8);
  });

  /** id of the keyboard-highlighted option for the combobox `aria-activedescendant` (a11y), or null. */
  protected readonly activeDescendantId = computed<string | null>(() => {
    const idx = this.activeIndex();
    return idx >= 0 && idx < this.filteredEmployees().length ? `reassign-board-employee-option-id-${idx}` : null;
  });

  protected readonly seatLabel: Signal<string> = computed(() => this.initSeatLabel());
  protected readonly tagPillText: Signal<string> = computed(() => this.initTagPillText());
  protected readonly badgeLabel = computed(() => (this.seatKind === 'board' ? 'Board' : 'Committee'));

  /** Save Changes button is enabled when all conditions hold (FR-008d). */
  protected readonly saveEnabled: Signal<boolean> = computed(() => this.initSaveEnabled());

  /** Save timer handle so we can cancel on destroy (FR-008k). */
  private saveTimerId: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.saveTimerId !== null) {
        clearTimeout(this.saveTimerId);
        this.saveTimerId = null;
      }
    });

    // Load the org's people (key contacts + committee members) once; filter client-side as the user types.
    if (this.orgUid) {
      this.boardCommitteeService
        .getOrgEmployees(this.orgUid)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => this.employees.set(res.employees ?? []),
          error: () => this.employeeSearchUnavailable.set(true), // manual entry stays usable
        });
    }
  }

  // === Employee-picker interactions ===
  protected onEmailFocus(): void {
    this.suggestionsOpen.set(true);
  }

  protected onEmailChange(value: string): void {
    this.emailField.set(value);
    this.suggestionsOpen.set(true);
    this.activeIndex.set(-1);
    this.duplicateError.set(null);
    if (this.emailFormatError() && EMAIL_REGEX.test(value.trim())) {
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
    this.activeIndex.set(-1);
  }

  /**
   * Keyboard support for the employee combobox (a11y): Arrow keys move the highlighted option
   * (wrapping), Enter selects it, Escape closes the list. Without this the list is mouse-only —
   * Tab blurs the input and closes the suggestions before a keyboard user can reach an option.
   */
  protected onEmailKeydown(event: KeyboardEvent): void {
    const options = this.filteredEmployees();
    switch (event.key) {
      case 'ArrowDown':
        if (options.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.suggestionsOpen.set(true);
        this.activeIndex.set(this.activeIndex() < options.length - 1 ? this.activeIndex() + 1 : 0);
        break;
      case 'ArrowUp':
        if (options.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.suggestionsOpen.set(true);
        this.activeIndex.set(this.activeIndex() > 0 ? this.activeIndex() - 1 : options.length - 1);
        break;
      case 'Enter': {
        const idx = this.activeIndex();
        // Only intercept Enter when an option is highlighted; otherwise let it bubble to onFormKeydown (Save).
        if (this.suggestionsOpen() && idx >= 0 && idx < options.length) {
          event.preventDefault();
          event.stopPropagation();
          this.onSelectEmployee(options[idx]);
        }
        break;
      }
      case 'Escape':
        // Close the suggestion list first (don't let Escape bubble up and close the whole dialog).
        if (this.suggestionsOpen()) {
          event.preventDefault();
          event.stopPropagation();
          this.suggestionsOpen.set(false);
          this.activeIndex.set(-1);
        }
        break;
      default:
        break;
    }
  }

  // === Event handlers ===
  protected onEmailBlur(): void {
    // Close the suggestion list on blur. Option clicks use (mousedown)="$event.preventDefault()" so
    // selection still fires before blur — this only closes the list when focus genuinely leaves the field.
    this.suggestionsOpen.set(false);
    this.activeIndex.set(-1);
    this.emailTouched.set(true);
    const email = this.emailField().trim();
    if (email && !EMAIL_REGEX.test(email)) {
      this.emailFormatError.set('Enter a valid email address');
    } else {
      this.emailFormatError.set(null);
    }
    this.duplicateError.set(null);
  }

  protected toggleSelectAll(): void {
    this.roleChecked.update((v) => !v);
  }

  protected toggleRoleRow(): void {
    this.roleChecked.update((v) => !v);
  }

  /** Triggered by primary button click OR Enter key inside form inputs. */
  protected onSave(): void {
    if (!this.saveEnabled()) return;

    const enteredEmail = this.emailField().trim().toLowerCase();
    const currentEmail = this.currentMember()?.email?.toLowerCase() ?? '';
    if (enteredEmail === currentEmail) {
      this.duplicateError.set('This person already holds the selected role(s).');
      return;
    }

    this.isSaving.set(true);
    this.saveTimerId = setTimeout(() => {
      this.saveTimerId = null;
      const seat = this.seat;
      if (!seat) {
        this.isSaving.set(false);
        return;
      }
      this.dialogRef.close({
        seatId: seat.seatId,
        seatKind: this.seatKind,
        body: {
          firstName: this.firstNameField().trim(),
          lastName: this.lastNameField().trim(),
          email: this.emailField().trim(),
        },
      } satisfies ReassignBoardRolesDialogResult);
    }, SIMULATED_SAVE_DELAY_MS);
  }

  /** Handle Enter key inside any text input — fire Save Changes when enabled (FR-017b). */
  protected onFormKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.saveEnabled()) {
      event.preventDefault();
      this.onSave();
    }
  }

  protected onCancel(): void {
    if (this.isSaving()) return;
    this.dialogRef.close(null);
  }

  // === Private helpers for computed signals ===
  private initSubtitle(): string {
    const n = this.checkedCount();
    const m = this.checkedFoundationCount();
    const roleWord = n === 1 ? 'role' : 'roles';
    const foundationWord = m === 1 ? 'foundation' : 'foundations';
    return `${n} ${roleWord} across ${m} ${foundationWord}`;
  }

  private initPrimaryButtonLabel(): string {
    if (this.isSaving()) return 'Reassigning…';
    const n = this.checkedCount();
    const roleWord = n === 1 ? 'role' : 'roles';
    return `Save Changes (${n} ${roleWord})`;
  }

  private initSeatLabel(): string {
    const s = this.seat;
    if (!s) return '';
    const fName = this.foundationName;
    if (this.seatKind === 'board') {
      return `${fName} — ${(s as BoardSeat).seatName}`;
    }
    return `${fName} — ${(s as CommitteeSeat).committeeName}`;
  }

  private initTagPillText(): string {
    const s = this.seat;
    if (!s) return '';
    if (this.seatKind === 'board') return (s as BoardSeat).tagLabel;
    return (s as CommitteeSeat).role;
  }

  private initSaveEnabled(): boolean {
    if (this.isSaving()) return false;
    if (this.checkedCount() === 0) return false;
    const email = this.emailField().trim();
    if (!email || !EMAIL_REGEX.test(email)) return false;
    if (this.firstNameField().trim().length === 0) return false;
    if (this.lastNameField().trim().length === 0) return false;
    return true;
  }
}
