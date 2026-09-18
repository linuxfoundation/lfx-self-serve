// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FormationInviteFormValue } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { FormationInviteDialogComponent } from './formation-invite-dialog.component';

describe('FormationInviteDialogComponent', () => {
  let fixture: ComponentFixture<FormationInviteDialogComponent>;
  let component: FormationInviteDialogComponent;
  let emitted: FormationInviteFormValue[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormationInviteDialogComponent], providers: [provideNoopAnimations()] }).compileComponents();

    fixture = TestBed.createComponent(FormationInviteDialogComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.submitted.subscribe((value) => emitted.push(value));
    fixture.componentRef.setInput('existingEmails', ['sam.chen@cascade-data.example']);
    fixture.detectChanges();
  });

  /** `onSubmit` is the form's ngSubmit handler — protected, so specs drive it the way the template does. */
  function submit(): void {
    (component as unknown as { onSubmit(): void }).onSubmit();
    fixture.detectChanges();
  }

  function errorId(field: 'name' | 'email'): string | undefined {
    return (component as unknown as { nameErrorId(): string | undefined; emailErrorId(): string | undefined })[`${field}ErrorId`]();
  }

  it('defaults the role to view', () => {
    expect(component.form.controls.role.value).toBe('view');
  });

  it('blocks an empty submission and surfaces both required errors', () => {
    submit();

    expect(emitted).toEqual([]);
    expect(errorId('name')).toBe('formation-invite-name-required');
    expect(errorId('email')).toBe('formation-invite-email-required');
  });

  it('rejects a malformed address', () => {
    component.form.setValue({ name: 'Jordan Lee', email: 'not-an-email', role: 'view' });
    submit();

    expect(emitted).toEqual([]);
    expect(errorId('email')).toBe('formation-invite-email-invalid');
  });

  it('flags an address already on the project as soon as it is typed, and never emits it', () => {
    component.form.controls.email.setValue('Sam.Chen@Cascade-Data.example');
    fixture.detectChanges();

    expect(errorId('email')).toBe('formation-invite-email-duplicate');

    component.form.controls.name.setValue('Sam Chen');
    submit();
    expect(emitted).toEqual([]);
  });

  it('emits a trimmed name and a lowercased email with the chosen role', () => {
    // No surrounding whitespace on the email: the pattern validator rejects it (an address is
    // never valid with spaces), so only the case is normalised on emit.
    component.form.setValue({ name: '  Jordan Lee ', email: 'Jordan.Lee@Partner-Corp.example', role: 'manage' });
    submit();

    expect(emitted).toEqual([{ name: 'Jordan Lee', email: 'jordan.lee@partner-corp.example', role: 'manage' }]);
  });

  it('ignores submit and cancel while a submission is in flight', () => {
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    component.form.setValue({ name: 'Jordan Lee', email: 'jordan.lee@partner-corp.example', role: 'view' });
    component.visible.set(true);

    submit();
    (component as unknown as { onCancel(): void }).onCancel();

    expect(emitted).toEqual([]);
    expect(component.visible()).toBe(true);
  });

  it('resets to an empty View form the moment it opens, not after the show animation', () => {
    component.form.setValue({ name: 'Jordan Lee', email: 'jordan.lee@partner-corp.example', role: 'manage' });
    component.visible.set(true);
    fixture.detectChanges();

    expect(component.form.getRawValue()).toEqual({ name: '', email: '', role: 'view' });
  });
});
