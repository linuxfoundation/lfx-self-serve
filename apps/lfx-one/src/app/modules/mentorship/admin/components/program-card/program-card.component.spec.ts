// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED,
  MENTORSHIP_ENROLL_LOGO_TOO_LARGE,
  MENTORSHIP_ENROLL_LOGO_TYPE_ERROR,
  MENTORSHIP_ENROLL_UPLOADS_UNAVAILABLE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_PROGRAM_CARD_ADD_LOGO,
  MENTORSHIP_PROGRAM_CARD_LOGO_ADDED,
  MENTORSHIP_PROGRAM_CARD_LOGO_FORBIDDEN,
  MENTORSHIP_PROGRAM_CARD_LOGO_MISSING,
} from '@lfx-one/shared/constants';
import { MentorshipProgram } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgramCardComponent } from './program-card.component';

interface CardInternals {
  onAddLogo: (fileInput: HTMLInputElement) => void;
  onLogoPicked: (event: Event) => void;
}

describe('ProgramCardComponent', () => {
  const program = (overrides: Partial<MentorshipProgram> = {}): MentorshipProgram => ({
    id: 'prog_1',
    slug: 'acme-rocket-mentorship',
    name: 'Acme Rocket Mentorship',
    projectName: 'Acme Rocket',
    term: 'Fall 2026',
    status: 'pending-review',
    stats: { mentors: 0, mentees: 0, graduated: 0 },
    logoMissing: true,
    createdOn: '2026-10-01T00:00:00Z',
    updatedOn: '2026-10-01T00:00:00Z',
    ...overrides,
  });

  const png = (): File => new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });

  let fixture: ComponentFixture<ProgramCardComponent>;
  let uploadProgramLogo: ReturnType<typeof vi.fn>;
  let toasts: ReturnType<typeof vi.spyOn>;

  const create = (overrides: Partial<MentorshipProgram> = {}): HTMLElement => {
    fixture = TestBed.createComponent(ProgramCardComponent);
    fixture.componentRef.setInput('program', program(overrides));
    fixture.detectChanges();
    toasts = vi.spyOn(TestBed.inject(MessageService), 'add');
    return fixture.nativeElement as HTMLElement;
  };

  const internals = (): CardInternals => fixture.componentInstance as unknown as CardInternals;

  /** Picks `file` on a detached input, the way the hidden input's change event reaches the card. */
  const pick = (file: File): void => {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file] });
    internals().onLogoPicked({ target: input } as unknown as Event);
  };

  const lastToastDetail = (): string | undefined => (toasts.mock.calls.at(-1)?.[0] as { detail?: string } | undefined)?.detail;

  beforeEach(() => {
    uploadProgramLogo = vi.fn().mockReturnValue(of({ logoUrl: 'https://cdn.example/logo.png' }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramCardComponent],
      providers: [MessageService, { provide: MentorshipAdminService, useValue: { uploadProgramLogo } }],
    });
    TestBed.overrideComponent(ProgramCardComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  });

  it('shows no hint when the logo is not missing', () => {
    const root = create({ logoMissing: false, logoUrl: 'https://cdn.example/logo.png' });

    expect(root.querySelector('[data-testid="mentorship-program-card-hint"]')).toBeNull();
    expect(root.querySelector('[data-testid="mentorship-program-card-add-logo"]')).toBeNull();
    expect(root.querySelector('[data-testid="mentorship-program-card-logo-input"]')).toBeNull();
  });

  it('shows "Logo missing" and "Add logo" when the logo is missing', () => {
    const root = create();

    expect(root.querySelector('[data-testid="mentorship-program-card-hint"]')?.textContent?.trim()).toBe(MENTORSHIP_PROGRAM_CARD_LOGO_MISSING);
    expect((root.querySelector('[data-testid="mentorship-program-card-add-logo"]') as HTMLElement & { label?: string }).label).toBe(
      MENTORSHIP_PROGRAM_CARD_ADD_LOGO
    );
    expect(root.querySelector('[data-testid="mentorship-program-card-logo-input"]')).not.toBeNull();
  });

  it("keeps the button outside the card's clickable row, so it never opens the program", () => {
    const root = create();
    const cardClicks = vi.fn();
    fixture.componentInstance.cardClick.subscribe(cardClicks);
    const finish = root.querySelector('[data-testid="mentorship-program-card-add-logo"]') as HTMLElement;

    finish.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    finish.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(finish.closest('[role="button"]')).toBeNull();
    expect(cardClicks).not.toHaveBeenCalled();
  });

  it('opens the file picker, but not while an upload runs', () => {
    const root = create();
    const input = root.querySelector('[data-testid="mentorship-program-card-logo-input"]') as HTMLInputElement;
    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => undefined);

    internals().onAddLogo(input);
    (fixture.componentInstance as unknown as { busy: { set: (value: boolean) => void } }).busy.set(true);
    internals().onAddLogo(input);

    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it('uploads the logo without the 403 back-off, toasts "Logo added." and emits changed', () => {
    create();
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    pick(png());

    expect(uploadProgramLogo).toHaveBeenCalledTimes(1);
    expect(uploadProgramLogo).toHaveBeenCalledWith('prog_1', expect.any(File), false);
    expect(lastToastDetail()).toBe(MENTORSHIP_PROGRAM_CARD_LOGO_ADDED);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('lets an upload finish after the card is destroyed: it still toasts, but emits nothing', () => {
    const response = new Subject<{ logoUrl: string }>();
    uploadProgramLogo.mockReturnValue(response);
    create();
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    pick(png());
    fixture.destroy();
    expect(response.observed).toBe(true);
    response.next({ logoUrl: 'https://cdn.example/logo.png' });

    expect(lastToastDetail()).toBe(MENTORSHIP_PROGRAM_CARD_LOGO_ADDED);
    expect(changed).not.toHaveBeenCalled();
  });

  it('refuses a file of the wrong type without uploading', () => {
    create();

    pick(new File(['x'], 'logo.gif', { type: 'image/gif' }));

    expect(uploadProgramLogo).not.toHaveBeenCalled();
    expect(lastToastDetail()).toBe(MENTORSHIP_ENROLL_LOGO_TYPE_ERROR);
  });

  it.each([
    [503, undefined, MENTORSHIP_ENROLL_UPLOADS_UNAVAILABLE],
    [413, undefined, MENTORSHIP_ENROLL_LOGO_TOO_LARGE],
    [415, undefined, MENTORSHIP_ENROLL_LOGO_TYPE_ERROR],
    [400, undefined, MENTORSHIP_ENROLL_LOGO_TYPE_ERROR],
    [403, undefined, MENTORSHIP_PROGRAM_CARD_LOGO_FORBIDDEN],
    [403, { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE, message: 'Read-only while impersonating.' }, 'Read-only while impersonating.'],
    [500, undefined, MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED],
  ])('toasts the message for an upload %s and leaves the card unchanged', (status, error, expected) => {
    uploadProgramLogo.mockReturnValue(throwError(() => new HttpErrorResponse({ status, error })));
    const root = create();
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    pick(png());
    fixture.detectChanges();

    expect(lastToastDetail()).toBe(expected);
    expect(changed).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid="mentorship-program-card-hint"]')).not.toBeNull();
  });
});
