// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { VIEWS_DROPDOWN_NAME_TOOLTIP_THRESHOLD } from '@lfx-one/shared/constants';
import { ConfirmationService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

import type { SavedFilter } from '@lfx-one/shared/interfaces';

/**
 * Saved-views dropdown (LFXV2-3002 Block 3, PCC port): default row, saved views with active check + per-row
 * delete confirm, skeletons, roving-focus keyboard nav, footer save action. `ConfirmationService` resolves from the page.
 */
@Component({
  selector: 'lfx-views-dropdown',
  imports: [SkeletonModule, TooltipModule],
  templateUrl: './views-dropdown.component.html',
  styleUrl: './views-dropdown.component.scss',
})
export class ViewsDropdownComponent {
  protected readonly nameTooltipThreshold = VIEWS_DROPDOWN_NAME_TOOLTIP_THRESHOLD;

  public readonly savedViews = input<SavedFilter[]>([]);
  public readonly activeViewId = input<string | null>(null);
  public readonly canSaveCurrentView = input(false);
  public readonly atSavedViewLimit = input(false);
  public readonly savedViewLimit = input(0);
  public readonly readOnly = input(false);
  public readonly isLoading = input(false);
  public readonly deletingViewIds = input<ReadonlySet<string>>(new Set());

  public readonly viewSelected = output<SavedFilter>();
  public readonly defaultViewSelected = output<void>();
  public readonly viewDeleted = output<SavedFilter>();
  public readonly saveCurrentViewRequested = output<void>();
  public readonly close = output<void>();

  private readonly confirmationService = inject(ConfirmationService);
  private readonly listRef = viewChild<ElementRef<HTMLUListElement>>('viewsList');

  public constructor() {
    afterNextRender(() => this.focusByIndex(0));
  }

  protected onListKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      this.close.emit();
      return;
    }
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;

    const buttons = this.collectFocusables(event.currentTarget as HTMLElement);
    if (buttons.length === 0) return;

    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    switch (key) {
      case 'ArrowDown':
        buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
        break;
      case 'ArrowUp':
        buttons[Math.max(index - 1, 0)]?.focus();
        break;
      case 'Home':
        buttons[0]?.focus();
        break;
      case 'End':
        buttons[buttons.length - 1]?.focus();
        break;
    }
  }

  protected onDeleteClick(event: MouseEvent, view: SavedFilter): void {
    event.stopPropagation();
    if (this.deletingViewIds().has(view.id)) return;

    // Repo dialog pattern (p-confirmDialog hosted by the page), not PCC's ConfirmPopup.
    this.confirmationService.confirm({
      header: 'Remove saved view?',
      message: `Are you sure you want to remove "${view.name}"? This action cannot be undone.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.viewDeleted.emit(view),
    });
  }

  private collectFocusables(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.view-row__apply'));
  }

  private focusByIndex(index: number): void {
    const list = this.listRef()?.nativeElement;
    if (!list) return;
    this.collectFocusables(list)[index]?.focus();
  }
}
