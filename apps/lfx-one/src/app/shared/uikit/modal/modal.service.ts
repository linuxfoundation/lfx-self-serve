// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { ComponentType } from '@angular/cdk/overlay';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { inject, Injectable, TemplateRef } from '@angular/core';
import { UiModalConfig } from '@lfx-one/shared/interfaces';
import { filter, takeUntil } from 'rxjs';

/**
 * Opens content in a modal on top of the page. Pass a component or an `<ng-template>` whose root is a `lfx-ui-modal`.
 * Focus is trapped inside and returns to the element that had it, the page behind does not scroll, and Escape and a click on the
 * backdrop close it unless the config turns them off. Close it with the returned `DialogRef` or `inject(DialogRef)` from inside.
 */
@Injectable({ providedIn: 'root' })
export class UiModalService {
  private readonly dialog = inject(Dialog);
  private readonly ids = inject(_IdGenerator);

  /** Opens the modal and returns its `DialogRef`; `ref.closed` emits the result. */
  public open<R = unknown, D = unknown, C = unknown>(content: ComponentType<C> | TemplateRef<C>, config: UiModalConfig<D> = {}): DialogRef<R, C> {
    const id = this.ids.getId('lfx-ui-modal-');
    const closeOnEscape = config.closeOnEscape ?? true;
    const closeOnBackdropClick = config.closeOnBackdropClick ?? true;

    const ref = this.dialog.open<R, D, C>(content, {
      id,
      data: config.data,
      role: config.role ?? 'dialog',
      ariaModal: true,
      autoFocus: config.autoFocus ?? 'first-tabbable',
      // The title inside lfx-ui-modal takes this id.
      ariaLabelledBy: `${id}-title`,
      // A confirmation that needs an answer is described by its subtitle, the sentence that states the consequence.
      ariaDescribedBy: config.role === 'alertdialog' ? `${id}-subtitle` : null,
      restoreFocus: true,
      // The CDK closes on both Escape and backdrop click, or on neither. Split them here.
      disableClose: true,
      maxWidth: 'calc(100vw - 32px)',
      // The scrim colour is the ui-overlay token; the CDK's own 400ms fade is overridden with the library's.
      backdropClass: ['bg-ui-overlay', '!duration-ui-base', '!ease-ui-standard', 'motion-reduce:!transition-none'],
    });

    if (closeOnEscape) {
      ref.keydownEvents
        .pipe(
          filter((event) => event.key === 'Escape' && !event.defaultPrevented && !hasModifierKey(event)),
          takeUntil(ref.closed)
        )
        .subscribe((event) => {
          event.preventDefault();
          ref.close();
        });
    }
    if (closeOnBackdropClick) {
      ref.backdropClick.pipe(takeUntil(ref.closed)).subscribe(() => ref.close());
    }
    return ref;
  }
}
