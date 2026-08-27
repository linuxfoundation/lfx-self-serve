// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ALLOWED_ORG_LOGO_MIME_TYPES,
  INDUSTRY_OPTIONS,
  MAX_ORG_LOGO_DIMENSION_PX,
  MAX_ORG_LOGO_SIZE_BYTES,
  MIN_ORG_LOGO_DIMENSION_PX,
  ORG_DESCRIPTION_MAX_LENGTH,
  SECTOR_OPTIONS,
} from '@lfx-one/shared/constants';
import type { OrgCanonicalRecord, OrgProfileEditableFields, OrgUpdateRequest } from '@lfx-one/shared/interfaces';
import { httpsUrlValidator } from '@lfx-one/shared/validators';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { finalize } from 'rxjs';

import { InitialsPipe } from '@pipes/initials.pipe';
import { OrgProfileService } from '@services/org-profile.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

/** Spec 021 — Org Profile edit form (US2): reactive form with dirty-check + validation gate (FR-007), partial-update PUT (FR-008), `AccountContextService` propagation (FR-009), differentiated 403/502 toasts (FR-010). */
@Component({
  selector: 'lfx-org-profile-edit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    TextareaModule,
    ToastModule,
    TooltipModule,
    InitialsPipe,
    OpenIntercomDirective,
  ],
  providers: [MessageService],
  templateUrl: './org-profile-edit.component.html',
})
export class OrgProfileEditComponent implements OnInit {
  /** Emitted on successful save — parent applies the new record and exits edit mode. */
  public readonly saved = output<OrgCanonicalRecord>();

  /** Emitted on cancel — parent exits edit mode and discards changes. */
  public readonly cancelled = output<void>();

  /** Emitted after a successful logo upload — parent patches its cached record without exiting edit mode (logo saves immediately, independent of the form's Save/Cancel). */
  public readonly logoUpdated = output<OrgCanonicalRecord>();

  private readonly fb = inject(FormBuilder);
  private readonly orgProfileService = inject(OrgProfileService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  /** Source record loaded on the read-only view; reused here to avoid re-fetching (research R4). */
  public readonly record = input.required<OrgCanonicalRecord>();

  protected form!: FormGroup;

  protected industryOptions: string[] = INDUSTRY_OPTIONS;
  protected sectorOptions: string[] = SECTOR_OPTIONS;
  protected readonly descriptionMaxLength = ORG_DESCRIPTION_MAX_LENGTH;
  /** Drives the file input's `accept` from the same allow-list the validator and BFF parser use. */
  protected readonly allowedLogoAccept = ALLOWED_ORG_LOGO_MIME_TYPES.join(',');

  protected readonly saving = signal(false);

  /** Tracks whether any field differs from the original snapshot. Updated on each form value change. */
  protected readonly dirty = signal(false);
  protected readonly formValid = signal(true);

  // Logo upload (LFXV2-3288). Uploads immediately on selection — mirrors the avatar-upload pattern
  // (profile-edit-drawer.component.ts), independent of this form's own Save/Cancel.
  private readonly logoInput = viewChild<ElementRef<HTMLInputElement>>('logoInput');
  protected readonly logoUploading = signal(false);
  protected readonly logoDragActive = signal(false);
  /** Overrides `record().logoUrl` after a successful upload so the preview updates without waiting on the parent's own record refresh. */
  protected readonly logoUrl = signal<string | null>(null);

  /** Per-field touched-and-invalid flags — keep `form.get(...)` out of the template (CLAUDE.md "No functions in HTML templates"). */
  protected readonly descriptionInvalid = signal(false);
  protected readonly employeesInvalid = signal(false);
  protected readonly crunchbaseInvalid = signal(false);

  /** Disabled until the user changes a field AND all validation passes (FR-007). */
  protected readonly canSave = computed(() => this.dirty() && this.formValid() && !this.busy());

  // True while either mutation (form save or logo upload) is in flight — mirrors
  // profile-edit-drawer.component.ts's `busy` gate for avatar uploads. Both mutation entry points
  // and every dismissal path must gate on this, not on their own signal alone: otherwise a Save
  // during an in-flight logo upload (or a logo upload started during Save) can race the parent
  // destroying this component on Cancel, leaving an upload whose later `logoUpdated` emission has
  // no listener and a persisted logo that can go stale in the cached profile.
  protected readonly busy = computed(() => this.saving() || this.logoUploading());

  private original!: OrgProfileEditableFields;

  public ngOnInit(): void {
    this.logoUrl.set(this.record().logoUrl ?? null);
    this.initForm();
  }

  protected onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }

