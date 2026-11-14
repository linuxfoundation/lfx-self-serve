// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { ImpersonationTransition } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationBannerComponent } from './impersonation-banner.component';

describe('ImpersonationBannerComponent', () => {
  let fixture: ComponentFixture<ImpersonationBannerComponent>;
  let open: ReturnType<typeof vi.fn>;
  let closeAll: ReturnType<typeof vi.fn>;
  const transition = signal<ImpersonationTransition | null>(null);

  beforeEach(async () => {
    open = vi.fn();
    closeAll = vi.fn();
    transition.set(null);
    await TestBed.configureTestingModule({
      imports: [ImpersonationBannerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DialogService, useValue: { open } },
        { provide: Dialog, useValue: { closeAll } },
        { provide: ImpersonationService, useValue: { stopImpersonation: vi.fn(), transition } },
        {
          provide: UserService,
          useValue: { impersonating: signal(true), user: signal({ email: 'jdoe@example.test' }), impersonator: signal({ name: 'Admin' }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpersonationBannerComponent);
    await fixture.whenStable();
  });

  it('shows Switch User next to Stop Impersonating', () => {
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[data-testid="switch-impersonation-button"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="stop-impersonation-button"]')).toBeTruthy();
  });

  it('publishes its height so overlays stay clear of it', () => {
    expect(document.documentElement.style.getPropertyValue('--lfx-banner-height')).toBe('36px');
  });

  it('shows who is being viewed while no change is in flight', () => {
    const root: HTMLElement = fixture.nativeElement;

    expect(root.textContent).toContain('jdoe@example.test');
    expect(root.querySelector('[data-testid="impersonation-transition-message"]')).toBeNull();
  });

  it.each(['switching', 'stopping'] as const)('shows the %s progress in the bar and disables both buttons', async (value) => {
    transition.set(value);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[data-testid="impersonation-transition-message"]')?.textContent).toContain(IMPERSONATION_TRANSITION_MESSAGES[value]);
    expect(root.textContent).not.toContain('jdoe@example.test');
    expect(root.querySelector('[data-testid="switch-impersonation-button"] button')?.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector('[data-testid="stop-impersonation-button"] button')?.hasAttribute('disabled')).toBe(true);
  });

  it('closes open drawers and opens the impersonation dialog in switching mode', () => {
    (fixture.componentInstance as unknown as { openSwitchDialog: () => void }).openSwitchDialog();

    expect(closeAll).toHaveBeenCalled();

    expect(open).toHaveBeenCalledWith(ImpersonationDialogComponent, expect.objectContaining({ header: 'Switch Impersonated User', data: { switching: true } }));
  });
});
