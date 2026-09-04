// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { environment } from '@environments/environment';
import { ID_MIGRATION_EVENTS, ID_MIGRATION_FUNNEL, ID_MIGRATION_REASONS, ID_MIGRATION_SOURCE_APP } from '@lfx-one/shared/constants';
import { IdMigrationReason } from '@lfx-one/shared/interfaces';
import { DataDogRumService } from '@services/datadog-rum.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Reason-capture modal for the "Still need Individual Dashboard?" return link (LFXV2-3336).
 * Opened via DialogService.open() with `showHeader: false` (the body renders its own headline).
 *
 * - "Continue" opens Individual Dashboard in a new tab and, only once that tab actually opened,
 *   emits the CONTINUE RUM action (reason + optional comment, attributed to the authenticated
 *   user via the RUM user context).
 * - "Stay here" closes the dialog with no analytics and no navigation — per the ticket, we must
 *   not conflate "opened the modal" with "actually left".
 *
 * The initial link-click event (LINK_CLICK) is emitted by the opener (sidebar), not here.
 */
@Component({
  selector: 'lfx-id-migration-modal',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent, TextareaComponent],
  templateUrl: './id-migration-modal.component.html',
})
export class IdMigrationModalComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly rumService = inject(DataDogRumService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);

  // Spread into a mutable array — lfx-select's `options` input is typed `any[]`, and the source
  // constant is a `readonly` tuple (`as const`, so the reason literals stay usable as a union type).
  protected readonly reasons = [...ID_MIGRATION_REASONS];
  protected readonly individualDashboardUrl = environment.urls.individualDashboard;
  // Required, but not pre-selected: defaulting to an option would inflate whichever sits first
  // and make "chose it" indistinguishable from "never touched the field". Continue stays disabled
  // until a reason is picked, so every CONTINUE event carries one. Typed against IdMigrationReason
  // so a value outside the shared reason set cannot be written into the control.
  protected readonly form = this.formBuilder.group({
    reason: this.formBuilder.control<IdMigrationReason | null>(null, Validators.required),
    comment: this.formBuilder.nonNullable.control(''),
  });

  // Set when window.open is refused (popup blocker). Reveals a manual link so Continue does not
  // look inert, and keeps the dialog open — CONTINUE stays unsent until a tab actually opened.
  protected readonly popupBlocked = signal(false);

  public continueToIndividualDashboard(): void {
    const { reason, comment } = this.form.getRawValue();
    const trimmedComment = comment.trim();

    // Navigate first, then log. A blocked popup would otherwise be recorded as a completed
    // migration, so the funnel would count a user who never left.
    const opened = isPlatformBrowser(this.platformId) ? window.open(this.individualDashboardUrl, '_blank', 'noopener,noreferrer') : null;

    if (!opened) {
      this.popupBlocked.set(true);
      return;
    }

    this.rumService.addAction(ID_MIGRATION_EVENTS.CONTINUE, {
      funnel: ID_MIGRATION_FUNNEL,
      source_app: ID_MIGRATION_SOURCE_APP,
      reason,
      // Omit empty comments so the funnel query can distinguish "left a note" from "didn't".
      comment: trimmedComment || undefined,
    });

    this.dialogRef.close(true);
  }

  public stayHere(): void {
    this.dialogRef.close(false);
  }
}