  protected onSave(): void {
    if (!this.canSave()) return;

    const current = this.form.value as OrgProfileEditableFields;
    const payload = this.buildPartialPayload(current);
    if (Object.keys(payload).length === 0) {
      return;
    }

    this.saving.set(true);
    this.form.disable({ emitEvent: false });

    this.orgProfileService
      .updateOrg(this.record().uid, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.form.enable({ emitEvent: false });
          this.saved.emit(updated);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.form.enable({ emitEvent: false });
          this.dirty.set(this.computeDirty(this.form.value as OrgProfileEditableFields));
          this.formValid.set(this.form.valid);
          this.messageService.add(this.toastForError(error));
        },
      });
  }

  protected onFieldBlur(field: 'description' | 'numberOfEmployees' | 'crunchBaseUrl' | 'website'): void {
    const control = this.form.get(field);
    control?.markAsTouched();
    if (field === 'website' || field === 'crunchBaseUrl') {
      const trimmed = this.normalizeUrlField(String(control?.value ?? ''));
      if (trimmed !== control?.value) {
        control?.setValue(trimmed, { emitEvent: true });
      }
    }
    this.refreshFieldFlags();
  }

  /** Open the OS file picker via the hidden input — keeps the trigger a real, keyboard-operable `<button>`. */
  protected triggerLogoUpload(): void {
    // Re-entrancy guard, not an access gate: a change event queued from a picker opened before
    // Save can otherwise start a second upload mid-flight. Authorization lives upstream — the edit
    // view is only instantiated when OrgProfileComponent.canEdit() passes.
    if (this.busy()) return;
    this.logoInput()?.nativeElement.click();
  }

  protected onLogoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input so re-selecting the same file (e.g. after a rejected upload) still fires change.
    input.value = '';
    if (this.busy()) return;
    if (file) this.handleLogoFile(file);
  }

  protected onLogoDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.busy()) this.logoDragActive.set(true);
  }

  protected onLogoDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.logoDragActive.set(false);
  }

  protected onLogoDrop(event: DragEvent): void {
    event.preventDefault();
    this.logoDragActive.set(false);
    if (this.busy()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleLogoFile(file);
  }

  private initForm(): void {
    this.original = this.snapshotFromRecord(this.record());
    this.industryOptions = this.withCurrentSelectOption(INDUSTRY_OPTIONS, this.original.industry);
    this.sectorOptions = this.withCurrentSelectOption(SECTOR_OPTIONS, this.original.sector);
    this.form = this.fb.group({
      description: [this.original.description, [Validators.maxLength(this.descriptionMaxLength)]],
      website: [this.original.website],
      numberOfEmployees: [this.original.numberOfEmployees, [Validators.min(0)]],
      crunchBaseUrl: [this.original.crunchBaseUrl, [httpsUrlValidator()]],
      industry: [this.original.industry],
      sector: [this.original.sector],
    });

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.dirty.set(this.computeDirty(value as OrgProfileEditableFields));
      this.formValid.set(this.form.valid);
    });

    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshFieldFlags());
  }

  /** FR-010 — differentiated error copy by upstream status. */
  private toastForError(error: unknown): { severity: string; summary: string; detail: string; life: number } {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 403) {
      return {
        severity: 'error',
        summary: 'Permission denied',
        detail: 'You no longer have permission to edit this organization.',
        life: 5000,
      };
    }
    if (status === 502 || status === 504 || status === 0) {
      return {
        severity: 'error',
        summary: 'Save failed',
        detail: 'Unable to save changes. Please try again.',
        life: 5000,
      };
    }
    return {
      severity: 'error',
      summary: 'Save failed',
      detail: 'Something went wrong while saving. Please try again.',
      life: 5000,
    };
  }

  private handleLogoFile(file: File): void {
    if (!(ALLOWED_ORG_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Please choose a PNG, JPEG, or SVG image.' });
      return;
    }
    if (file.size > MAX_ORG_LOGO_SIZE_BYTES) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Logo must be 2MB or smaller.' });
      return;
    }

    // Fire concurrently, not sequentially: the dimension check is advisory-only, so the upload
    // must not wait on it — chaining it in front would turn a "non-blocking" warning into a
    // delay on every upload. A decode failure here is swallowed; it's just a missed warning.
    this.warnIfDimensionsOutOfRange(file).catch(() => undefined);
    this.uploadLogoFile(file);
  }

  /** Non-blocking dimension warnings (LFXV2-3288): under MIN, may look blurry; over MAX, member-service
   * will downscale it server-side (`MaxLogoDimensionPx`, `pkg/constants/logo.go`) — told upfront so the
   * shrink isn't a surprise. SVG is vector (no fixed pixel dimensions), so it's skipped entirely. */
  private async warnIfDimensionsOutOfRange(file: File): Promise<void> {
    if (file.type === 'image/svg+xml') return;

    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();

    if (width < MIN_ORG_LOGO_DIMENSION_PX || height < MIN_ORG_LOGO_DIMENSION_PX) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Small image',
        detail: `This logo is ${width}×${height}px. Images under ${MIN_ORG_LOGO_DIMENSION_PX}px may look blurry.`,
        life: 6000,
      });
      return;
    }
    if (width > MAX_ORG_LOGO_DIMENSION_PX || height > MAX_ORG_LOGO_DIMENSION_PX) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Large image',
        detail: `This logo is ${width}×${height}px and will be resized down to fit within ${MAX_ORG_LOGO_DIMENSION_PX}px.`,
        life: 6000,
      });
    }
  }

  private uploadLogoFile(file: File): void {
    this.logoUploading.set(true);
    // No takeUntilDestroyed — same reviewed exception as the avatar-upload precedent: the upload
    // itself (not just its data) is the user-visible operation, so unsubscribing on component
    // destroy would silently drop it. `uploadLogo()` applies take(1), so no-bare-subscribe is
    // satisfied without the leak risk. Do not reinstate takeUntilDestroyed on this subscribe.
    this.orgProfileService
      .uploadLogo(this.record().uid, file)
      .pipe(finalize(() => this.logoUploading.set(false)))
      .subscribe({
        next: (updated) => {
          this.logoUrl.set(updated.logoUrl ?? null);
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Logo updated!' });
          this.logoUpdated.emit(updated);
        },
        error: (error: unknown) => {
          this.messageService.add(this.toastForLogoError(error));
        },
      });
  }

  /** FR-010-equivalent for the logo upload — mirrors toastForError's status mapping with upload-specific copy. */
  private toastForLogoError(error: unknown): { severity: string; summary: string; detail: string; life: number } {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 403) {
      return { severity: 'error', summary: 'Permission denied', detail: 'You no longer have permission to edit this organization.', life: 5000 };
    }
    return { severity: 'error', summary: 'Upload failed', detail: 'Unable to upload logo. Please try again.', life: 5000 };
  }

  private refreshFieldFlags(): void {
    this.descriptionInvalid.set(this.isFieldInvalid('description'));
    this.employeesInvalid.set(this.isFieldInvalid('numberOfEmployees'));
    this.crunchbaseInvalid.set(this.isFieldInvalid('crunchBaseUrl'));
  }

  private isFieldInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!control && control.invalid && control.touched;
  }

  private snapshotFromRecord(record: OrgCanonicalRecord): OrgProfileEditableFields {
    return {
      description: record.description ?? '',
      website: this.normalizeUrlField(record.website ?? ''),
      numberOfEmployees: record.numberOfEmployees ?? null,
      crunchBaseUrl: this.normalizeUrlField(record.crunchBaseUrl ?? ''),
      industry: record.industry ?? '',
      sector: record.sector ?? '',
    };
  }

  /** Spec edge case — keep unrecognized backend values visible by injecting them into the dropdown list. */
  private withCurrentSelectOption(options: string[], currentValue: string): string[] {
    const value = currentValue.trim();
    if (!value || options.includes(value)) {
      return options;
    }

    const otherIndex = options.indexOf('Other');
    if (otherIndex >= 0) {
      return [...options.slice(0, otherIndex), value, ...options.slice(otherIndex)];
    }

    return [...options, value];
  }

  private computeDirty(current: OrgProfileEditableFields): boolean {
    const normalized = this.normalizeEditableFields(current);
    return (
      normalized.description !== this.original.description ||
      normalized.website !== this.original.website ||
      normalized.numberOfEmployees !== this.original.numberOfEmployees ||
      normalized.crunchBaseUrl !== this.original.crunchBaseUrl ||
      normalized.industry !== this.original.industry ||
      normalized.sector !== this.original.sector
    );
  }

  /** Build partial-update payload by including only changed fields; null/empty values pass through so users can clear upstream values. */
  private buildPartialPayload(current: OrgProfileEditableFields): OrgUpdateRequest {
    const normalized = this.normalizeEditableFields(current);
    const payload: OrgUpdateRequest = {};
    if (normalized.description !== this.original.description) payload.description = normalized.description;
    if (normalized.website !== this.original.website) payload.website = normalized.website;
    if (normalized.numberOfEmployees !== this.original.numberOfEmployees) payload.numberOfEmployees = normalized.numberOfEmployees;
    if (normalized.crunchBaseUrl !== this.original.crunchBaseUrl) payload.crunchBaseUrl = normalized.crunchBaseUrl;
    if (normalized.industry !== this.original.industry) payload.industry = normalized.industry;
    if (normalized.sector !== this.original.sector) payload.sector = normalized.sector;
    return payload;
  }

  private normalizeEditableFields(fields: OrgProfileEditableFields): OrgProfileEditableFields {
    return {
      ...fields,
      website: this.normalizeUrlField(fields.website),
      crunchBaseUrl: this.normalizeUrlField(fields.crunchBaseUrl),
    };
  }

  private normalizeUrlField(value: string): string {
    return value.trim();
  }
}
