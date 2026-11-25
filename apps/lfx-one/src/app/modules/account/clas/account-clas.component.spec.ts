// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MyClaAgreement, MyClasResponse } from '@lfx-one/shared/interfaces';
import { MyClasService } from '@services/my-clas.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountClasComponent } from './account-clas.component';
import { AccountClaRequestDialogComponent } from './request-dialog/account-cla-request-dialog.component';
import { AccountSignClaDialogComponent } from './sign-dialog/account-sign-cla-dialog.component';
import { AccountSignDialogHostService } from './sign-dialog/account-sign-dialog-host.service';
import { AccountClaGroupStepComponent } from './sign-dialog/steps/account-cla-group-step.component';

const ICLA: MyClaAgreement = { id: 'icla', kind: 'ICLA', claGroupName: 'Project One', signedOn: '2022-01-01T18:40:42Z', status: 'valid', pdfAvailable: true };
const CCLA: MyClaAgreement = {
  id: 'ccla',
  kind: 'ECLA',
  claGroupName: 'Project Two',
  projectName: 'Project Two',
  companyName: 'Acme Motors',
  signedOn: '2023-02-01T00:00:00Z',
  status: 'needs_attention',
  statusReason: 'not_on_approval_list',
  pdfAvailable: false,
};

/** State-only page: no template, so these tests cost no render. Providers are not inherited, so the page's own is repeated. */
@Component({
  selector: 'lfx-test-account-clas',
  template: '',
  providers: [AccountSignDialogHostService, { provide: DialogService, useExisting: AccountSignDialogHostService }],
})
class StateClasComponent extends AccountClasComponent {}

describe('AccountClasComponent', () => {
  /** What the page hands the modal: its providers turn the CDK dialog into the hub dialog's PrimeNG one. */
  interface ModalOverrides {
    providers: (ref: { close: (result?: unknown) => void }) => { provide: unknown; useValue: { close?: (result?: unknown) => void; data?: unknown } }[];
  }

  function setup(agreements: MyClaAgreement[] | 'error', impersonating = false) {
    const response$: Observable<MyClasResponse> =
      agreements === 'error'
        ? throwError(() => new Error('down'))
        : of({ agreements, identity: { matchedUserIds: agreements.length ? 1 : 0, unmatched: !agreements.length, githubLinked: true } });
    const open = vi.fn<(content: unknown, config: unknown, overrides: ModalOverrides) => { closed: Observable<undefined> }>(() => ({ closed: of(undefined) }));
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: MyClasService, useValue: { getMyClas: () => response$, getPdfUrl: vi.fn() } },
        { provide: UserService, useValue: { impersonating: signal(impersonating) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UiModalService, useValue: { open } },
      ],
    });
    return { open };
  }

  async function renderPage(agreements: MyClaAgreement[] | 'error', impersonating = false) {
    setup(agreements, impersonating);
    const fixture = TestBed.createComponent(AccountClasComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { host, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('offers a PDF for an ICLA and the requests its state allows for a CCLA', async () => {
    setup([ICLA, CCLA]);
    const fixture = TestBed.createComponent(StateClasComponent);
    await fixture.whenStable();
    const [icla, ccla] = fixture.componentInstance['accountRows']();

    expect(icla.actions).toEqual({ download: true, requestApproval: false, requestRemoval: false, contact: false });
    expect(icla.typeLabel).toBe('ICLA');
    expect(icla.statusTone).toBe('success');
    expect(ccla.actions).toEqual({ download: false, requestApproval: true, requestRemoval: true, contact: true });
    expect(ccla.typeLabel).toBe('CCLA · Acme Motors');
    expect(ccla.statusTone).toBe('warning');
  });

  it('offers nothing on a revoked row', async () => {
    setup([{ ...CCLA, status: 'revoked' }]);
    const fixture = TestBed.createComponent(StateClasComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance['accountRows']()[0].hasActions).toBe(false);
  });

  it('opens the CCLA request dialog with the agreement and the hub dialog’s data', async () => {
    const { open } = setup([CCLA]);
    const fixture = TestBed.createComponent(StateClasComponent);
    await fixture.whenStable();
    fixture.componentInstance['openRequest'](CCLA, 'approval');

    expect(open).toHaveBeenCalledWith(
      AccountClaRequestDialogComponent,
      expect.objectContaining({ data: { agreement: CCLA, mode: 'approval' } }),
      expect.objectContaining({ providers: expect.any(Function) })
    );
  });

  it('feeds the hub dialog its PrimeNG ref and data through the modal', async () => {
    const { open } = setup([CCLA]);
    const fixture = TestBed.createComponent(StateClasComponent);
    await fixture.whenStable();
    fixture.componentInstance['openRequest'](CCLA, 'approval');

    const ref = { close: vi.fn() };
    const providers = open.mock.calls[0][2].providers(ref);
    providers.find((provider) => provider.provide === DynamicDialogRef)?.useValue.close?.('sent');
    expect(ref.close).toHaveBeenCalledWith('sent');
    expect(providers.find((provider) => provider.provide === DynamicDialogConfig)?.useValue.data).toEqual({
      signatureId: 'ccla',
      projectName: 'Project Two',
      mode: 'approval',
    });
  });

  it('opens no request while impersonating, and says why the requests are off', async () => {
    const { open } = setup([CCLA], true);
    const fixture = TestBed.createComponent(StateClasComponent);
    await fixture.whenStable();
    fixture.componentInstance['openRequest'](CCLA, 'removal');

    expect(open).not.toHaveBeenCalled();
    expect(fixture.componentInstance['signDisabledReason']()).toBe('Sign CLA — unavailable while impersonating another user');
  });

  it('signs in the one "Sign a CLA" dialog, starting with the account search step', async () => {
    const { open } = setup([ICLA]);
    open.mockReturnValueOnce({ closed: NEVER });
    const fixture = TestBed.createComponent(StateClasComponent);
    await fixture.whenStable();
    fixture.componentInstance['openSignDialog']();

    expect(open).toHaveBeenCalledWith(
      AccountSignClaDialogComponent,
      expect.objectContaining({ autoFocus: 'dialog' }),
      expect.objectContaining({ closePredicate: expect.any(Function) })
    );
    const host = fixture.debugElement.injector.get(AccountSignDialogHostService);
    expect(host.step()?.component).toBe(AccountClaGroupStepComponent);
    expect(host.step()?.config.data).toEqual({ agreements: [ICLA] });
  });

  it('shows the agreements in a table, with the identities link below', async () => {
    const { query } = await renderPage([ICLA, CCLA]);

    expect(query('account-clas-type-ccla')?.textContent?.trim()).toBe('CCLA · Acme Motors');
    expect(query('account-clas-status-ccla')?.textContent).toContain('Needs attention');
    expect(query('account-clas-footer-link')?.getAttribute('href')).toBe('/account/identities');
    expect(query('account-clas-sign')).not.toBeNull();
  });

  it('offers to sign or link identities when there are none', async () => {
    const { query } = await renderPage([]);

    expect(query('account-clas-empty')?.textContent).toContain('No CLAs on file yet');
    expect(query('account-clas-empty-identities')).not.toBeNull();
    expect(query('account-clas-sign')).toBeNull();
  });

  it('offers a retry when the CLAs fail to load', async () => {
    const { query } = await renderPage('error');

    expect(query('account-clas-error')).not.toBeNull();
    expect(query('account-clas-retry')).not.toBeNull();
  });
});
