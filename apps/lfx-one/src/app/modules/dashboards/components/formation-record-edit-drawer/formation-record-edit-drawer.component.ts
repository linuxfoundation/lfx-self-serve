// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import {
  FORMATION_RECORD_CONFIRM_STAGES,
  FORMATION_RECORD_ERROR_MESSAGES,
  FORMATION_RECORD_SELECTABLE_STAGES,
  FORMATION_TEAM_REQUIRED_CODE,
  PROJECT_FORMATION_STAGE_LABELS,
  PROJECT_LEGAL_ENTITY_TYPES,
} from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';
import type { Project, UpdateFormationRecordRequest } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, EMPTY, filter, finalize, skip, switchMap, tap } from 'rxjs';

/** Editable fields in the order the form renders them; the key doubles as the request key. */
type RecordFormValue = Required<UpdateFormationRecordRequest>;

/**
 * Edit panel for a project's stage and legal entity (#5134), opened from the Formation sidebar
 * card on both checklist hosts. Loads the stored record fresh on open, sends only the fields the
 * user changed (the BFF merges them onto the raw upstream record), and asks for a confirmation —
 * warn, never block — before moving to Active, Archived or Formation - Disengaged, since those
 * complete or freeze the checklist. Opens as a right-hand `p-drawer` like the formation item
 * drawer; staff-edit-dialog is a DynamicDialog and does not share a wrapper with it.
 */
@Component({
  selector: 'lfx-formation-record-edit-drawer',
  imports: [ReactiveFormsModule, DrawerModule, SkeletonModule, ButtonComponent, InputTextComponent, MessageComponent, SelectComponent],
  templateUrl: './formation-record-edit-drawer.component.html',
})
export class FormationRecordEditDrawerComponent {
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly visible = model<boolean>(false);
  public readonly projectUid = input.required<string>();
  /** Gating ("required for Active") items still open on the checklist — shown in the confirmation. */
  public readonly openRequiredCount = input<number>(0);
  public readonly saved = output<void>();

  protected readonly form = new FormGroup({
    stage: new FormControl<string>('', { nonNullable: true }),
    legal_entity_type: new FormControl<string>('', { nonNullable: true }),
    legal_entity_name: new FormControl<string>('', { nonNullable: true }),
    formation_date: new FormControl<string>('', { nonNullable: true }),
    entity_dissolution_date: new FormControl<string>('', { nonNullable: true }),
    entity_formation_document_url: new FormControl<string>('', { nonNullable: true }),
  });

  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  protected readonly confirming = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly conflict = signal(false);
  protected readonly dissolutionDateError = signal<string | null>(null);

  private readonly initial = signal<RecordFormValue | null>(null);
  private readonly stageValue = signal<string>('');

  protected readonly stageOptions = computed(() => {
    const current = this.initial()?.stage ?? '';
    const options = FORMATION_RECORD_SELECTABLE_STAGES.map((stage) => ({ label: stage, value: stage as string, disabled: false }));
    // A stored stage outside the selectable set (Prospect, a legacy Confidential) stays visible so the form never
    // misreports the record, but cannot be re-picked once changed away from.
    return current && !options.some((option) => option.value === current) ? [{ label: current, value: current, disabled: true }, ...options] : options;
  });
  protected readonly legalEntityTypeOptions = PROJECT_LEGAL_ENTITY_TYPES.map((type) => ({ label: type, value: type }));
  protected readonly showDissolutionDate = computed(() => this.stageValue() === ProjectStage.Archived);
  protected readonly confirmationMessage = computed(() => this.buildConfirmationMessage(this.stageValue(), this.openRequiredCount()));

