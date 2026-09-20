// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HeaderComponent } from '@components/header/header.component';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InviteService } from '@services/invite.service';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { InviteComponent } from './invite.component';

@Component({
  selector: 'lfx-header',
  template: '',
})
class StubHeaderComponent {}

describe('InviteComponent', () => {
  function createFixture(): ComponentFixture<InviteComponent> {
    TestBed.configureTestingModule({
      imports: [InviteComponent],
      providers: [
        provideRouter([]),
        // Server platform skips POST /api/invite/accept so this spec can assert the SSR/first-paint spinner.
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: InviteService, useValue: { acceptInvite: () => of({}) } },
        { provide: InvitationAcceptFlowService, useValue: { accept: () => of(undefined) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).overrideComponent(InviteComponent, {
      remove: { imports: [HeaderComponent] },
      add: { imports: [StubHeaderComponent] },
    });

    const fixture = TestBed.createComponent(InviteComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a CSS spinner rather than a Font Awesome icon while accepting (GH-2290)', () => {
    const fixture = createFixture();
    const spinner = fixture.nativeElement.querySelector('[data-testid="invite-accept-spinner"]') as HTMLElement | null;

    expect(spinner).not.toBeNull();
    expect(spinner?.classList.contains('animate-spin')).toBe(true);
    expect(fixture.nativeElement.querySelector('.fa-spinner-third')).toBeNull();
  });
});
