// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FORMATION_RECORD_CONFIRM_STAGES,
  FORMATION_RECORD_EDITABLE_KEYS,
  FORMATION_RECORD_ERROR_MESSAGES,
  FORMATION_RECORD_SELECTABLE_STAGES,
  FORMATION_RECORD_SUCCESS_MESSAGE,
  FORMATION_TEAM_REQUIRED_CODE,
  PROJECT_FORMATION_STAGE_LABELS,
  PROJECT_LEGAL_ENTITY_TYPES,
} from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';
import type { FormationRecordEditDrawerData, Project, UpdateFormationRecordRequest } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

/** The editable fields as normalized (trimmed, never null) strings — the shape both the baseline and the current form are compared in. */
type RecordValues = Record<(typeof FORMATION_RECORD_EDITABLE_KEYS)[number], string>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Edit panel for a project's stage and legal entity (#5134), opened from the Formation sidebar card
 * through `UiDrawerService` (`docs/architecture/frontend/drawer-pattern.md`: new drawers use the uikit
 * drawer so focus entry/return, the dialog name and Escape are handled). The record is read once when
 * the drawer opens; only the fields the user actually changed are sent (the BFF merges them onto the
 * stored record). Moving to Active, Archived or Formation - Disengaged asks for a confirmation first —
 * warn, never block — since those complete or freeze the checklist. Closes with `true` after a save.
 */
