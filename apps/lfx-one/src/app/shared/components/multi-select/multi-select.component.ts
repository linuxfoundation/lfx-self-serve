// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, contentChild, ElementRef, inject, input, output, PLATFORM_ID, TemplateRef } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectModule } from 'primeng/multiselect';

@Component({
  selector: 'lfx-multi-select',
  imports: [MultiSelectModule, ReactiveFormsModule, NgTemplateOutlet],
  templateUrl: './multi-select.component.html',
  styleUrl: './multi-select.component.scss',
})
export class MultiSelectComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly options = input.required<any[]>();
  public readonly optionLabel = input<string>('label');
  public readonly optionValue = input<string>('value');
  public readonly optionSubLabel = input<string | undefined>(undefined);
  public readonly optionImage = input<string | undefined>(undefined);
  public readonly placeholder = input<string>('Select');
  public readonly showToggleAll = input<boolean>(true);
  /** Max simultaneous selections (PrimeNG `selectionLimit`) — undefined = unbounded. */
  public readonly selectionLimit = input<number | undefined>(undefined);
  public readonly appendTo = input<any>('body');
  public readonly filter = input<boolean>(true);
  /** Focus the in-panel filter input as soon as the overlay opens (PrimeNG defaults this to false). */
  public readonly autofocusFilter = input<boolean>(false);
  /** Clear the filter box when the overlay hides so a reopened panel never shows stale filter text. */
  public readonly resetFilterOnHide = input<boolean>(false);
  public readonly filterBy = input<string | undefined>(undefined);
  public readonly filterPlaceHolder = input<string>('Search');
  public readonly size = input<'small' | 'large'>('small');
  public readonly styleClass = input<string>('w-full');
  public readonly panelStyleClass = input<string | undefined>(undefined);
  public readonly scrollHeight = input<string>('14rem');
  /** Show a spinner on the trigger while an async (e.g. server-side) option load is in flight. */
  public readonly loading = input<boolean>(false);
  /** Message shown INSIDE the panel when there are no options and no active filter — kept in-panel so the body-appended overlay never floats over it. */
  public readonly emptyMessage = input<string>('No results found');
  /** Message rendered INSIDE the panel when the active filter matches no options. */
  public readonly emptyFilterMessage = input<string>('No results found');
  /**
   * Always-visible status banner rendered in the panel FOOTER (e.g. searching / load error / min-length hint).
   * Unlike emptyMessage/emptyFilterMessage — which PrimeNG only renders when the option list is empty — the footer
   * shows regardless, so a still-selected option that matches the active filter can't keep the list non-empty and
   * hide the status. Leave undefined for no banner.
   */
  public readonly panelStatus = input<string | undefined>(undefined);
  /**
   * Pin the body-appended overlay panel to the trigger's width. PrimeNG 20 doesn't size a body-appended MultiSelect
   * overlay to its trigger (long labels/CSS floors mis-size it), so when true it's measured against the trigger and matched on each open.
   */
  public readonly matchTriggerWidth = input<boolean>(false);
  /** Accessible label forwarded to the focusable input (PrimeNG `ariaLabel`). */
  public readonly ariaLabel = input<string | undefined>(undefined);
  /** Id applied to the focusable input — pair with an external `<label for>` (PrimeNG `inputId`). */
  public readonly inputId = input<string | undefined>(undefined);
  public readonly filterChange = output<string>();

  /** Optional custom option template (mirrors `lfx-select`'s `itemTemplate`) for richer rows — project as `<ng-template let-option #item>`; takes precedence over the built-in layout. */
  public readonly itemTemplate = contentChild<TemplateRef<unknown>>('item');

  /** On panel open, match the body-appended overlay's width to the trigger (opt-in). Browser-only (touches document/rAF). */
  protected onPanelShow(): void {
    if (!this.matchTriggerWidth() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    const trigger = this.host.nativeElement.querySelector<HTMLElement>('.p-multiselect');
    const panelClass = this.panelStyleClass()?.trim().split(/\s+/)[0];
    if (!trigger || !panelClass) {
      return;
    }

    const width = trigger.getBoundingClientRect().width;
    // The overlay is appended to <body>, so reach it via its unique panel class rather than a
    // descendant query. Set on the next frame so the overlay element is in the DOM and laid out.
    // Assumes a given panelStyleClass identifies a single open overlay at a time — if two instances
    // sharing the class were open simultaneously this would match the first one; callers keep the class unique.
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(`.p-multiselect-overlay.${panelClass}`);
      if (panel && width > 0) {
        panel.style.width = `${Math.round(width)}px`;
      }
    });
  }
}
