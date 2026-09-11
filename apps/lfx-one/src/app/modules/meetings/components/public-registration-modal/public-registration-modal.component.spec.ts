// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { OrganizationService } from '@services/organization.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicRegistrationModalComponent } from './public-registration-modal.component';

/*
 * Upstream reads the registrant's identity off the caller's bearer token and the BFF omits `email`
 * from the self-registration payload, so an address typed into this field never reaches the row.
 * These cover the consequence for the person filling the form: they are never offered a choice the
 * write cannot honour, and they are told which address is being used.
 */
describe('PublicRegistrationModalComponent — identity-derived email', () => {
  let fixture: ComponentFixture<PublicRegistrationModalComponent>;

  function emailInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="public-registration-email-input"] input');
  }

  function hint(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="public-registration-email-hint"]');
  }

  function create(user: User | null): PublicRegistrationModalComponent {
    TestBed.configureTestingModule({
      imports: [PublicRegistrationModalComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { meetingId: 'meeting-1', meetingTitle: 'Board sync', user } } },
        { provide: MeetingService, useValue: { registerForPublicMeeting: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: OrganizationService, useValue: { searchOrganizations: vi.fn(), registerSessionOrg: vi.fn(), resolveOrganization: vi.fn() } },
      ],
    });

    fixture = TestBed.createComponent(PublicRegistrationModalComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
    TestBed.resetTestingModule();
  });

  it('locks the prefilled address and says which one is being used', () => {
    const component = create({ email: 'ada@acme-motors.example', name: 'Ada Lovelace' } as User);

    expect(component.emailIsIdentityDerived).toBe(true);
    expect(emailInput().value).toBe('ada@acme-motors.example');
    expect(emailInput().readOnly).toBe(true);
    // Named by the field rather than only shown beside it, so the reason reaches a screen reader that
    // would otherwise announce a required field with no way to change it.
    expect(emailInput().getAttribute('aria-describedby')).toBe('public-registration-email-hint');
    expect(hint()?.textContent).toContain('Registering with the email address on your account');
  });

  // Both openers are behind an authentication gate, so this is the path an authenticated caller should
  // not reach — but a read-only empty required field would be an unexplained dead end if they did.
  it('leaves the field editable when the session carries no address', () => {
    const component = create({ name: 'Ada Lovelace' } as User);

    expect(component.emailIsIdentityDerived).toBe(false);
    expect(emailInput().readOnly).toBe(false);
    expect(hint()).toBeNull();
  });

  it('treats a blank session address as no address at all', () => {
    const component = create({ email: '   ' } as User);

    expect(component.emailIsIdentityDerived).toBe(false);
    expect(emailInput().readOnly).toBe(false);
  });
});
