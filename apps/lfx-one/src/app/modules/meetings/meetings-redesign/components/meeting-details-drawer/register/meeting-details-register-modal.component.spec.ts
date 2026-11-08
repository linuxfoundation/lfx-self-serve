// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingRegisterDialogData, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsRegisterModalComponent } from './meeting-details-register-modal.component';

describe('MeetingDetailsRegisterModalComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  let registerForPublicMeeting: ReturnType<typeof vi.fn>;

  const render = async (user: Partial<User> | null): Promise<ComponentFixture<MeetingDetailsRegisterModalComponent>> => {
    const data: MeetingRegisterDialogData = { meetingId: 'synthetic-meeting', meetingTitle: 'Synthetic sync', user: user as User | null };
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
        { provide: MeetingService, useValue: { registerForPublicMeeting } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingDetailsRegisterModalComponent);
    await fixture.whenStable();
    return fixture;
  };
  const field = (fixture: ComponentFixture<unknown>, testId: string): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"] input`) as HTMLInputElement;
  const submit = (fixture: ComponentFixture<unknown>): HTMLButtonElement =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="meeting-details-register-submit"] button') as HTMLButtonElement;

  beforeEach(() => {
    close = vi.fn();
    show = vi.fn();
    registerForPublicMeeting = vi.fn(() => of({ uid: 'registrant-1' }));
  });

  it('fills the form from the profile and locks the email to the account', async () => {
    const fixture = await render({ name: ' Ada  King Lovelace', email: 'ada@example.test' });

    expect(field(fixture, 'meeting-details-register-first-name').value).toBe('Ada');
    expect(field(fixture, 'meeting-details-register-last-name').value).toBe('King Lovelace');
    expect(field(fixture, 'meeting-details-register-email').value).toBe('ada@example.test');
    expect(field(fixture, 'meeting-details-register-email').readOnly).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Registering with the email address on your account.');
  });

  it('falls back to the given and family names, and leaves the email editable without one', async () => {
    const fixture = await render({ given_name: 'Ada', family_name: 'Lovelace' });

    expect(field(fixture, 'meeting-details-register-first-name').value).toBe('Ada');
    expect(field(fixture, 'meeting-details-register-last-name').value).toBe('Lovelace');
    expect(field(fixture, 'meeting-details-register-email').readOnly).toBe(false);
    expect(submit(fixture).disabled).toBe(true);
  });

  it('says a blank first name cannot be empty once edited and left', async () => {
    const fixture = await render({ name: 'Ada Lovelace', email: 'ada@example.test' });
    const input = field(fixture, 'meeting-details-register-first-name');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('First name cannot be empty');
    expect(submit(fixture).disabled).toBe(true);
  });

  it('registers with the optional fields only when filled, then closes with the registration', async () => {
    const fixture = await render({ name: 'Ada Lovelace', email: 'ada@example.test' });
    const org = field(fixture, 'meeting-details-register-company');
    org.value = 'Acme Motors';
    org.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    submit(fixture).click();

    expect(registerForPublicMeeting).toHaveBeenCalledWith({
      meeting_id: 'synthetic-meeting',
      email: 'ada@example.test',
      first_name: 'Ada',
      last_name: 'Lovelace',
      org_name: 'Acme Motors',
    });
    expect(show).toHaveBeenCalledWith({
      variant: 'success',
      position: 'bottom-center',
      message: 'Registration Successful',
      description: 'You have been registered for this meeting',
    });
    expect(close).toHaveBeenCalledWith({ uid: 'registrant-1' });
  });

  it("keeps the dialog open behind an error toast with the server's reason", async () => {
    registerForPublicMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Last name is required.' } })));
    const fixture = await render({ name: 'Ada Lovelace', email: 'ada@example.test' });
    submit(fixture).click();
    await fixture.whenStable();

    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'Registration Failed', description: 'Last name is required.' }));
    expect(close).not.toHaveBeenCalled();
    expect(submit(fixture).disabled).toBe(false);
  });
});