  public constructor() {
    this.form.controls.stage.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.stageValue.set(value);
      // A pending confirmation describes the previously picked stage — drop it when the pick changes.
      this.confirming.set(false);
    });

    toObservable(this.visible)
      .pipe(
        skip(1),
        filter((visible) => visible),
        tap(() => this.resetForOpen()),
        // The failure is handled inside the inner stream so one failed open never ends the subscription — reopening must refetch.
        switchMap(() =>
          this.projectService.getProjectRecord(this.projectUid()).pipe(
            catchError(() => {
              this.loadFailed.set(true);
              return EMPTY;
            }),
            finalize(() => this.loading.set(false))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((project) => this.applyRecord(project));
  }

  protected onReload(): void {
    this.resetForOpen();
    this.projectService
      .getProjectRecord(this.projectUid())
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({ next: (project) => this.applyRecord(project), error: () => this.loadFailed.set(true) });
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  protected onBack(): void {
    this.confirming.set(false);
  }

  protected onSave(): void {
    if (this.saving()) return;
    this.errorMessage.set(null);
    this.dissolutionDateError.set(null);

    const changes = this.collectChanges();
    if (Object.keys(changes).length === 0) {
      this.messageService.add({ severity: 'info', summary: 'Nothing to save', detail: 'No changes were made.' });
      return;
    }

    // Keyed on the effective stage, not just a stage change: clearing the date of an already-Archived project must be caught too.
    const effectiveDissolutionDate = (changes.entity_dissolution_date ?? this.form.controls.entity_dissolution_date.value).trim();
    if (this.form.controls.stage.value === ProjectStage.Archived && !effectiveDissolutionDate) {
      this.dissolutionDateError.set(FORMATION_RECORD_ERROR_MESSAGES.archivedNeedsDissolutionDate);
      return;
    }

    if (changes.stage && FORMATION_RECORD_CONFIRM_STAGES.includes(changes.stage as ProjectStage) && !this.confirming()) {
      this.confirming.set(true);
      return;
    }

    this.submit(changes);
  }

  private submit(changes: UpdateFormationRecordRequest): void {
    // Archived always carries its dissolution date, even when the stored one is unchanged, so the BFF rule is satisfied.
    const body = changes.stage === ProjectStage.Archived ? { ...changes, entity_dissolution_date: this.form.controls.entity_dissolution_date.value } : changes;

    this.saving.set(true);
    this.projectService
      .updateFormationRecord(this.projectUid(), body)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.confirming.set(false);
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Formation record updated.' });
          this.visible.set(false);
          this.saved.emit();
        },
        error: (error: HttpErrorResponse) => {
          this.confirming.set(false);
          this.conflict.set(error.status === 409);
          this.errorMessage.set(this.messageForError(error));
        },
      });
  }

  private collectChanges(): UpdateFormationRecordRequest {
    const initial = this.initial();
    const current = this.form.getRawValue();
    const changes: Record<string, string> = {};
    for (const key of Object.keys(current) as (keyof RecordFormValue)[]) {
      const value = (current[key] ?? '').trim();
      if (value !== (initial?.[key] ?? '')) {
        changes[key] = value;
      }
    }
    // The dissolution date only exists on the form while Archived is selected.
    if (current.stage !== ProjectStage.Archived && !(initial?.stage === ProjectStage.Archived)) {
      delete changes['entity_dissolution_date'];
    }
    return changes as UpdateFormationRecordRequest;
  }

  private resetForOpen(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.confirming.set(false);
    this.conflict.set(false);
    this.errorMessage.set(null);
    this.dissolutionDateError.set(null);
  }

  private applyRecord(project: Project): void {
    const value: RecordFormValue = {
      stage: project.stage ?? '',
      legal_entity_type: project.legal_entity_type ?? '',
      legal_entity_name: project.legal_entity_name ?? '',
      formation_date: project.formation_date ?? '',
      entity_dissolution_date: project.entity_dissolution_date ?? '',
      entity_formation_document_url: project.entity_formation_document_url ?? '',
    };
    this.initial.set(value);
    this.form.reset(value);
    this.stageValue.set(value.stage);
  }

  private messageForError(error: HttpErrorResponse): string {
    const code = (error.error as { code?: string } | null)?.code;
    if (error.status === 403) {
      return code === FORMATION_TEAM_REQUIRED_CODE ? FORMATION_RECORD_ERROR_MESSAGES.notFormationTeam : FORMATION_RECORD_ERROR_MESSAGES.notWriter;
    }
    if (error.status === 400) return FORMATION_RECORD_ERROR_MESSAGES.invalidValue;
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