@Component({
  selector: 'lfx-formation-record-edit-drawer',
  imports: [UiDrawerComponent, UiButtonComponent, UiInputComponent, UiSelectComponent, UiOptionComponent],
  templateUrl: './formation-record-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormationRecordEditDrawerComponent {
  private readonly data = inject<FormationRecordEditDrawerData>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly stage = signal<string | null>(null);
  protected readonly legalEntityType = signal<string | null>(null);
  protected readonly legalEntityName = signal('');
  protected readonly formationDate = signal('');
  protected readonly dissolutionDate = signal('');
  protected readonly documentUrl = signal('');

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  /** The stage the confirmation was shown for; it only counts while that stage is still the pick. */
  private readonly confirmingStage = signal<string | null>(null);
  protected readonly confirming = computed(() => this.confirmingStage() !== null && this.confirmingStage() === this.stage());
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly conflict = signal(false);
  protected readonly dissolutionDateError = signal<string | null>(null);

  protected readonly legalEntityTypeOptions = PROJECT_LEGAL_ENTITY_TYPES;

  private readonly baseline = signal<RecordValues | null>(null);

  protected readonly stageOptions = computed(() => {
    const current = this.baseline()?.stage ?? '';
    const options = FORMATION_RECORD_SELECTABLE_STAGES.map((value) => ({ value: value as string, disabled: false }));
    // A stored stage outside the selectable set (Prospect, a legacy Confidential) stays visible so the form never
    // misreports the record, but cannot be re-picked once changed away from.
    return current && !options.some((option) => option.value === current) ? [{ value: current, disabled: true }, ...options] : options;
  });
  protected readonly showDissolutionDate = computed(() => this.stage() === ProjectStage.Archived);
  protected readonly confirmationMessage = computed(() => this.buildConfirmationMessage(this.stage() ?? '', this.data.openRequiredCount));

  public constructor() {
    this.loadRecord();
  }

  protected onReload(): void {
    this.errorMessage.set(null);
    this.conflict.set(false);
    this.loadRecord();
  }

  protected onCancel(): void {
    this.dialogRef.close(false);
  }

  protected onBack(): void {
    this.confirmingStage.set(null);
  }

  protected onSave(): void {
    if (this.saving() || this.loading()) return;
    this.errorMessage.set(null);
    this.dissolutionDateError.set(null);

    const changes = this.collectChanges();
    if (Object.keys(changes).length === 0) {
      this.messageService.add({ severity: 'info', summary: 'Nothing to save', detail: 'No changes were made.' });
      return;
    }

    // Validated on the effective values the user sees — a stored date satisfies Archived without being resent.
    if (this.normalize(this.stage()) === ProjectStage.Archived && !this.normalize(this.dissolutionDate())) {
      this.dissolutionDateError.set(FORMATION_RECORD_ERROR_MESSAGES.archivedNeedsDissolutionDate);
      return;
    }
    const invalidDate = (['formation_date', 'entity_dissolution_date'] as const).some((key) => !!changes[key] && !ISO_DATE.test(changes[key] as string));
    if (invalidDate) {
      this.errorMessage.set(FORMATION_RECORD_ERROR_MESSAGES.invalidValue);
      return;
    }

    if (changes.stage && FORMATION_RECORD_CONFIRM_STAGES.includes(changes.stage as ProjectStage) && !this.confirming()) {
      this.confirmingStage.set(changes.stage);
      return;
    }

    this.submit(changes);
  }

  private submit(changes: UpdateFormationRecordRequest): void {
    this.saving.set(true);
    this.data.saveState.inFlight = true;
    this.projectService
      .updateFormationRecord(this.data.projectUid, changes)
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.data.saveState.inFlight = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: FORMATION_RECORD_SUCCESS_MESSAGE });
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => {
          this.confirmingStage.set(null);
          this.conflict.set(error.status === 409);
          this.errorMessage.set(this.messageForError(error));
        },
      });
  }

  /** Reads the stored record once for this open; a failed read shows a retry instead of a stale form. */
  private loadRecord(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.confirmingStage.set(null);
    this.projectService
      .getProjectRecord(this.data.projectUid)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (project) => this.applyRecord(project),
        error: () => this.loadFailed.set(true),
      });
  }

  /** Only fields whose normalized value differs from the normalized stored value; `''` means clear. */
  private collectChanges(): UpdateFormationRecordRequest {
    const baseline = this.baseline();
    const current = this.currentValues();
    const changes: Record<string, string> = {};
    for (const key of FORMATION_RECORD_EDITABLE_KEYS) {
      if (current[key] !== (baseline?.[key] ?? '')) {
        changes[key] = current[key];
      }
    }
    return changes as UpdateFormationRecordRequest;
  }

  private currentValues(): RecordValues {
    return {
      stage: this.normalize(this.stage()),
      legal_entity_type: this.normalize(this.legalEntityType()),
      legal_entity_name: this.normalize(this.legalEntityName()),
      formation_date: this.normalize(this.formationDate()),
      entity_dissolution_date: this.normalize(this.dissolutionDate()),
      entity_formation_document_url: this.normalize(this.documentUrl()),
    };
  }

  private applyRecord(project: Project): void {
    const stored: RecordValues = {
      stage: this.normalize(project.stage),
      legal_entity_type: this.normalize(project.legal_entity_type),
      legal_entity_name: this.normalize(project.legal_entity_name),
      formation_date: this.normalize(project.formation_date),
      entity_dissolution_date: this.normalize(project.entity_dissolution_date),
      entity_formation_document_url: this.normalize(project.entity_formation_document_url),
    };
    this.baseline.set(stored);
    this.stage.set(stored.stage);
    // '' selects the "Not set" option, which is how the type is cleared (None is a real stored value).
    this.legalEntityType.set(stored.legal_entity_type);
    this.legalEntityName.set(stored.legal_entity_name);
    this.formationDate.set(stored.formation_date);
    this.dissolutionDate.set(stored.entity_dissolution_date);
    this.documentUrl.set(stored.entity_formation_document_url);
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim();
  }

  private messageForError(error: HttpErrorResponse): string {
    const code = (error.error as { code?: string } | null)?.code;
    if (error.status === 403) {
      return code === FORMATION_TEAM_REQUIRED_CODE ? FORMATION_RECORD_ERROR_MESSAGES.notFormationTeam : FORMATION_RECORD_ERROR_MESSAGES.notWriter;
    }
    if (error.status === 400) {
      // The BFF reports the Archived rule as a field error on the merged record (e.g. another writer cleared the stored date).
      const errors = (error.error as { errors?: { field?: string }[] } | null)?.errors;
      return errors?.some((entry) => entry.field === 'entity_dissolution_date')
        ? FORMATION_RECORD_ERROR_MESSAGES.archivedNeedsDissolutionDate
        : FORMATION_RECORD_ERROR_MESSAGES.invalidValue;
    }
    if (error.status === 404) return FORMATION_RECORD_ERROR_MESSAGES.notFound;
    if (error.status === 409) return FORMATION_RECORD_ERROR_MESSAGES.conflict;
    return FORMATION_RECORD_ERROR_MESSAGES.generic;
  }

  private buildConfirmationMessage(stage: string, openRequired: number): string {
    const label = PROJECT_FORMATION_STAGE_LABELS[stage as ProjectStage] ?? stage;
    const effect =
      stage === ProjectStage.Active
        ? 'Moving this project to Active completes its formation checklist.'
        : `Moving this project to ${label} freezes its formation checklist, which becomes read-only.`;
    const open = openRequired === 1 ? '1 required item is still open.' : `${openRequired} required items are still open.`;
    return openRequired > 0 ? `${effect} ${open} You can still continue.` : effect;
  }
}
