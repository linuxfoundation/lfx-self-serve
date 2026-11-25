// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, inject, Injectable, Injector, Signal, signal, Type } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { AccountSignDialogStep } from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { ClaGroupSelectComponent } from '../../../profile/clas/cla-group-select.component';
import { GitlabUnsupportedComponent } from '../../../profile/clas/gitlab-unsupported.component';
import { SignContractTypeSelectComponent } from '../../../profile/clas/sign-contract-type-select.component';
import { SignIdentitySelectComponent } from '../../../profile/clas/sign-identity-select.component';
import { AccountSignClaDialogComponent } from './account-sign-cla-dialog.component';
import { AccountSignDialogContext } from './account-sign-dialog-context';
import { AccountClaGroupStepComponent } from './steps/account-cla-group-step.component';
import { AccountContractTypeStepComponent } from './steps/account-contract-type-step.component';
import { AccountGitlabStepComponent } from './steps/account-gitlab-step.component';
import { AccountIdentityStepComponent } from './steps/account-identity-step.component';

/**
 * Stands in for PrimeNG's DialogService on Account & Settings › CLAs (#6077), so the hub's signing flow, which opens one dialog
 * per step, runs its steps inside a single "Sign a CLA" uikit dialog. Each step the hub opens swaps the dialog's content for
 * the account version of that step; the dialog closes once a step ends and nothing follows it.
 */
@Injectable()
export class AccountSignDialogHostService implements AccountSignDialogContext {
  private readonly modal = inject(UiModalService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  // The account version of each hub step; a step without one shows as it is.
  private readonly accountSteps = new Map<Type<unknown>, Type<unknown>>([
    [ClaGroupSelectComponent, AccountClaGroupStepComponent],
    [SignContractTypeSelectComponent, AccountContractTypeStepComponent],
    [SignIdentitySelectComponent, AccountIdentityStepComponent],
    [GitlabUnsupportedComponent, AccountGitlabStepComponent],
  ]);
  private dialogRef: DialogRef<unknown, AccountSignClaDialogComponent> | null = null;
  // While true, such as while the hub looks up linked accounts between steps, the dialog stays open showing it is busy.
  private hold: Signal<boolean> = signal(false);

  /** The step the dialog shows, or `null` between steps. */
  public readonly step = signal<AccountSignDialogStep<DynamicDialogConfig, DynamicDialogRef> | null>(null);
  /** The CLA group picked in the first step, which later steps name. */
  public readonly pickedName = signal('');

  /** Keeps the dialog open between steps while `busy` is true, and closes it when that ends with no step to show. */
  public holdOpenWhile(busy: Signal<boolean>): void {
    this.hold = busy;
    toObservable(busy, { injector: this.injector })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isBusy) => {
        if (!isBusy) this.closeIfIdle();
      });
  }

  /** PrimeNG's `DialogService.open`, as the hub calls it: shows the step and returns a ref that settles when the step ends. */
  public open(component: Type<unknown>, config: DynamicDialogConfig): DynamicDialogRef {
    const ref = new DynamicDialogRef();
    this.step.set({ component: this.accountSteps.get(component) ?? component, config, ref });
    if (!this.dialogRef) {
      // Escape, the backdrop and the close button can't end the flow mid-request; its toast or next step does.
      const dialogRef = this.modal.open(AccountSignClaDialogComponent, { data: this, autoFocus: 'dialog' }, { closePredicate: () => !this.isBusy() });
      this.dialogRef = dialogRef;
      dialogRef.closed.pipe(take(1)).subscribe(() => this.onDialogClosed(dialogRef));
    }
    ref.onClose.pipe(take(1)).subscribe(() => {
      if (this.step()?.ref === ref) this.step.set(null);
      // As PrimeNG does: the step is destroyed after it closes. The hub opens some next steps from there, so the dialog only
      // closes once that has had its turn.
      queueMicrotask(() => {
        ref.destroy();
        queueMicrotask(() => this.closeIfIdle());
      });
    });
    return ref;
  }

  /** Between steps while the flow works, such as looking up linked accounts. */
  private isBusy(): boolean {
    return !this.step() && this.hold();
  }

  private closeIfIdle(): void {
    if (this.step() || this.hold() || !this.dialogRef) return;
    const dialogRef = this.dialogRef;
    this.dialogRef = null;
    dialogRef.close();
  }

  // Escape, the backdrop or the close button ends the step without a result, which the hub reads as cancelled.
  private onDialogClosed(dialogRef: DialogRef<unknown, AccountSignClaDialogComponent>): void {
    if (this.dialogRef === dialogRef) this.dialogRef = null;
    const step = this.step();
    if (!step) return;
    this.step.set(null);
    step.ref.destroy();
  }
}
