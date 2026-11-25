// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { ACCOUNT_PASSWORD_COPY, ACCOUNT_SETTINGS_SECTIONS } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountPasswordComponent } from './account-password.component';

/** State-only page: no template, so these tests cost no render. Providers are not inherited, so the page's own is repeated. */
@Component({ selector: 'lfx-test-account-password', template: '', providers: [DialogService] })
class StatePasswordComponent extends AccountPasswordComponent {}

describe('AccountPasswordComponent', () => {
  function setup(reset$: Observable<{ message: string }> = of({ message: 'sent' }), email: string | null = 'ada@lovelace.example') {
    const add = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { embedded: true, section: ACCOUNT_SETTINGS_SECTIONS.PASSWORD } }, fragment: of(null) } },
        {
          provide: UserService,
          useValue: { impersonating: signal(false), user: signal(email ? { email } : null), sendPasswordResetEmail: vi.fn(() => reset$) },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add, messageObserver: of(), clearObserver: of() } },
      ],
    });
    return { add };
  }

  async function state() {
    const fixture = TestBed.createComponent(StatePasswordComponent);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('tones the strength badge and checks off the criteria as the new password grows', async () => {
    setup();
    const page = await state();

    page.passwordForm.controls['newPassword'].setValue('abc');
    expect(page['strengthTone']()).toBe('danger');
    expect(
      page['criteria']()
        .filter((criterion) => criterion.met)
        .map((criterion) => criterion.label)
    ).toEqual(['Lowercase letter (a-z)']);

    page.passwordForm.controls['newPassword'].setValue('Abcdefg1!');
    expect(page['strengthTone']()).toBe('success');
    expect(page['criteria']().every((criterion) => criterion.met)).toBe(true);
  });

  it('confirms a sent reset link in a toast naming the address', async () => {
    const { add } = setup();
    const page = await state();

    page.onSendPasswordReset();

    expect(add).toHaveBeenCalledWith({
      severity: 'success',
      summary: 'Password reset link sent to ada@lovelace.example',
      detail: ACCOUNT_PASSWORD_COPY.resetSentDetail,
    });
    expect(page.resetResultMessage()).toBe('');
  });

  it('reports a failed reset link in a toast', async () => {
    const { add } = setup(throwError(() => new HttpErrorResponse({ status: 502, error: { message: 'Auth is down' } })));
    const page = await state();

    page.onSendPasswordReset();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Auth is down' }));
  });

  it('shows or hides each field on its own', async () => {
    setup();
    const page = await state();

    page['togglePassword']('new');

    expect(page.showNewPassword()).toBe(true);
    expect(page.showCurrentPassword()).toBe(false);
    expect(page.showConfirmPassword()).toBe(false);
  });

  it('lays out the three cards, with Cancel only once the form changes', async () => {
    setup();
    const fixture = TestBed.createComponent(AccountPasswordComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

    expect(query('account-password-recovery')?.textContent).toContain(ACCOUNT_PASSWORD_COPY.recoverySubtitle);
    expect(query('account-password-two-factor-note')?.textContent).toContain(ACCOUNT_PASSWORD_COPY.twoFactorUnavailable);
    expect(query('account-password-setup-2fa')?.querySelector('button')?.disabled).toBe(true);
    expect(query('account-password-cancel')).toBeNull();
    expect(query('account-password-submit')?.querySelector('button')?.disabled).toBe(true);

    fixture.componentInstance.passwordForm.controls['newPassword'].setValue('Abcdefg1!');
    fixture.componentInstance.passwordForm.markAsDirty();
    await fixture.whenStable();

    expect(query('account-password-cancel')).not.toBeNull();
    expect(query('account-password-strength-label')?.textContent?.trim()).toBe('Strong');
  });

  it('says when the new passwords do not match', async () => {
    setup();
    const fixture = TestBed.createComponent(AccountPasswordComponent);
    await fixture.whenStable();
    const form = fixture.componentInstance.passwordForm;
    form.controls['newPassword'].setValue('Abcdefg1!');
    form.controls['confirmPassword'].setValue('Abcdefg1?');
    form.controls['confirmPassword'].markAsTouched();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="account-password-mismatch"]')?.textContent).toContain('Passwords do not match');
  });
});
