// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { describe, expect, it } from 'vitest';

import { InviteErrorComponent } from './invite-error.component';

describe('InviteErrorComponent', () => {
  function createFixture(): ComponentFixture<InviteErrorComponent> {
    TestBed.configureTestingModule({
      imports: [InviteErrorComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ reason: 'failed' }) } } },
        { provide: UserService, useValue: { authenticated: signal(false), user: signal(null) } },
      ],
    });

    const fixture = TestBed.createComponent(InviteErrorComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('uses a real href="/" home button rather than RouterLink (GH-2290)', () => {
    const fixture = createFixture();
    const button = fixture.nativeElement.querySelector('[data-testid="invite-error-home-button"]') as HTMLElement | null;

    expect(button).not.toBeNull();
    expect(button?.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(button?.querySelector('[ng-reflect-router-link], [routerLink]')).toBeNull();
  });
});
