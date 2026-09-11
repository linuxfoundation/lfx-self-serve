// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { OrganizationService } from '@services/organization.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptInviteOrganizationDialogComponent } from './accept-invite-organization-dialog.component';

// Locks in the finish()-time completeness guard (GH-2349): the join/invite-accept submit path
// must not close with an organization that lacks a name or a parseable https website, even if
// the form-validator wiring above it were to regress. OrganizationService is mocked — the CDP
// resolve is not what these tests pin.
describe('AcceptInviteOrganizationDialogComponent', () => {
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  const createComponent = async () => {
    const fixture = TestBed.createComponent(AcceptInviteOrganizationDialogComponent);
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture;
  };

  beforeEach(() => {
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data: { committeeName: 'TSC', organization: null } } },
        {
          provide: OrganizationService,
          useValue: {
            searchOrganizations: vi.fn().mockReturnValue(of([])),
            resolveOrganization: vi.fn().mockReturnValue(of({ id: 'cdp-1', name: 'Acme Motors', logo: null })),
            registerSessionOrg: vi.fn(),
          },
        },
        provideNoopAnimations(),
      ],
    });
  });

  it('does not close when the website is empty, even with validator wiring bypassed', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;
    component.form.patchValue({ organization: 'Acme Motors', organization_url: '', organization_id: null });
    // Simulates a validator-wiring regression so the test pins finish()'s own guard rather
    // than the form.valid early-return — the guard is the belt-and-braces this ticket added.
    component.form.get('organization_url')!.clearValidators();
    component.form.get('organization_url')!.updateValueAndValidity();

    component.onConfirm();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.submitting()).toBe(false);
  });

  it('does not close when the website is not a valid https URL', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;
    component.form.patchValue({ organization: 'Acme Motors', organization_url: 'not-a-url', organization_id: null });
    component.form.get('organization_url')!.clearValidators();
    component.form.get('organization_url')!.updateValueAndValidity();

    component.onConfirm();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.submitting()).toBe(false);
  });

  it('does not close for a non-https website', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;
    component.form.patchValue({ organization: 'Acme Motors', organization_url: 'http://acme-motors.example', organization_id: null });

    component.onConfirm();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('closes with the built organization payload for a complete name + https website', async () => {
    const fixture = await createComponent();
    const component = fixture.componentInstance;
    component.form.patchValue({ organization: 'Acme Motors', organization_url: 'https://acme-motors.example', organization_id: null });
    await TestBed.inject(ApplicationRef).whenStable();

    component.onConfirm();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(dialogRef.close).toHaveBeenCalledWith({ organization: { id: null, name: 'Acme Motors', website: 'https://acme-motors.example' } });
  });

  it('cancel closes without a value', async () => {
    const fixture = await createComponent();

    fixture.componentInstance.onCancel();

    expect(dialogRef.close).toHaveBeenCalledWith(null);
  });
});
