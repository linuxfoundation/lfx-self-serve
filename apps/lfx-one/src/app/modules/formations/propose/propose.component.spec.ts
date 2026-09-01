// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Formation, Project } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProposeComponent } from './propose.component';

/**
 * No `fixture.detectChanges()` call — same intent as `committee-manage.component.spec.ts`'s
 * harness (exercise the component class, not the rendered template). Unlike that spec, Angular's
 * zoneless `ApplicationRef.whenStable()` here still runs an implicit change-detection pass that
 * renders the template (this component has no step/`@if` gate keeping org-search out of the
 * initial render), which is why `provideHttpClient`/`provideHttpClientTesting` below are needed —
 * `lfx-organization-search`'s real `OrganizationService` otherwise has no `HttpClient` to inject.
 */
describe('ProposeComponent', () => {
  let createFormation: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let searchProjects: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const createComponent = async (queryParams: Record<string, string> = {}) => {
    await TestBed.configureTestingModule({
      imports: [ProposeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FormationService, useValue: { createFormation } },
        { provide: ProjectService, useValue: { getProject, searchProjects } },
        { provide: Router, useValue: { navigate } },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProposeComponent);
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture.componentInstance;
  };

  const validPayload = {
    project_name: 'Example Project',
    trademark_status: 'not_filed',
    contributing_org_name: 'Example Org',
    contributing_org_id: null,
    contributing_org_website_url: '',
    license: 'MIT',
    chat_platform: 'slack',
    mission_statement: 'Our mission statement.',
    agreement_type: 'dco',
    is_spec_project: false,
    description: 'A description of the project.',
    website_url: '',
  };

  const fillRequiredFields = (component: ProposeComponent): void => {
    component.form.patchValue(validPayload);
    component.form.get('legal_contact')?.patchValue({ first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' });
  };

  beforeEach(() => {
    createFormation = vi.fn();
    getProject = vi.fn().mockReturnValue(of(null));
    searchProjects = vi.fn().mockReturnValue(of([]));
    navigate = vi.fn();
    messageAdd = vi.fn();
  });

  it('starts invalid and does not submit — marks the form touched so inline errors surface', async () => {
    const component = await createComponent();

    component.onSubmit();

    expect(createFormation).not.toHaveBeenCalled();
    expect(component.form.get('project_name')?.touched).toBe(true);
  });

  it('creates the formation and navigates to the confirmation route on a valid submit', async () => {
    const component = await createComponent();
    fillRequiredFields(component);
    const formation = { uid: 'formation-1' } as Formation;
    createFormation.mockReturnValue(of(formation));

    component.onSubmit();

    expect(createFormation).toHaveBeenCalledWith(
      expect.objectContaining({
        project_name: 'Example Project',
        legal_contact: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' },
        additional_contacts: [],
        parent_project_uid: null,
      })
    );
    // The formation travels via router state (not just the uid in the URL) — the fixture store is
    // per-pod, so the confirmation page's own GET-by-uid isn't guaranteed to see this POST.
    expect(navigate).toHaveBeenCalledWith(['/propose/confirmation', 'formation-1'], { state: { formation } });
    expect(component.submitting()).toBe(false);
  });

  it('shows an error toast and does not navigate when submission fails', async () => {
    const component = await createComponent();
    fillRequiredFields(component);
    createFormation.mockReturnValue(throwError(() => ({ status: 500, error: {} })));

    component.onSubmit();

    expect(navigate).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(component.submitting()).toBe(false);
  });

  it('prefills the parent project from a ?parent= query param (the "Add a project" entry point)', async () => {
    const project = { uid: 'parent-uid-1', slug: 'my-foundation', name: 'My Foundation' } as Project;
    getProject.mockReturnValue(of(project));

    const component = await createComponent({ parent: 'my-foundation' });

    expect(getProject).toHaveBeenCalledWith('my-foundation', false);
    expect(component.form.get('parent_project_uid')?.value).toBe('parent-uid-1');
  });

  it('adds and removes an additional ("who else") contact', async () => {
    const component = await createComponent();

    component.newContactForm.setValue({ first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test' });
    component.addContact();

    expect(component.additionalContacts()).toEqual([{ first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test' }]);

    component.removeContact(0);

    expect(component.additionalContacts()).toEqual([]);
  });

  it('rejects a duplicate email in "who else" — @for tracks by email, so a duplicate would break the track key', async () => {
    const component = await createComponent();
    component.newContactForm.setValue({ first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test' });
    component.addContact();

    component.newContactForm.setValue({ first_name: 'Sam', last_name: 'Again', email: 'SAM@example.test' });
    component.addContact();

    expect(component.additionalContacts()).toHaveLength(1);
    expect(component.newContactForm.get('email')?.errors?.['duplicateEmail']).toBe(true);
  });

  it('rejects a "who else" contact sharing the legal contact\'s email', async () => {
    const component = await createComponent();
    component.form.get('legal_contact')?.patchValue({ first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' });

    component.newContactForm.setValue({ first_name: 'Someone', last_name: 'Else', email: 'jane@example.test' });
    component.addContact();

    expect(component.additionalContacts()).toEqual([]);
    expect(component.newContactForm.get('email')?.errors?.['duplicateEmail']).toBe(true);
  });
});
