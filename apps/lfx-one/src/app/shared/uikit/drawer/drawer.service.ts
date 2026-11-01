// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { hasModifierKey } from '@angular/cdk/keycodes';
import { ComponentType, Overlay } from '@angular/cdk/overlay';
import { DialogRef } from '@angular/cdk/dialog';
import { inject, Injectable, TemplateRef } from '@angular/core';
import { UiDrawerConfig } from '@lfx-one/shared/interfaces';
import { filter, takeUntil } from 'rxjs';

import { UiModalService } from '../modal/modal.service';
import { UiDrawerContext } from './drawer.context';

/**
 * Opens content in a drawer: a full-height side sheet over the page. Pass a component or an `<ng-template>` whose root is a
 * `lfx-ui-drawer`. It is a modal underneath (`UiModalService`), so focus is trapped and returns to the opener, the page behind does not
 * scroll, and Escape and a click on the backdrop close it unless the config turns them off. It slides out before it is removed.
 * Escape, the backdrop and the close button ask `canClose` first. `DialogRef.close()` (from the returned ref or `inject(DialogRef)`) does not.
 */
@Injectable({ providedIn: 'root' })
export class UiDrawerService {
  private readonly modal = inject(UiModalService);
  private readonly overlay = inject(Overlay);

  /** Opens the drawer and returns its `DialogRef`; `ref.closed` emits the result once the exit animation ends. */
  public open<R = unknown, D = unknown, C = unknown>(content: ComponentType<C> | TemplateRef<C>, config: UiDrawerConfig<D> = {}): DialogRef<R, C> {
    const context = new UiDrawerContext(config.side, config.width);
    const edge = this.overlay.position().global().top('0');
    let leaving = false;
    let exited = false;

    const ref = this.modal.open<R, D, C>(
      content,
      { ...config, closeOnEscape: false, closeOnBackdropClick: false },
      {
        positionStrategy: context.side === 'left' ? edge.left('0') : edge.right('0'),
        height: '100%',
        maxWidth: '100vw',
        providers: [{ provide: UiDrawerContext, useValue: context }],
        // Runs on every `ref.close()`: the first call plays the exit animation and closes again once it ends, with the same result.
        closePredicate: (result) => {
          if (exited) return true;
          if (!leaving) {
            leaving = true;
            ref.overlayRef.backdropElement?.classList.remove('cdk-overlay-backdrop-showing');
            // The host class is set on the element, not through the template: a close during teardown must not need a render.
            ref.overlayRef.overlayElement.querySelector('lfx-ui-drawer')?.classList.add('is-leaving');
            // No running animation (reduced motion) closes at once.
            const running = ref.overlayRef.overlayElement.getAnimations?.({ subtree: true }) ?? [];
            Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
              exited = true;
              ref.close(result as R);
            });
          }
          return false;
        },
      }
    );

    let asking = false;
    context.requestClose = () => {
      if (asking) return;
      asking = true;
      Promise.resolve(config.canClose?.() ?? true)
        .then((allowed) => {
          if (allowed) ref.close();
        })
        .finally(() => (asking = false));
    };

    if (config.closeOnEscape ?? true) {
      ref.keydownEvents
        .pipe(
          filter((event) => event.key === 'Escape' && !event.defaultPrevented && !hasModifierKey(event)),
          takeUntil(ref.closed)
        )
        .subscribe((event) => {
          event.preventDefault();
          context.requestClose();
        });
    }
    if (config.closeOnBackdropClick ?? true) {
      ref.backdropClick.pipe(takeUntil(ref.closed)).subscribe(() => context.requestClose());
    }
    return ref;
  }
}
