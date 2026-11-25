// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { NgComponentOutlet } from '@angular/common';
import { afterNextRender, Component, computed, ElementRef, inject, Injector, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ACCOUNT_SIGN_DIALOG_FOCUSABLE } from '@lfx-one/shared/constants';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import type { AccountSignDialogHostService } from './account-sign-dialog-host.service';
import { AccountSignDialogContext } from './account-sign-dialog-context';

/**
 * The "Sign a CLA" dialog of Account & Settings › CLAs (#6077): one uikit dialog that shows whichever signing step the hub's
 * flow is on, and a busy line between steps. Each step reads its dialog ref and config, and the dialog itself, by injection.
 */
@Component({
  selector: 'lfx-account-sign-cla-dialog',
  imports: [NgComponentOutlet, UiModalComponent, UiSpinnerComponent],
  templateUrl: './account-sign-cla-dialog.component.html',
})
export class AccountSignClaDialogComponent {
  protected readonly host = inject<AccountSignDialogHostService>(DIALOG_DATA);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly heading: Signal<string> = computed(() => this.host.step()?.config.header ?? 'Sign a CLA');
  /** What a step injects: its PrimeNG ref and config, as the hub opened it, and the dialog for what it shares between steps. */
  protected readonly stepInjector: Signal<Injector | undefined> = this.initStepInjector();
  /** No way out while the flow works between steps: it would leave the hub's request running. */
  protected readonly closable: Signal<boolean> = computed(() => !!this.host.step());

  public constructor() {
    // A new step replaces the old one's content, and with it whatever had focus, so focus moves to the new step.
    toObservable(this.host.step)
      .pipe(takeUntilDestroyed())
      .subscribe(() =>
        afterNextRender(
          () => {
            // In priority order: one selector list would match the header's Close button first.
            const step = this.element.querySelector<HTMLElement>('[data-testid="account-sign-cla-step"]');
            const target =
              step?.querySelector<HTMLElement>(`[data-autofocus] :is(${ACCOUNT_SIGN_DIALOG_FOCUSABLE})`) ??
              step?.querySelector<HTMLElement>(ACCOUNT_SIGN_DIALOG_FOCUSABLE);
            target?.focus();
          },
          { injector: this.injector }
        )
      );
  }

  private initStepInjector(): Signal<Injector | undefined> {
    return computed(() => {
      const step = this.host.step();
      if (!step) return undefined;
      return Injector.create({
        providers: [
          { provide: DynamicDialogRef, useValue: step.ref },
          { provide: DynamicDialogConfig, useValue: step.config },
          { provide: AccountSignDialogContext, useValue: this.host },
        ],
        parent: this.injector,
      });
    });
  }
}
