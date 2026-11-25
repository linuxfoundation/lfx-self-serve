// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaGroupSelectComponent } from '../../../profile/clas/cla-group-select.component';
import { SignIdentitySelectComponent } from '../../../profile/clas/sign-identity-select.component';
import { AccountSignDialogHostService } from './account-sign-dialog-host.service';
import { AccountClaGroupStepComponent } from './steps/account-cla-group-step.component';
import { AccountIdentityStepComponent } from './steps/account-identity-step.component';

describe('AccountSignDialogHostService', () => {
  let closed: Subject<unknown>;
  let close: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let host: AccountSignDialogHostService;
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
  const config = (header: string) => ({ header, data: {} }) as DynamicDialogConfig;

  beforeEach(() => {
    closed = new Subject<unknown>();
    close = vi.fn(() => closed.next(undefined));
    open = vi.fn(() => ({ closed, close }));
    TestBed.configureTestingModule({ providers: [AccountSignDialogHostService, { provide: UiModalService, useValue: { open } }] });
    host = TestBed.inject(AccountSignDialogHostService);
  });

  it('shows the account version of the step the hub opens, in one dialog', () => {
    host.open(ClaGroupSelectComponent, config('Sign a CLA'));
    host.open(SignIdentitySelectComponent, config('Select a GitHub account'));

    expect(open).toHaveBeenCalledTimes(1);
    expect(host.step()?.component).toBe(AccountIdentityStepComponent);
    expect(host.step()?.config.header).toBe('Select a GitHub account');
  });

  it('keeps the dialog for a step the hub opens once the previous one closes', async () => {
    const first = host.open(ClaGroupSelectComponent, config('Sign a CLA'));
    first.onDestroy.subscribe(() => host.open(SignIdentitySelectComponent, config('Select a GitHub account')));
    first.close({ claGroupId: 'cg-1' });
    await flush();

    expect(close).not.toHaveBeenCalled();
    expect(host.step()?.component).toBe(AccountIdentityStepComponent);
  });

  it('closes the dialog once a step ends with nothing after it', async () => {
    const step = host.open(ClaGroupSelectComponent, config('Sign a CLA'));
    expect(host.step()?.component).toBe(AccountClaGroupStepComponent);
    step.close(null);
    await flush();

    expect(close).toHaveBeenCalled();
    expect(host.step()).toBeNull();
  });

  it('stays open while the flow is busy between steps, then closes', async () => {
    const busy = signal(false);
    host.holdOpenWhile(busy);
    const step = host.open(ClaGroupSelectComponent, config('Sign a CLA'));
    busy.set(true);
    step.close({ claGroupId: 'cg-1' });
    await flush();
    expect(close).not.toHaveBeenCalled();

    busy.set(false);
    TestBed.tick();
    expect(close).toHaveBeenCalled();
  });

  it('ends the step without a result when the dialog is dismissed', () => {
    const step = host.open(ClaGroupSelectComponent, config('Sign a CLA'));
    const settled = { closed: false, destroyed: false };
    step.onClose.subscribe(() => (settled.closed = true));
    step.onDestroy.subscribe(() => (settled.destroyed = true));
    closed.next(undefined);

    expect(settled).toEqual({ closed: false, destroyed: true });
    expect(host.step()).toBeNull();
  });
});
