// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, ListKeyManager } from '@angular/cdk/a11y';
import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, inject, Injector, input, linkedSignal, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UiCommandGroup, UiCommandGroupView, UiCommandItem } from '@lfx-one/shared/interfaces';

import { UiKeyboardInputComponent } from '../keyboard-input/keyboard-input.component';

/**
 * The command palette: one search field that filters a grouped list of places and actions. It is the content of a modal, so open it
 * with `UiCommandMenuService.open`, which wraps it in `UiModalService` (focus trap, Escape, backdrop, focus restore) and resolves with the chosen
 * item. Built to the WAI-ARIA combobox with a listbox popup: focus stays in the search field and `aria-activedescendant` names the highlighted row.
 *
 * Typing narrows the list to commands whose label or keywords contain every word typed. Arrow Down and Arrow Up move the highlight, wrapping
 * at the ends and skipping disabled rows; Enter chooses; Escape closes. Home and End keep moving the cursor in the search field.
 */
@Component({
  selector: 'lfx-ui-command-menu',
  imports: [UiKeyboardInputComponent],
  templateUrl: './command-menu.component.html',
  styleUrl: './command-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Exact px, not rem; 14px root. The library's 640px width and 440px height have no Tailwind utility; both shrink to fit the window, with the modal's 32px margins.
    class:
      'flex max-h-[min(440px,calc(100vh-64px))] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-ui-lg bg-ui-background-100 shadow-modal',
    'data-testid': 'ui-command-menu',
  },
})
export class UiCommandMenuComponent {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-command-menu-');
  private readonly dialogRef = inject(DialogRef, { optional: true });
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /** The commands, grouped. */
  public readonly groups = input<UiCommandGroup[]>([]);
  /** Accessible name of the dialog and the search field. */
  public readonly label = input<string>('Command menu');
  /** Placeholder of the search field. */
  public readonly placeholder = input<string>('Search commands…');
  /** Emits the chosen command. Inside a modal the dialog also closes with it. */
  public readonly selected = output<UiCommandItem>();

  /** Id of the visually hidden title; `UiModalService` points `aria-labelledby` at it. Inside a service-opened modal it derives from the dialog id. */
  protected readonly titleId: string = this.dialogRef ? `${this.dialogRef.id}-title` : `${this.baseId}-title`;
  protected readonly listboxId = `${this.baseId}-listbox`;
  protected readonly query = signal('');
  protected readonly visibleGroups: Signal<UiCommandGroupView[]> = this.initVisibleGroups();
  protected readonly items: Signal<UiCommandItem[]> = computed(() => this.visibleGroups().flatMap((group) => group.items.map((view) => view.item)));
  // Back to the first row you can choose whenever the list changes, then follows the keyboard and the pointer.
  protected readonly activeIndex = linkedSignal(() => this.items().findIndex((item) => !item.disabled));
  protected readonly hasResults: Signal<boolean> = computed(() => this.items().length > 0);
  protected readonly activeDescendant: Signal<string | null> = computed(() => (this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null));
  protected readonly emptyText: Signal<string> = computed(() => (this.query().trim() ? `No results for “${this.query().trim()}”.` : 'No commands available.'));

  private readonly keyManager = new ListKeyManager(this.items, this.injector).withWrap().withVerticalOrientation();

  public constructor() {
    this.keyManager.change.pipe(takeUntilDestroyed()).subscribe((index) => this.activeIndex.set(index));
    // Keep the highlighted row in view whenever it moves: arrows, a search that resets it, or a first row below disabled ones.
    afterRenderEffect(() => {
      // Read the list too: a new search can leave the highlight on the same id with different content.
      this.visibleGroups();
      const id = this.activeDescendant();
      if (id) this.document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
    });
  }

  protected optionId(index: number): string {
    return `${this.baseId}-option-${index}`;
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    // During IME composition the keys belong to the candidate list; Escape only cancels the composition, so it must not reach the modal.
    if (event.isComposing) {
      if (event.key === 'Escape') event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Start the manager from the row the pointer may have moved the highlight to.
      this.keyManager.updateActiveItem(this.activeIndex());
      this.keyManager.onKeydown(event);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.choose(this.activeIndex());
    }
  }

  protected highlight(index: number): void {
    if (this.activeIndex() !== index && !this.items()[index]?.disabled) this.activeIndex.set(index);
  }

  protected choose(index: number): void {
    const item = this.items()[index];
    if (!item || item.disabled) return;
    this.selected.emit(item);
    this.dialogRef?.close(item);
  }

  private initVisibleGroups(): Signal<UiCommandGroupView[]> {
    return computed(() => {
      const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
      const matches = (item: UiCommandItem): boolean => {
        const text = [item.label, ...(item.keywords ?? [])].join(' ').toLowerCase();
        return words.every((word) => text.includes(word));
      };
      let next = 0;
      return this.groups()
        .map((group, groupIndex) => ({
          id: `${this.baseId}-group-${groupIndex}`,
          label: group.label,
          // Rows are numbered across groups, so the keyboard and the ids follow what is on screen.
          items: group.items.filter(matches).map((item) => {
            const index = next++;
            return { item, id: this.optionId(index), index };
          }),
        }))
        .filter((group) => group.items.length > 0);
    });
  }
}
