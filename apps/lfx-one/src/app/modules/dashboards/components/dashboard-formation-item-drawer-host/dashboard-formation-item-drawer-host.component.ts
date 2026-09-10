// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { ReasonPromptDialogComponent } from '@components/reason-prompt-dialog/reason-prompt-dialog.component';
import { FormationService } from '@services/formation.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { FormationItemDrawerComponent } from '../formation-item-drawer/formation-item-drawer.component';

import type { FormationItem, ReasonPromptDialogResult } from '@lfx-one/shared/interfaces';

/**
 * Dashboard-level host for the existing `formation-item-drawer` (GH-1956) — same precedent as
 * `dashboard-cast-drawer-host` for `vote-cast-drawer`. Opened from a Pending Actions row's **Open**
 * action; hosts one drawer instance per dashboard so the row component doesn't have to embed it.
 *
 * Reuses the drawer's own Mark complete/Save, and (unlike the row's Claim/Block-with-note, which
 * call `updateFormationItemStatus` directly) still wires the drawer's `skipRequested` output —
 * skip has no dedicated Pending Actions row action, but the drawer offers it once open, so it must
 * work here too, mirroring `formation-checklist-section.component.ts`'s `onSkipRequested`.
 */
@Component({
  selector: 'lfx-dashboard-formation-item-drawer-host',
  imports: [FormationItemDrawerComponent],
  providers: [DialogService],
  templateUrl: './dashboard-formation-item-drawer-host.component.html',
})
export class DashboardFormationItemDrawerHostComponent {
  private readonly formationService = inject(FormationService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  protected readonly projectUid = signal<string | null>(null);
  protected readonly itemKey = signal<string | null>(null);
  protected readonly visible = signal<boolean>(false);
  // A single host only ever has one drawer open at a time, so one flag (not the section's per-uid
  // map) is enough to gate both the drawer's `mutationInFlight` and `skipInFlight` inputs.
  protected readonly skipInFlight = signal<boolean>(false);

  public open(request: { projectUid: string; itemKey: string }): void {
    this.projectUid.set(request.projectUid);
    this.itemKey.set(request.itemKey);
    this.visible.set(true);
  }

  protected onItemChanged(): void {
    this.visible.set(false);
    this.formationService.invalidateMyFormationWork();
  }

  protected onSkipRequested(item: FormationItem): void {
    const ref = this.dialogService.open(ReasonPromptDialogComponent, {
      header: 'Skip item',
      width: '480px',
      modal: true,
      data: {
        prompt: `Skipping "${item.title}" requires a reason. This is logged in the item's history.`,
        placeholder: 'Why is this item being skipped?',
        confirmLabel: 'Skip item',
      },
    });

    ref?.onClose.pipe(take(1)).subscribe((result: ReasonPromptDialogResult | undefined) => {
      if (!result?.reason) return;
      this.skipInFlight.set(true);

      this.formationService.skipFormationItem(item.project_uid, item.template_item_key, result.reason).subscribe({
        next: () => {
          this.skipInFlight.set(false);
          this.visible.set(false);
          this.formationService.invalidateMyFormationWork();
          this.messageService.add({ severity: 'success', summary: 'Skipped', detail: `"${item.title}" was skipped.` });
        },
        error: (error: unknown) => {
          this.skipInFlight.set(false);
          console.error('[DashboardFormationItemDrawerHost] Skip failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not skip this item.' });
        },
      });
    });
  }
}
