// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { IMPERSONATION_TARGET_USER_NOT_FOUND_CODE, IMPERSONATION_USER_NOT_FOUND_MESSAGE } from '@lfx-one/shared/constants';
import { ImpersonationService } from '@services/impersonation.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationDialogComponent } from './impersonation-dialog.component';

describe('ImpersonationDialogComponent', () => {
  let fixture: ComponentFixture<ImpersonationDialogComponent>;
  let startImpersonation: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    startImpersonation = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ImpersonationDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: ImpersonationService,
          useValue: {
            startImpersonation,
            getRecentImpersonations: () => [],
            addRecentImpersonation: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpersonationDialogComponent);
    await fixture.whenStable();
  });

  async function submitAs(target: string, httpError: { error?: { error?: string; code?: string } }): Promise<void> {
    startImpersonation.mockReturnValueOnce(throwError(() => httpError));
    const component = fixture.componentInstance as unknown as {
      targetUserForm: { controls: { targetUser: { setValue: (value: string) => void } } };
      submit: () => void;
    };
    component.targetUserForm.controls.targetUser.setValue(target);
    component.submit();
    await fixture.whenStable();
  }

  it('shows the locate copy for TARGET_USER_NOT_FOUND instead of the raw token-exchange 400', async () => {
    await submitAs('HWilson', {
      error: {
        code: IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
        error: 'token exchange request failed: upstream returned status 400',
      },
    });

    const alert = fixture.nativeElement.querySelector('[data-testid="impersonation-error"]');
    expect(alert?.textContent).toContain(IMPERSONATION_USER_NOT_FOUND_MESSAGE);
    expect(alert?.textContent).not.toContain('token exchange request failed');
    expect(alert?.textContent).not.toContain('upstream returned status 400');
  });

  it('shows a generic fallback for other failures instead of upstream text', async () => {
    await submitAs('jdoe', {
      error: {
        code: 'CTE_NATS_ERROR',
        error: 'Impersonation token exchange failed: TIMEOUT',
      },
    });

    const alert = fixture.nativeElement.querySelector('[data-testid="impersonation-error"]');
    expect(alert?.textContent).toContain('We could not start impersonation. Please try again.');
    expect(alert?.textContent).not.toContain('TIMEOUT');
  });
});
