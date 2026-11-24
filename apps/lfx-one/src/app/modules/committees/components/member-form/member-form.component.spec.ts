// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { CommitteeService } from '@services/committee.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemberFormComponent } from './member-form.component';

describe('MemberFormComponent required names', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: { wizardMode: true } } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: CommitteeService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new MemberFormComponent());
    component.form().patchValue({ email: 'first.last@example.com', first_name: 'First', last_name: 'Last' });
    return { component, close };
  }

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
