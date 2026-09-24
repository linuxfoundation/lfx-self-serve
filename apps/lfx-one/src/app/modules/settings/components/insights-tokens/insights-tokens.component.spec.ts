// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InsightsToken, InsightsTokenEligibility } from '@lfx-one/shared/interfaces';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { UserService } from '@services/user.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsTokenCreateDialogComponent } from '../insights-token-create-dialog/insights-token-create-dialog.component';
import { InsightsTokenRevealDialogComponent } from '../insights-token-reveal-dialog/insights-token-reveal-dialog.component';
import { InsightsTokensComponent } from './insights-tokens.component';

const TOKEN: InsightsToken = { uid: 't-1', name: 'ci-pipeline', lookupId: 'Ab3kZ9QmT2xL', createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null };
const ELIGIBLE: InsightsTokenEligibility = { canCreate: true, orgs: [{ uid: 'org-1', name: 'Acme' }], checkFailed: false };

describe('InsightsTokensComponent', () => {
  let service: {
    getTokens: ReturnType<typeof vi.fn>;
    getEligibility: ReturnType<typeof vi.fn>;
    revokeToken: ReturnType<typeof vi.fn>;
  };
  let dialogService: { open: ReturnType<typeof vi.fn>; dialogComponentRefMap: { get: () => unknown } };
  let setDialogPt: ReturnType<typeof vi.fn>;
  let confirmationService: { confirm: ReturnType<typeof vi.fn> };
  let messageService: { add: ReturnType<typeof vi.fn> };
  let userService: { impersonating: WritableSignal<boolean> };
  let component: InsightsTokensComponent;

  const create = (): void => {
    TestBed.configureTestingModule({
      imports: [InsightsTokensComponent],
      providers: [
        { provide: InsightsTokensService, useValue: service },
        { provide: DialogService, useValue: dialogService },
        { provide: ConfirmationService, useValue: confirmationService },
        { provide: MessageService, useValue: messageService },
        { provide: UserService, useValue: userService },
      ],
    });
    TestBed.overrideComponent(InsightsTokensComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(InsightsTokensComponent).componentInstance;
    component['load']();
  };

  beforeEach(() => {
    service = {
      getTokens: vi.fn(() => of([TOKEN])),
      getEligibility: vi.fn(() => of(ELIGIBLE)),
      revokeToken: vi.fn(() => of(undefined)),
    };
    setDialogPt = vi.fn();
    dialogService = { open: vi.fn(), dialogComponentRefMap: { get: () => ({ setInput: setDialogPt, changeDetectorRef: { detectChanges: vi.fn() } }) } };
    confirmationService = { confirm: vi.fn() };
    messageService = { add: vi.fn() };
    userService = { impersonating: signal(false) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('loads tokens and eligibility, masking the value and labelling unused tokens', () => {
    create();

    expect(component['loading']()).toBe(false);
    expect(component['canCreate']()).toBe(true);
    expect(component['items']()).toEqual([{ token: TOKEN, maskedValue: 'lfi_Ab3kZ9QmT2xL********', lastUsedLabel: 'Never used' }]);
  });

  it('shows the load error state without dropping eligibility when listing fails', () => {
    service.getTokens.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    create();

    expect(component['loadError']()).toBe(true);
    expect(component['hasTokens']()).toBe(false);
    expect(component['canCreate']()).toBe(true);
  });

  it('distinguishes a failed eligibility check from a non-Key-Contact', () => {
    service.getEligibility.mockReturnValue(of({ canCreate: false, orgs: [], checkFailed: true }));
    create();

    expect(component['canCreate']()).toBe(false);
    expect(component['eligibilityCheckFailed']()).toBe(true);
  });

  it('prepends the created token and opens the one-time reveal dialog', () => {
    const created = { token: { ...TOKEN, uid: 't-2', name: 'new' }, secret: 'lfi_secret' };
    dialogService.open.mockReturnValueOnce({ onClose: of(created) });
    create();

    component['openCreateDialog']();

    expect(dialogService.open.mock.calls[0][1].data).toBeUndefined();
    expect(component['items']().map((item) => item.token.uid)).toEqual(['t-2', 't-1']);
    expect(dialogService.open).toHaveBeenLastCalledWith(
      InsightsTokenRevealDialogComponent,
      expect.objectContaining({ data: { name: 'new', secret: 'lfi_secret' } })
    );
  });

  it('keeps Escape from dismissing either dialog, so a one-time secret cannot be lost', () => {
    dialogService.open.mockReturnValueOnce({ onClose: of({ token: TOKEN, secret: 'lfi_secret' }) });
    create();

    component['openCreateDialog']();

    expect(dialogService.open).toHaveBeenCalledTimes(2);
    for (const [, config] of dialogService.open.mock.calls) {
      expect(config).toEqual(expect.objectContaining({ closeOnEscape: false, style: { maxWidth: '90vw' } }));
    }
  });

  it('names both headless dialogs by their headings for screen readers', () => {
    dialogService.open.mockReturnValueOnce({ onClose: of({ token: TOKEN, secret: 'lfi_secret' }) });
    create();

    component['openCreateDialog']();

    expect(setDialogPt.mock.calls).toEqual([
      ['pt', { pcDialog: { root: { 'aria-labelledby': InsightsTokenCreateDialogComponent.headingId } } }],
      ['pt', { pcDialog: { root: { 'aria-labelledby': InsightsTokenRevealDialogComponent.headingId } } }],
    ]);
  });

  it('does nothing when the create dialog is cancelled', () => {
    dialogService.open.mockReturnValueOnce({ onClose: of(undefined) });
    create();

    component['openCreateDialog']();

    expect(dialogService.open).toHaveBeenCalledTimes(1);
    expect(component['items']()).toHaveLength(1);
  });

  it('removes the row and toasts once a confirmed revoke succeeds', () => {
    confirmationService.confirm.mockImplementation((confirmation: Confirmation) => confirmation.accept?.());
    create();

    component['confirmRevoke'](TOKEN);

    expect(service.revokeToken).toHaveBeenCalledWith('t-1');
    expect(component['hasTokens']()).toBe(false);
    expect(component['revokingUid']()).toBeNull();
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('keeps the row, logs and toasts an error when revoke fails', () => {
    service.revokeToken.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    confirmationService.confirm.mockImplementation((confirmation: Confirmation) => confirmation.accept?.());
    create();

    component['confirmRevoke'](TOKEN);

    expect(component['hasTokens']()).toBe(true);
    expect(console.error).toHaveBeenCalled();
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  describe('while impersonating', () => {
    beforeEach(() => userService.impersonating.set(true));

    it("still loads the impersonated user's tokens and eligibility", () => {
      create();

      expect(service.getTokens).toHaveBeenCalled();
      expect(service.getEligibility).toHaveBeenCalled();
      expect(component['hasTokens']()).toBe(true);
      expect(component['canCreate']()).toBe(true);
    });

    it('never opens the create dialog', () => {
      create();

      component['openCreateDialog']();

      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it('never asks to confirm a revoke', () => {
      create();

      component['confirmRevoke'](TOKEN);

      expect(confirmationService.confirm).not.toHaveBeenCalled();
      expect(service.revokeToken).not.toHaveBeenCalled();
    });
  });
});
