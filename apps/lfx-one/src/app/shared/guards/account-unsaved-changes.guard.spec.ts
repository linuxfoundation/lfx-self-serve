// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { accountUnsavedChangesGuard } from './account-unsaved-changes.guard';

describe('accountUnsavedChangesGuard', () => {
  it("answers with the unsaved-changes service's choice", async () => {
    const confirmLeave = vi.fn(() => of(false));
    TestBed.configureTestingModule({ providers: [{ provide: AccountUnsavedChangesService, useValue: { confirmLeave } }] });

    const result = TestBed.runInInjectionContext(() =>
      accountUnsavedChangesGuard({}, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, {} as RouterStateSnapshot)
    );

    expect(isObservable(result) && (await firstValueFrom(result))).toBe(false);
    expect(confirmLeave).toHaveBeenCalled();
  });
});
