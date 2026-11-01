// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { hasModifierKey } from '@angular/cdk/keycodes';
import { ComponentType, Overlay } from '@angular/cdk/overlay';
import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, TemplateRef } from '@angular/core';
import { UiDrawerConfig } from '@lfx-one/shared/interfaces';
import { filter, takeUntil } from 'rxjs';

import { UiModalService } from '../modal/modal.service';
import { UiDrawerContext } from './drawer.context';

/**
 * Opens content in a drawer: a full-height side sheet over the page. Pass a component or an `<ng-template>` whose root is a
 * `lfx-ui-drawer`. It is a modal underneath (`UiModalService`), so focus is trapped and returns to the opener, the page behind does not
 * scroll, and Escape and a click on the backdrop close it unless the config turns them off. It slides out before it is removed.
 * Escape, the backdrop and the close button ask `canClose` first, and are ignored while it slides out. `DialogRef.close()` (from the
 * returned ref or `inject(DialogRef)`) does not ask. If the overlay is disposed from outside, as on browser Back, it closes at once.
 */
@Injectable({ providedIn: 'root' })
export class UiDrawerService {
  private readonly modal = inject(UiModalService);
  private readonly overlay = inject(Overlay);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Opens the drawer and returns its `DialogRef`; `ref.closed` emits the result once the exit animation ends. */
  public open<R = unknown, D = unknown, C = unknown>(content: ComponentType<C> | TemplateRef<C>, config: UiDrawerConfig<D> = {}): DialogRef<R, C> {
    const context = new UiDrawerContext(config.side, config.width);
    const edge = this.overlay.position().global().top('0');
    let leaving = false;
    let exited = false;
    // Filled once `modal.open` returns; the predicate can run before that if the content closes itself while it is created.
    const opened: { ref?: DialogRef<R, C> } = {};

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
          // Nothing to animate on the server, before the ref exists (content closed itself while being created) or once the overlay is detached (disposed on navigation).
          const current = opened.ref;
          if (!this.isBrowser || !current || exited || !current.overlayRef.hasAttached()) return true;
          if (!leaving) {
            leaving = true;
            current.overlayRef.backdropElement?.classList.remove('cdk-overlay-backdrop-showing');
            // The host class is set on the element, not through the template: a close during teardown must not need a render.
            const host = current.overlayRef.overlayElement.querySelector('lfx-ui-drawer');
            host?.classList.add('is-leaving');
            const finish = () => {
              if (exited) return;
              clearTimeout(timer);
              exited = true;
              current.close(result as R);
            };
            // Fallback so a missing `finished` cannot strand the close: the exit animation's own duration plus a 150ms margin.
            const timer = setTimeout(finish, (parseFloat(getComputedStyle(host ?? current.overlayRef.overlayElement).animationDuration) || 0) * 1000 + 150);
            // Only the host's own exit animation counts: looping ones in the body (Skeleton, Spinner) never finish. None running closes at once.
            Promise.allSettled((host?.getAnimations?.() ?? []).map((animation) => animation.finished)).then(finish);
          }
          return false;
        },
      }
    );

    opened.ref = ref;

    let asking = false;
    context.requestClose = () => {
      if (asking || leaving) return;
      asking = true;
      Promise.resolve()
        .then(() => config.canClose?.() ?? true)
        .then((allowed) => {
          if (allowed) ref.close();
        })
        .catch((error) => console.error('lfx-ui-drawer canClose failed; keeping it open', error))
        .finally(() => (asking = false));
    };

    if (config.closeOnEscape ?? true) {
      ref.keydownEvents
        .pipe(
          filter((event) => event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented && !hasModifierKey(event)),
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
