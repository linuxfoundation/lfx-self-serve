// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Formation, Project } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
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

  /** Only the "who else" DOM-rendering test below needs the `ComponentFixture` — every other test
   *  in this file only drives the component class, via the `createComponent` wrapper below. */
  const createComponentWithFixture = async (
    queryParams: Record<string, string> = {}
  ): Promise<{ component: ProposeComponent; fixture: ComponentFixture<ProposeComponent> }> => {
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
    return { component: fixture.componentInstance, fixture };
  };

  const createComponent = async (queryParams: Record<string, string> = {}): Promise<ProposeComponent> =>
    (await createComponentWithFixture(queryParams)).component;

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

  it('does not let a slow ?parent= prefill overwrite a parent the user already picked by hand', async () => {
    const prefillProject = { uid: 'parent-uid-1', slug: 'my-foundation', name: 'My Foundation' } as Project;
    const prefill$ = new Subject<Project>();
    getProject.mockReturnValue(prefill$);

    const component = await createComponent({ parent: 'my-foundation' });
    // Simulate the user picking a different parent via the picker (setValue + markAsDirty, same
    // as ProjectPickerComponent.select()) before the slow ?parent= lookup resolves.
    const control = component.form.get('parent_project_uid');
    control?.setValue('user-picked-uid');
    control?.markAsDirty();
    prefill$.next(prefillProject);

    expect(component.form.get('parent_project_uid')?.value).toBe('user-picked-uid');
  });

  it('does not let a slow ?parent= prefill reinstate a parent the user explicitly cleared', async () => {
    const prefillProject = { uid: 'parent-uid-1', slug: 'my-foundation', name: 'My Foundation' } as Project;
    const prefill$ = new Subject<Project>();
    getProject.mockReturnValue(prefill$);

    const component = await createComponent({ parent: 'my-foundation' });
    // Simulate the user clicking "Change" on an already-prefilled picker (ProjectPickerComponent.clear():
    // setValue(null) + markAsDirty) before this (now-redundant) lookup resolves.
    const control = component.form.get('parent_project_uid');
    control?.setValue(null);
    control?.markAsDirty();
    prefill$.next(prefillProject);

    expect(component.form.get('parent_project_uid')?.value).toBeNull();
  });

  // `initDuplicateNameMatch`'s `startWith('')` fires (harmlessly, trimmed.length<3) at construction,
  // under real timers, scheduling a real 400ms debounce timer independent of the fake clock these
  // tests install afterward. Draining it with a real wait before switching to fake timers keeps
  // that stray timer from firing mid-assertion and clobbering the signal back to null.
  const settleConstructionDebounce = () => new Promise((resolve) => setTimeout(resolve, 450));

  it('reports no duplicate when the search returns no results', async () => {
    const component = await createComponent();
    const protectedAccess = component as any;
    await settleConstructionDebounce();

    vi.useFakeTimers();
    try {
      searchProjects.mockReturnValueOnce(of([]));
      component.form.get('project_name')?.setValue('Example Proj');
      await vi.advanceTimersByTimeAsync(400);
      expect(searchProjects).toHaveBeenCalledWith('Example Proj');
      expect(protectedAccess.duplicateNameMatch()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a matching existing project name', async () => {
    const component = await createComponent();
    const protectedAccess = component as any;
    await settleConstructionDebounce();

    vi.useFakeTimers();
    try {
      searchProjects.mockReturnValueOnce(of([{ uid: 'x', name: 'Existing Project' } as Project]));
      component.form.get('project_name')?.setValue('Existing Project');
      await vi.advanceTimersByTimeAsync(400);
      expect(protectedAccess.duplicateNameMatch()).toBe('Existing Project');
    } finally {
      vi.useRealTimers();
    }
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

  it('rejects a whitespace-only "who else" name — trimmedRequired, not Validators.required, so it cannot pass as non-empty', async () => {
    const component = await createComponent();

    component.newContactForm.setValue({ first_name: '   ', last_name: 'Lee', email: 'sam@example.test' });
    component.addContact();

    expect(component.additionalContacts()).toEqual([]);
    expect(component.newContactForm.get('first_name')?.errors?.['trimmedRequired']).toBe(true);
  });

  it("rejects a dotless-domain email that Angular's own Validators.email would accept, matching the server's stricter check", async () => {
    const component = await createComponent();

    component.newContactForm.setValue({ first_name: 'Sam', last_name: 'Lee', email: 'sam@localhost' });
    component.addContact();

    expect(component.additionalContacts()).toEqual([]);
    expect(component.newContactForm.get('email')?.errors?.['email']).toBe(true);
  });

  it('only shows the "who else" incomplete error after a real Add attempt, not merely blurring the fields', async () => {
    const { component, fixture } = await createComponentWithFixture();
    const applicationRef = TestBed.inject(ApplicationRef);
    const errorEl = (): Element | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="propose-new-contact-incomplete"]');

    component.newContactForm.get('first_name')?.markAsTouched();
    await applicationRef.whenStable();

    expect(errorEl()).toBeNull();

    component.addContact();
    await applicationRef.whenStable();

    expect(errorEl()).not.toBeNull();
  });
});
