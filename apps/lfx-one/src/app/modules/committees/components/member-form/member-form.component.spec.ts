// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { CommitteeService } from '@services/committee.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemberFormComponent } from './member-form.component';

/** Builds the form in wizard mode. Without custom dialog data it starts with a valid name and email. */
function setup(data?: Record<string, unknown>) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DynamicDialogConfig, useValue: { data: data ?? { wizardMode: true } } },
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: CommitteeService, useValue: {} },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  });
  const component = TestBed.runInInjectionContext(() => new MemberFormComponent());
  if (!data) {
    component.form().patchValue({ email: 'first.last@example.com', first_name: 'First', last_name: 'Last' });
  }
  return { component, close };
}

describe('MemberFormComponent required names', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each(['first_name', 'last_name'])('rejects whitespace-only %s rather than staging an invalid member', (field) => {
    const { component, close } = setup();
    component.form().get(field)!.setValue(' \t\u00a0');
    component.onSubmit();
    expect(component.form().get(field)!.invalid).toBe(true);
    expect(component.form().get(field)!.touched).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('trims names before returning a staged member', () => {
    const { component, close } = setup();
    component.form().patchValue({ first_name: ' First ', last_name: ' Last ' });
    component.onSubmit();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'First', last_name: 'Last', email: 'first.last@example.com' }));
  });
});

describe('MemberFormComponent prefill', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts an add with the prefilled email and names', () => {
    const { component } = setup({ wizardMode: true, prefill: { email: 'self@example.com', first_name: 'Self', last_name: 'User' } });
    expect(component.form().value).toEqual(expect.objectContaining({ email: 'self@example.com', first_name: 'Self', last_name: 'User' }));
  });

  it('keeps existing member details instead of the prefill when editing', () => {
    const { component } = setup({
      isEditing: true,
      wizardMode: true,
      member: { email: 'member@example.com', first_name: 'Existing', last_name: 'Member' },
      prefill: { email: 'self@example.com', first_name: 'Self', last_name: 'User' },
    });
    expect(component.form().value).toEqual(expect.objectContaining({ email: 'member@example.com', first_name: 'Existing', last_name: 'Member' }));
  });
});
