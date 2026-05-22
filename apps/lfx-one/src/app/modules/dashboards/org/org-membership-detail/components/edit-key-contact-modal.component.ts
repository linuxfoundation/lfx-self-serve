// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectorRef, Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMAIL_REGEX, SIMULATED_SAVE_DELAY_MS } from '@lfx-one/shared/constants';
import type {
  EditKeyContactDialogData,
  EditKeyContactDialogResult,
  ModalKind,
  OrgMembershipKeyContact,
  OrgMembershipKeyContactPerson,
} from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-edit-key-contact-modal',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, InputTextModule, TooltipModule],
  templateUrl: './edit-key-contact-modal.component.html',
})
export class EditKeyContactModalComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<EditKeyContactDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  /** Save timer handle so we can cancel on destroy. */
  private saveTimerId: ReturnType<typeof setTimeout> | null = null;

  // === Dialog-injected data ===
  protected readonly contact: OrgMembershipKeyContact | null = this.dialogConfig.data?.contact ?? null;
  protected readonly foundationName: string = this.dialogConfig.data?.foundationName ?? '';
  protected readonly editingPersonId: string | null = this.dialogConfig.data?.editingPersonId ?? null;

  // === Internal state ===
  protected readonly modalKind = signal<ModalKind>('closed');
  protected readonly isSaving = signal(false);

  // Form fields
  protected readonly emailField = signal('');
  protected readonly firstNameField = signal('');
  protected readonly lastNameField = signal('');
  protected readonly emailTouched = signal(false);
  protected readonly emailFormatError = signal<string | null>(null);
  protected readonly duplicateError = signal<string | null>(null);

  // Remove-flow state
  protected readonly selectedRemoveId = signal<string | null>(null);

  protected readonly contactTypeLabel = computed(() => this.contact?.contactTypeLabel ?? '');
  protected readonly minContacts = computed(() => this.contact?.minContacts ?? 0);
  protected readonly maxContacts = computed(() => this.contact?.maxContacts ?? 0);
  protected readonly people = computed(() => this.contact?.people ?? []);
  protected readonly currentPerson: Signal<OrgMembershipKeyContactPerson | null> = computed(() => this.initCurrentPerson());

  protected readonly canAdd = computed(() => this.people().length < this.maxContacts());
  protected readonly canRemove = computed(() => this.people().length > 0 && this.people().length > this.minContacts());

  protected readonly addCardTooltip = computed(() => (!this.canAdd() ? 'Maximum contacts reached' : ''));
  protected readonly removeCardTooltip: Signal<string> = computed(() => this.initRemoveCardTooltip());

  protected readonly addCardLabel = computed(() => (this.people().length === 0 ? `Add ${this.contactTypeLabel()}` : 'Add Another Contact'));

  protected readonly infoBannerText: Signal<string> = computed(() => this.initInfoBannerText());
  protected readonly primaryButtonLabel: Signal<string> = computed(() => this.initPrimaryButtonLabel());
  protected readonly primaryButtonStyleClass: Signal<string> = computed(() => this.initPrimaryButtonStyleClass());
  protected readonly canSubmit: Signal<boolean> = computed(() => this.initCanSubmit());

  public constructor() {
    if (this.contact) {
      this.modalKind.set(this.decideInitialKind(this.contact));
      setTimeout(() => this.focusInitialElement(), 0);
    }

    this.destroyRef.onDestroy(() => {
      if (this.saveTimerId !== null) {
        clearTimeout(this.saveTimerId);
        this.saveTimerId = null;
      }
    });
  }

  protected resetFormState(): void {
    this.emailField.set('');
    this.firstNameField.set('');
    this.lastNameField.set('');
    this.emailTouched.set(false);
    this.emailFormatError.set(null);
    this.duplicateError.set(null);
    this.selectedRemoveId.set(null);
    this.isSaving.set(false);
  }

  // === Chooser interactions (FR-016a / FR-016e live toggle) ===
  protected selectAddCard(): void {
    if (!this.canAdd() || this.isSaving()) return;
    this.selectedRemoveId.set(null);
    this.modalKind.set('add-form');
    setTimeout(() => this.focusInitialElement(), 0);
  }

  protected selectRemoveCard(): void {
    if (!this.canRemove() || this.isSaving()) return;
    this.resetFormState();
    this.modalKind.set('remove-list');
    setTimeout(() => this.focusInitialElement(), 0);
  }

  protected selectRemoveCandidate(personId: string): void {
    if (this.isSaving()) return;
    this.selectedRemoveId.set(personId);
  }

  // === Field validation (FR-017a — on blur) ===
  protected onEmailBlur(): void {
    this.emailTouched.set(true);
    this.duplicateError.set(null);
    const value = this.emailField().trim();
    if (value && !EMAIL_REGEX.test(value)) {
      this.emailFormatError.set('Enter a valid email address');
    } else {
      this.emailFormatError.set(null);
    }
  }

  protected onEmailChange(value: string): void {
    this.emailField.set(value);
    if (this.duplicateError()) {
      this.duplicateError.set(null);
    }
    if (this.emailFormatError() && EMAIL_REGEX.test(value.trim())) {
      this.emailFormatError.set(null);
    }
  }

  // === Submit handlers ===
  protected onSaveClick(): void {
    if (!this.canSubmit()) return;
    const enteredEmail = this.emailField().trim().toLowerCase();
    const editingId = this.modalKind() === 'replace-form' ? this.editingPersonId : null;
    const duplicate = this.people().some((p) => p.personId !== editingId && p.email.trim().toLowerCase() === enteredEmail);
    if (duplicate) {
      this.duplicateError.set(`This person is already a ${this.contactTypeLabel()}.`);
      return;
    }

    const kind = this.modalKind();
    const newPerson: OrgMembershipKeyContactPerson = {
      personId: `temp-${this.generateUuid()}`,
      firstName: this.firstNameField().trim(),
      lastName: this.lastNameField().trim(),
      fullName: `${this.firstNameField().trim()} ${this.lastNameField().trim()}`,
      email: this.emailField().trim(),
      jobTitle: null,
      initials: this.deriveInitials(this.firstNameField().trim(), this.lastNameField().trim()),
    };

    this.simulateSave(() => {
      const contact = this.contact;
      if (!contact) return;
      if (kind === 'replace-form') {
        this.dialogRef.close({
          kind: 'replace',
          event: {
            contactType: contact.contactType,
            contactTypeLabel: contact.contactTypeLabel,
            editingPersonId: this.editingPersonId,
            person: newPerson,
          },
        } satisfies EditKeyContactDialogResult);
      } else {
        this.dialogRef.close({
          kind: 'add',
          event: {
            contactType: contact.contactType,
            contactTypeLabel: contact.contactTypeLabel,
            editingPersonId: null,
            person: newPerson,
          },
        } satisfies EditKeyContactDialogResult);
      }
    });
  }

  protected onRemoveClick(): void {
    if (!this.canSubmit()) return;
    const contact = this.contact;
    const personId = this.selectedRemoveId();
    if (!contact || !personId) return;

    this.simulateSave(() => {
      this.dialogRef.close({
        kind: 'remove',
        event: {
          contactType: contact.contactType,
          contactTypeLabel: contact.contactTypeLabel,
          personId,
        },
      } satisfies EditKeyContactDialogResult);
    });
  }

  protected onCancelClick(): void {
    if (this.isSaving()) return;
    this.dialogRef.close(null);
  }

  // === Keyboard activation handlers (FR-035) ===
  protected onChooserKeydown(event: KeyboardEvent, kind: 'add' | 'remove'): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (kind === 'add') this.selectAddCard();
    else this.selectRemoveCard();
  }

  protected onRemoveCandidateKeydown(event: KeyboardEvent, personId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.selectRemoveCandidate(personId);
  }

  protected onFormEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.onSaveClick();
  }

  // === Private helpers ===

  private simulateSave(then: () => void): void {
    this.isSaving.set(true);
    this.saveTimerId = setTimeout(() => {
      this.saveTimerId = null;
      try {
        then();
      } finally {
        this.isSaving.set(false);
      }
    }, SIMULATED_SAVE_DELAY_MS);
  }

  private focusInitialElement(): void {
    if (typeof document === 'undefined') return;
    const kind = this.modalKind();
    let selector = '';
    if (kind === 'replace-form' || kind === 'add-form' || kind === 'single-add-form') {
      selector = '[data-testid="edit-key-contact-email-input"]';
    } else if (kind === 'chooser') {
      selector = '[data-testid="edit-key-contact-chooser-add"]:not([disabled])';
    } else if (kind === 'remove-list') {
      selector = '[data-testid^="edit-key-contact-remove-candidate-"]';
    }
    if (!selector) return;
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el && typeof el.focus === 'function') {
      el.focus();
    }
    this.cdr.markForCheck();
  }

  private decideInitialKind(contact: OrgMembershipKeyContact): ModalKind {
    if (contact.maxContacts === 1) {
      if (contact.people.length === 0) return 'single-add-form';
      return 'replace-form';
    }
    return 'chooser';
  }

  private deriveInitials(firstName: string, lastName: string): string {
    const first = firstName.charAt(0).toUpperCase();
    const last = lastName.charAt(0).toUpperCase();
    return `${first}${last}`;
  }

  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // === Extracted computed helpers ===

  private initCurrentPerson(): OrgMembershipKeyContactPerson | null {
    const editingId = this.editingPersonId;
    if (!editingId) return null;
    return this.people().find((p) => p.personId === editingId) ?? null;
  }

  private initRemoveCardTooltip(): string {
    if (this.people().length === 0) return 'No contacts to remove';
    if (!this.canRemove()) return 'At least one contact required';
    return '';
  }

  private initInfoBannerText(): string {
    const min = this.minContacts();
    const max = this.maxContacts();
    if (min === 1 && max === 1) {
      return 'Your organization must have one key contact of this type.';
    }
    if (min >= 1 && max > 1) {
      return `Your organization must have at least ${min}, and can have up to ${max} contacts of this type.`;
    }
    if (min === 0 && max > 1) {
      return `Your organization can have up to ${max} contacts of this type.`;
    }
    return '';
  }

  private initPrimaryButtonLabel(): string {
    const kind = this.modalKind();
    const saving = this.isSaving();
    if (kind === 'remove-list') return saving ? 'Removing…' : 'Remove Contact';
    return saving ? 'Saving…' : 'Save Changes';
  }

  private initPrimaryButtonStyleClass(): string {
    const kind = this.modalKind();
    return kind === 'remove-list' ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600';
  }

  private initCanSubmit(): boolean {
    if (this.isSaving()) return false;
    const kind = this.modalKind();
    if (kind === 'remove-list') return this.selectedRemoveId() !== null;
    if (kind === 'replace-form' || kind === 'add-form' || kind === 'single-add-form') {
      return (
        this.emailField().trim().length > 0 &&
        this.firstNameField().trim().length > 0 &&
        this.lastNameField().trim().length > 0 &&
        !this.emailFormatError() &&
        !this.duplicateError() &&
        EMAIL_REGEX.test(this.emailField().trim())
      );
    }
    return false;
  }
}
