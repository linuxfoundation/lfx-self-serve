// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { environment } from '@environments/environment';
import { ID_MIGRATION_EVENTS, ID_MIGRATION_FUNNEL, ID_MIGRATION_REASONS, ID_MIGRATION_SOURCE_APP } from '@lfx-one/shared/constants';
import { DataDogRumService } from '@services/datadog-rum.service';
import { UserService } from '@services/user.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Reason-capture modal for the "Still need Individual Dashboard?" return link (LFXV2-3336).
 * Opened via DialogService.open() with `showHeader: false` (the body renders its own headline).
 *
 * - "Continue" emits the CONTINUE RUM action (reason + optional comment, attributed to the
 *   authenticated user via the RUM user context), then opens Individual Dashboard in a new tab.
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
  private readonly userService = inject(UserService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);

  // Spread into a mutable array — lfx-select's `options` input is typed `any[]`, and the source
  // constant is a `readonly` tuple (`as const`, so the reason literals stay usable as a union type).
  protected readonly reasons = [...ID_MIGRATION_REASONS];
  protected readonly form: FormGroup = this.formBuilder.group({
    reason: [ID_MIGRATION_REASONS[0].value],
    comment: [''],
  });

  public continueToIndividualDashboard(): void {
    const { reason, comment } = this.form.getRawValue();
    const trimmedComment = (comment ?? '').trim();

    // Suppress the funnel event during Admin Mode impersonation: the RUM user context is the
    // impersonated user, so an admin's "Continue" would otherwise corrupt that user's funnel.
    // Navigation and dialog close still happen — only the analytics is gated.
    if (!this.userService.impersonating()) {
      this.rumService.addAction(ID_MIGRATION_EVENTS.CONTINUE, {
        funnel: ID_MIGRATION_FUNNEL,
        source_app: ID_MIGRATION_SOURCE_APP,
        reason,
        // Omit empty comments so the funnel query can distinguish "left a note" from "didn't".
        comment: trimmedComment || undefined,
      });
    }

    if (isPlatformBrowser(this.platformId)) {
      window.open(environment.urls.individualDashboard, '_blank', 'noopener,noreferrer');
    }

    this.dialogRef.close(true);
  }

  public stayHere(): void {
    this.dialogRef.close(false);
  }
}
