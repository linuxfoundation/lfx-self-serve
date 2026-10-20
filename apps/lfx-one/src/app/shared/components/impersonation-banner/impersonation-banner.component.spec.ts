// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationBannerComponent } from './impersonation-banner.component';

describe('ImpersonationBannerComponent', () => {
  let fixture: ComponentFixture<ImpersonationBannerComponent>;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    open = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ImpersonationBannerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DialogService, useValue: { open } },
        { provide: ImpersonationService, useValue: { stopImpersonation: vi.fn() } },
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

  it('opens the impersonation dialog in switching mode', () => {
    (fixture.componentInstance as unknown as { openSwitchDialog: () => void }).openSwitchDialog();

    expect(open).toHaveBeenCalledWith(ImpersonationDialogComponent, expect.objectContaining({ header: 'Switch Impersonated User', data: { switching: true } }));
  });
});
