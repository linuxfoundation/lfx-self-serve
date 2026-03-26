// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { WorkExperienceUpdate } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

@Component({
  selector: 'lfx-work-experience-confirmation-dialog',
  imports: [FormsModule, ButtonComponent, ToggleSwitchModule],
  templateUrl: './work-experience-confirmation-dialog.component.html',
})
export class WorkExperienceConfirmationDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly updates = signal<WorkExperienceUpdate[]>(
    (this.config.data.updates as WorkExperienceUpdate[]).map((u) => ({
      ...u,
      projectAffiliations: u.projectAffiliations.map((pa) => ({ ...pa })),
    }))
  );

  public toggleAffiliation(updateId: string, affiliationId: string): void {
    this.updates.update((updates) =>
      updates.map((u) => {
        if (u.id !== updateId) {
          return u;
        }
        return {
          ...u,
          projectAffiliations: u.projectAffiliations.map((pa) => {
            if (pa.id !== affiliationId) {
              return pa;
            }
            return { ...pa, enabled: !pa.enabled };
          }),
        };
      })
    );
  }

  public hasDisabledAffiliation(update: WorkExperienceUpdate): boolean {
    return update.projectAffiliations.some((pa) => !pa.enabled);
  }

  public confirm(): void {
    this.ref.close(this.updates());
  }

  public reject(): void {
    this.ref.close(null);
  }
}
