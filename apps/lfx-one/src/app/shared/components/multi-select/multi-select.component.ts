// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, input, output, PLATFORM_ID } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectModule } from 'primeng/multiselect';

@Component({
  selector: 'lfx-multi-select',
  imports: [MultiSelectModule, ReactiveFormsModule],
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
  public readonly emptyMessage = input<string | undefined>(undefined);
  /** Message rendered INSIDE the panel when the active filter matches no options. */
  public readonly emptyFilterMessage = input<string | undefined>(undefined);
  /**
   * Pin the body-appended overlay panel to the trigger's width. PrimeNG 20 doesn't size a body-appended MultiSelect
   * overlay to its trigger (long labels/CSS floors mis-size it), so when true it's measured against the trigger and matched on each open.
   */
  public readonly matchTriggerWidth = input<boolean>(false);
  public readonly filterChange = output<string>();

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
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(`.p-multiselect-overlay.${panelClass}`);
      if (panel && width > 0) {
        panel.style.width = `${Math.round(width)}px`;
      }
    });
  }
}
