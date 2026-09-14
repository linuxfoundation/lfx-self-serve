// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReasonPromptDialogComponent } from '@components/reason-prompt-dialog/reason-prompt-dialog.component';
import { FormationService } from '@services/formation.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { FormationItemDrawerComponent } from '../formation-item-drawer/formation-item-drawer.component';

import type { FormationItem, FormationItemOpenRequest, ReasonPromptDialogResult } from '@lfx-one/shared/interfaces';

/**
 * Dashboard-level host for the existing `formation-item-drawer` (GH-1956) — same precedent as
 * `dashboard-cast-drawer-host` for `vote-cast-drawer`. Opened from a Pending Actions row's **Open**
 * action; hosts one drawer instance per dashboard so the row component doesn't have to embed it.
 *
 * Reuses the drawer's own Save (and, when `assigneeOnly` is unset, Mark complete/Skip), and (unlike
 * the row's Claim/Block-with-note, which call `updateFormationItemStatus` directly) still wires the
 * drawer's `skipRequested` output — skip has no dedicated Pending Actions row action, but the drawer
 * offers it once open, so it must work here too, mirroring
 * `formation-checklist-section.component.ts`'s `onSkipRequested`. `assigneeOnly` is always set `true`
 * here (see `open()`) since every caller of this host is the Me-lens Pending Actions flow, where
 * GH-1956 decision 3 forbids the assignee from setting status at all.
 *
 * Emits `itemMutated` after any successful write so the hosting dashboard can refresh its Pending
 * Actions list — see `itemMutated`'s doc comment for why that refresh can't be left implicit.
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
  private readonly destroyRef = inject(DestroyRef);

  // Emits after Mark complete, Save, or Skip succeeds — `FormationService`'s mutations only
  // invalidate the `formation-work` stream (the card/tile), which is a separate cache from Pending
  // Actions' own `pending-actions` stream. The dashboard hosts bind this to their own refresh so a
  // drawer mutation doesn't leave the Pending Actions row showing stale status/actions.
  public readonly itemMutated = output<void>();

  protected readonly projectUid = signal<string | null>(null);
  protected readonly itemKey = signal<string | null>(null);
  protected readonly visible = signal<boolean>(false);
  // A single host only ever has one drawer open at a time, so one flag (not the section's per-uid
  // map) is enough to gate the drawer's `skipInFlight` input.
  protected readonly skipInFlight = signal<boolean>(false);
  // Set around the drawer's own Mark complete/Save (writeStarted/writeEnded), mirroring
  // `formation-checklist-section.component.ts`'s `drawerItemMutationInFlight` — a single host has no
  // per-uid map to key off, so one flag is enough. Combined with `skipInFlight` below to drive the
  // drawer's `mutationInFlight` input, so its buttons disable for either write kind.
  protected readonly writeInFlight = signal<boolean>(false);
  protected readonly mutationInFlight = computed(() => this.writeInFlight() || this.skipInFlight());
  // Mirrors `PendingActionItem.formationCanWrite` from the row that triggered `open()` — the drawer's
  // own `can_complete` gate has no relationship to real project write access (copilot review: an
  // auditor-only assignee would otherwise see an enabled Mark complete/Save that 403s server-side via
  // `assertItemProjectWriteAccess`). Defaults `true` so a future caller that omits it stays permissive.
  protected readonly canWrite = signal<boolean>(true);
  // GH-1956 decision 3: the Me-lens assignee never sets status ("No 'Mark done'"). This host is only
  // ever opened from the Pending Actions flow (see class doc comment), so this is always true rather
  // than a per-request flag — the drawer hides Mark complete/Accept/Skip entirely instead of merely
  // disabling them (copilot review, PR #2309).
  protected readonly assigneeOnly = signal<boolean>(true);

  public open(request: FormationItemOpenRequest): void {
    this.projectUid.set(request.projectUid);
    this.itemKey.set(request.itemKey);
    this.canWrite.set(request.canWrite ?? true);
    this.visible.set(true);
  }

  protected onItemChanged(): void {
    this.visible.set(false);
    this.itemMutated.emit();
  }

  // Metadata-only save (notes/assignee/due-date) — the drawer stays open, but due_date/notes changes
  // can still affect a Pending Actions row (e.g. its displayed due date), so this must also notify
  // the dashboard the same as a status change does.
  protected onItemUpdated(): void {
    this.itemMutated.emit();
  }

  protected onWriteStarted(): void {
    this.writeInFlight.set(true);
  }

  protected onWriteEnded(): void {
    this.writeInFlight.set(false);
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

    ref?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: ReasonPromptDialogResult | undefined) => {
      if (!result?.reason) return;
      this.skipInFlight.set(true);

      // No takeUntilDestroyed here (unlike the dialog's onClose above) — this is a write that must
      // complete once sent; unsubscribing on host destroy would cancel the in-flight HTTP request
      // and leave the item in an inconsistent state relative to what the server actually persisted.
      this.formationService.skipFormationItem(item.project_uid, item.template_item_key, result.reason).subscribe({
        next: () => {
          this.skipInFlight.set(false);
          this.visible.set(false);
          this.itemMutated.emit();
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
