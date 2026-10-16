// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import { CROWDFUNDING_ATTRIBUTION_TYPE_OPTIONS } from '@lfx-one/shared/constants';
import {
  AttributionEntity,
  AttributionOptions,
  CrowdfundingAttributionType,
  EditAttributionDialogData,
  InitiativeAttribution,
  UpdateInitiativeAttributionInput,
} from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, firstValueFrom, of } from 'rxjs';

/** Changes who an initiative is attributed to (lfx-crowdfunding#342). Separate from the settings drawer's Save. */
@Component({
  selector: 'lfx-edit-attribution-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, RadioButtonComponent, SelectComponent],
  templateUrl: './edit-attribution-dialog.component.html',
  styleUrl: './edit-attribution-dialog.component.scss',
})
export class EditAttributionDialogComponent {
  private readonly config = inject(DynamicDialogConfig<EditAttributionDialogData>);
  private readonly ref = inject(DynamicDialogRef);
  private readonly crowdfundingService = inject(CrowdfundingService);

  private readonly current: InitiativeAttribution = this.config.data?.initiative.attribution ?? { type: 'personal' };
  protected readonly typeOptions = CROWDFUNDING_ATTRIBUTION_TYPE_OPTIONS;

  protected readonly form = new FormGroup({
    type: new FormControl<CrowdfundingAttributionType>(this.current.type, { nonNullable: true }),
    entityUid: new FormControl<string | null>(this.current.entityUid ?? null),
  });

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  /** `undefined` while loading, `null` when the lookup failed. */
  protected readonly options: Signal<AttributionOptions | null | undefined> = this.initOptions();
  protected readonly selectedType: Signal<CrowdfundingAttributionType> = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });
  private readonly selectedEntityUid: Signal<string | null> = toSignal(this.form.controls.entityUid.valueChanges, {
    initialValue: this.form.controls.entityUid.value,
  });
  protected readonly entities: Signal<AttributionEntity[]> = this.initEntities();
  protected readonly canSave: Signal<boolean> = this.initCanSave();

  protected onTypeChange(): void {
    this.form.controls.entityUid.setValue(null);
    this.saveError.set(null);
  }

  protected onCancel(): void {
    this.ref.close();
  }

  protected async onSave(): Promise<void> {
    const id = this.config.data?.initiative.id;
    if (!id || !this.canSave()) return;

    const type = this.selectedType();
    const input: UpdateInitiativeAttributionInput = type === 'personal' ? { type } : { type, entityUid: this.selectedEntityUid() ?? undefined };

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const updated = await firstValueFrom(this.crowdfundingService.updateInitiativeAttribution(id, input));
      this.ref.close(updated);
    } catch (err) {
      this.saveError.set(this.toSaveErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private initOptions(): Signal<AttributionOptions | null | undefined> {
    return toSignal(this.crowdfundingService.getAttributionOptions().pipe(catchError(() => of(null))), { initialValue: undefined });
  }

  private initEntities(): Signal<AttributionEntity[]> {
    return computed(() => {
      const options = this.options();
      if (!options) return [];
      const type = this.selectedType();
      if (type === 'organization') return options.organizations;
      if (type === 'project') return options.projects;
      return [];
    });
  }

  private initCanSave(): Signal<boolean> {
    return computed(() => {
      if (this.saving()) return false;
      const type = this.selectedType();
      const entityUid = this.selectedEntityUid();
      if (type !== 'personal' && !entityUid) return false;
      // Re-sending the current attribution is a no-op; offer Save only for a change.
      return type !== this.current.type || (type !== 'personal' && entityUid !== this.current.entityUid);
    });
  }

  // CF answers 403 for a non-creator or an unaffiliated target, and 400 once the initiative has left `submitted`.
  private toSaveErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 403) {
      return 'You can only attribute this initiative to an organization or project you are affiliated with.';
    }
    if (err instanceof HttpErrorResponse && err.status === 400) {
      return 'The attribution can only be changed while the initiative is submitted for review.';
    }
    return 'Failed to update the attribution. Please try again.';
  }
}
