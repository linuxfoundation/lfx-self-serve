// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { UiToastItem } from '@lfx-one/shared/interfaces';

import { UiToastComponent } from './toast.component';

/**
 * The stack of toasts, a polite live region. `UiToastService` renders it once in a CDK overlay and keeps it there, so it already
 * exists when the first toast arrives and screen readers announce that toast. Not meant to be used directly.
 */
@Component({
  selector: 'lfx-ui-toast-region',
  imports: [UiToastComponent],
  templateUrl: './toast-region.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-[12px]',
    'aria-live': 'polite',
    'data-testid': 'ui-toast-region',
  },
})
export class UiToastRegionComponent {
  /** The service's toast list as a signal, newest first. */
  public readonly source = input.required<Signal<readonly UiToastItem[]>>();
  /** Emits the id of a toast that wants to go away. */
  public readonly dismissed = output<string>();

  protected readonly items: Signal<readonly UiToastItem[]> = this.initItems();

  private initItems(): Signal<readonly UiToastItem[]> {
    return computed(() => this.source()());
  }
}
