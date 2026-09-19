// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManualGuestDialogComponent } from './manual-guest-dialog.component';

/*
 * The dialog hands its form straight back to the Guests section, which adds the row exactly as
 * handed over. What the form reports at that moment is therefore the whole of what gets added.
 */
describe('ManualGuestDialogComponent — what the submit hands back', () => {
  let fixture: ComponentFixture<ManualGuestDialogComponent>;
  const close = vi.fn();

  function form(): FormGroup {
    return (fixture.componentInstance as unknown as { form: FormGroup }).form;
  }

  function submit(): void {
    fixture.nativeElement.querySelector('[data-testid="composer-guest-manual-submit"] button').click();
    fixture.detectChanges();
  }

  function create(): void {
    close.mockClear();

    TestBed.configureTestingModule({
      imports: [ManualGuestDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: {} } },
      ],
    });

    fixture = TestBed.createComponent(ManualGuestDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
    TestBed.resetTestingModule();
  });

  /**
   * The org-search field disables `org_name` for the length of a real `resolve` round-trip, and a
   * disabled control is omitted from `FormGroup.value`. `org_name` carries no validators, so the
   * submit button's `!form.valid` gate stays enabled right through that window: submitting there
   * would drop the organization the dialog is still displaying, with nothing said about it.
   */
  it('keeps an organization that is mid-resolve at the moment of submit', () => {
    create();
    form().patchValue({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@acme-motors.example',
      org_name: 'Acme Motors',
    });
    form().get('org_name')?.disable();
    fixture.detectChanges();

    expect(form().valid).toBe(true);
    submit();

    expect(close).toHaveBeenCalledWith({ guest: expect.objectContaining({ org_name: 'Acme Motors', email: 'ada@acme-motors.example' }) });
  });

  it('refuses an incomplete guest and marks the fields that are missing', () => {
    create();
    form().patchValue({ first_name: 'Ada' });

    (fixture.componentInstance as unknown as { onSubmit: () => void }).onSubmit();

    expect(close).not.toHaveBeenCalled();
    expect(form().get('email')?.touched).toBe(true);
  });
});
