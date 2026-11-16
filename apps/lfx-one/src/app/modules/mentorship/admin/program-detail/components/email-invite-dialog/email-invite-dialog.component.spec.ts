// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_LIST_NOTE, MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS } from '@lfx-one/shared/constants';
import { MentorshipEmailInviteDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailInviteDialogComponent } from './email-invite-dialog.component';

describe('EmailInviteDialogComponent', () => {
  let fixture: ComponentFixture<EmailInviteDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const build = (data: MentorshipEmailInviteDialogData | undefined = { email: 'new.mentor@example.org', programName: 'GridFlow' }): void => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EmailInviteDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogRef, useValue: { close } }, { provide: DynamicDialogConfig, useValue: { data } }],
    });

    fixture = TestBed.createComponent(EmailInviteDialogComponent);
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const click = (testId: string): void => element().querySelector<HTMLButtonElement>(`[data-testid="${testId}"] button`)?.click();

  beforeEach(() => build());

  it('names the address and the program, lists the three steps in order and says where the invitation shows', () => {
    const text = element().querySelector('[data-testid="mentorship-mentors-email-invite-dialog"]')?.textContent ?? '';
    expect(text).toContain('new.mentor@example.org');
    expect(text).toContain('GridFlow');
    expect(text).toContain(MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_LIST_NOTE);

    const steps = Array.from(element().querySelectorAll('[data-testid="mentorship-mentors-email-invite-steps"] li')).map((li) => li.textContent?.trim());
    expect(steps).toEqual([...MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS]);
  });

  it('closes with true on Send invite', () => {
    click('mentorship-mentors-email-invite-send');

    expect(close).toHaveBeenCalledWith(true);
  });

  it('closes with nothing on Cancel', () => {
    click('mentorship-mentors-email-invite-cancel');

    expect(close).toHaveBeenCalledWith();
  });

  it('renders without data', () => {
    build(undefined);

    expect(element().querySelector('[data-testid="mentorship-mentors-email-invite-dialog"]')).not.toBeNull();
  });
});
