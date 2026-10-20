// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { ImpersonationTransition } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { ImpersonationTransitionOverlayComponent } from './impersonation-transition-overlay.component';

describe('ImpersonationTransitionOverlayComponent', () => {
  let fixture: ComponentFixture<ImpersonationTransitionOverlayComponent>;
  const transition = signal<ImpersonationTransition | null>(null);

  const overlay = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="impersonation-transition-overlay"]');

  beforeEach(async () => {
    transition.set(null);
    await TestBed.configureTestingModule({
      imports: [ImpersonationTransitionOverlayComponent],
      providers: [{ provide: ImpersonationService, useValue: { transition } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpersonationTransitionOverlayComponent);
    await fixture.whenStable();
  });

  it('renders nothing when no impersonation change is in flight', () => {
    expect(overlay()).toBeNull();
  });

  it.each(['starting', 'switching', 'stopping'] as const)('shows the %s message', async (value) => {
    transition.set(value);
    await fixture.whenStable();

    expect(overlay()?.textContent).toContain(IMPERSONATION_TRANSITION_MESSAGES[value]);
  });
});
