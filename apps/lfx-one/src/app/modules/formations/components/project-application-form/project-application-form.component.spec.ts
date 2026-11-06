// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import type { ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import type { AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectApplicationFormComponent } from './project-application-form.component';

interface FormAccess {
  form: ProjectApplicationFormComponent['form'];
  onSubmit: () => void;
}

const VALID = {
  project_name: 'Example Foundation',
  project_repository_url: 'https://github.com/example/example-project',
  contributing_organization: 'Example Organization',
  legal_contact_email: 'Legal@Example.org',
  license: 'Apache-2.0',
  mission_statement: 'The Mission of the Project is to build.',
  description: 'A short description.',
};

describe('ProjectApplicationFormComponent (#3037)', () => {
  let fixture: ComponentFixture<ProjectApplicationFormComponent>;
  let component: ProjectApplicationFormComponent;
  let emitted: ProjectApplicationAnswers[];

  const access = (): FormAccess => component as unknown as FormAccess;

  const render = async (initialAnswers: ProjectApplicationAnswers | null = null): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), MessageService],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectApplicationFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initialAnswers', initialAnswers);
    emitted = [];
    component.submitted.subscribe((answers) => emitted.push(answers));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await render();
  });

  it('refuses to submit until every required answer is present', () => {
    access().onSubmit();
    expect(emitted).toHaveLength(0);
    expect(access().form.controls.project_name.touched).toBe(true);
  });

  it('refuses an invalid repository URL and legal contact', () => {
    access().form.patchValue({ ...VALID, project_repository_url: 'ftp://example.org/repo', legal_contact_email: 'not-an-email' });
    access().onSubmit();
    expect(emitted).toHaveLength(0);
    expect(access().form.controls.project_repository_url.hasError('httpUrl')).toBe(true);
    expect(access().form.controls.legal_contact_email.hasError('email')).toBe(true);
  });

  it('refuses a contact list with an invalid email', () => {
    access().form.patchValue({ ...VALID, formation_list: 'ok@example.org, nope' });
    access().onSubmit();
    expect(emitted).toHaveLength(0);
    expect(access().form.controls.formation_list.hasError('emailList')).toBe(true);
  });

  it('emits trimmed canonical answers, parsing the contact list and dropping blanks', () => {
    access().form.patchValue({
      ...VALID,
      project_name: '  Example Foundation  ',
      project_website: '',
      formation_list: 'a@example.org\nB@example.org, a@example.org',
      is_spec_project: false,
      agreement_type: 'DCO',
    });
    access().onSubmit();
    expect(emitted).toEqual([
      {
        project_name: 'Example Foundation',
        project_repository_url: 'https://github.com/example/example-project',
        contributing_organization: 'Example Organization',
        legal_contact_email: 'legal@example.org',
        formation_list: ['a@example.org', 'b@example.org'],
        license: 'Apache-2.0',
        mission_statement: 'The Mission of the Project is to build.',
        agreement_type: 'DCO',
        is_spec_project: false,
        description: 'A short description.',
      },
    ]);
  });

  it('on revise, keeps answers it does not render and removes a canonical answer the user cleared', async () => {
    await render({ ...VALID, project_website: 'https://example.org', future_question: 'kept', parent_project_uid: 'p-1' });
    expect(access().form.controls.project_website.value).toBe('https://example.org');

    access().form.patchValue({ project_website: '' });
    access().onSubmit();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]['future_question']).toBe('kept');
    expect(emitted[0].parent_project_uid).toBe('p-1');
    expect('project_website' in emitted[0]).toBe(false);
  });

  it('does not emit while a submit is in flight', () => {
    fixture.componentRef.setInput('submitting', true);
    access().form.patchValue(VALID);
    access().onSubmit();
    expect(emitted).toHaveLength(0);
  });
});

const RESOLVE_URL = '/api/organizations/resolve';

describe('ProjectApplicationFormComponent organization and legal contact pickers (#5251)', () => {
  let fixture: ComponentFixture<ProjectApplicationFormComponent>;
  let component: ProjectApplicationFormComponent;
  let emitted: ProjectApplicationAnswers[];
  let http: HttpTestingController;

  const access = (): FormAccess => component as unknown as FormAccess;
  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (initialAnswers: ProjectApplicationAnswers | null = null): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), MessageService],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectApplicationFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initialAnswers', initialAnswers);
    emitted = [];
    component.submitted.subscribe((answers) => emitted.push(answers));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const orgInput = (): HTMLInputElement => {
    const el = root().querySelector('[data-testid="project-application-form-organization"] input');
    if (!el) throw new Error('organization input not rendered');
    return el as HTMLInputElement;
  };

  const legalSearchInput = (): HTMLInputElement | null => root().querySelector('[data-testid="project-application-form-legal-search"] input');
  const legalManualInput = (): HTMLInputElement | null => root().querySelector('input[data-test="project-application-form-legal"]');
  const click = async (testId: string): Promise<void> => {
    const el = root().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    if (!el) throw new Error(`${testId} not rendered`);
    el.click();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  describe('contributing organization', () => {
    beforeEach(async () => {
      await render();
    });

    it('renders the organization search instead of a plain text input', () => {
      expect(root().querySelector('lfx-organization-search')).not.toBeNull();
    });

    it('stores the picked name as a string and never calls /resolve', async () => {
      const search = fixture.debugElement.query(By.css('lfx-organization-search')).componentInstance;
      search.onOrganizationSelected({ value: { name: 'Acme Motors', domain: 'acme-motors.example' } } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      expect(access().form.controls.contributing_organization.value).toBe('Acme Motors');
      http.expectNone(RESOLVE_URL);
    });

    it('stores a CDP-matched pick (with an id) as a string and never calls /resolve', async () => {
      const search = fixture.debugElement.query(By.css('lfx-organization-search')).componentInstance;
      search.onOrganizationSelected({ value: { name: 'Vendor Corp', domain: '', id: 'cdp-1' } } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      expect(access().form.controls.contributing_organization.value).toBe('Vendor Corp');
      http.expectNone(RESOLVE_URL);
    });

    it('keeps typed-only text on blur and submits it as typed, with no /resolve request', async () => {
      orgInput().value = 'Acme Motors Ltd';
      orgInput().dispatchEvent(new Event('input'));
      orgInput().dispatchEvent(new Event('blur'));
      await fixture.whenStable();
      expect(access().form.controls.contributing_organization.value).toBe('Acme Motors Ltd');

      access().form.patchValue({ ...VALID, contributing_organization: 'Acme Motors Ltd' });
      access().onSubmit();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].contributing_organization).toBe('Acme Motors Ltd');
      http.expectNone(RESOLVE_URL);
    });

    it('still reports the organization as required when nothing was entered', () => {
      access().form.patchValue({ ...VALID, contributing_organization: '' });
      access().onSubmit();
      expect(emitted).toHaveLength(0);
      expect(access().form.controls.contributing_organization.hasError('required')).toBe(true);
    });
  });

  describe('contributing organization on revise', () => {
    it('shows the stored value, makes no /resolve request, and an unchanged save sends the same strings', async () => {
      const stored: ProjectApplicationAnswers = { ...VALID, legal_contact_email: 'legal@example.org' };
      await render(stored);

      expect(orgInput().value).toBe('Example Organization');
      http.expectNone(RESOLVE_URL);

      access().onSubmit();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].contributing_organization).toBe('Example Organization');
      expect(emitted[0].legal_contact_email).toBe('legal@example.org');
      http.expectNone(RESOLVE_URL);
    });
  });

  describe('legal contact', () => {
    beforeEach(async () => {
      await render();
    });

    it('opens on the directory search on create', () => {
      expect(legalSearchInput()).not.toBeNull();
      expect(legalManualInput()).toBeNull();
    });

    it('fills the email when a person is picked from the directory', async () => {
      const picker = fixture.debugElement.query(By.directive(UserSearchComponent)).componentInstance as UserSearchComponent;
      picker.onUserSelected({
        value: {
          uid: 'u-1',
          email: 'Pat.Counsel@vendor-corp.example',
          first_name: 'Pat',
          last_name: 'Counsel',
          job_title: null,
          organization: { name: 'Vendor Corp' },
        },
      } as unknown as AutoCompleteSelectEvent);
      await fixture.whenStable();

      expect(access().form.controls.legal_contact_email.value).toBe('Pat.Counsel@vendor-corp.example');
      access().form.patchValue({ ...VALID, legal_contact_email: access().form.controls.legal_contact_email.value });
      access().onSubmit();
      expect(emitted[0].legal_contact_email).toBe('pat.counsel@vendor-corp.example');
    });

    it('swaps to a plain email input on manual entry and accepts a non-LF address', async () => {
      await click('project-application-form-legal-manual-link');

      expect(legalSearchInput()).toBeNull();
      const input = legalManualInput();
      expect(input).not.toBeNull();
      expect(input?.getAttribute('autocomplete')).toBe('email');

      input!.value = 'counsel@acme-motors.example';
      input!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      access().form.patchValue({ ...VALID, legal_contact_email: 'counsel@acme-motors.example' });
      access().onSubmit();

      expect(emitted[0].legal_contact_email).toBe('counsel@acme-motors.example');
    });

    it('rejects an invalid manually typed email', async () => {
      await click('project-application-form-legal-manual-link');
      const input = legalManualInput()!;
      input.value = 'not-an-email';
      input.dispatchEvent(new Event('input'));
      access().form.controls.legal_contact_email.markAsTouched();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(access().form.controls.legal_contact_email.hasError('email')).toBe(true);
      expect(root().querySelector('[data-testid="project-application-form-legal-error"]')).not.toBeNull();
    });

    it('goes back to the directory search and clears the hand-typed address', async () => {
      await click('project-application-form-legal-manual-link');
      access().form.controls.legal_contact_email.setValue('counsel@acme-motors.example');

      await click('project-application-form-legal-search-link');

      expect(legalSearchInput()).not.toBeNull();
      expect(legalManualInput()).toBeNull();
      expect(access().form.controls.legal_contact_email.value).toBe('');
    });

    it('keeps a picked address when switching to manual entry so it can be edited', async () => {
      access().form.controls.legal_contact_email.setValue('pat@vendor-corp.example');
      await click('project-application-form-legal-manual-link');

      expect(legalManualInput()?.value).toBe('pat@vendor-corp.example');
    });
  });

  describe('legal contact on revise', () => {
    it('opens in the plain-input state showing the stored email, and an unchanged save sends it back', async () => {
      await render({ ...VALID, legal_contact_email: 'legal@example.org' });

      expect(legalSearchInput()).toBeNull();
      expect(legalManualInput()?.value).toBe('legal@example.org');

      access().onSubmit();
      expect(emitted[0].legal_contact_email).toBe('legal@example.org');
    });
  });
});

const WORK_EXPERIENCES_URL = '/api/profile/work-experiences';

describe('ProjectApplicationFormComponent organization prefill (#5251)', () => {
  let fixture: ComponentFixture<ProjectApplicationFormComponent>;
  let component: ProjectApplicationFormComponent;
  let http: HttpTestingController;
  let messages: MessageService;

  const access = (): FormAccess => component as unknown as FormAccess;
  const organization = (): string => access().form.controls.contributing_organization.value;
  const CURRENT = [{ organization: 'Acme Motors', organizationId: 'org-1', startDate: 'Jan 2020', endDate: null }];

  const render = async (initialAnswers: ProjectApplicationAnswers | null = null): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), MessageService],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    messages = TestBed.inject(MessageService);
    fixture = TestBed.createComponent(ProjectApplicationFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('initialAnswers', initialAnswers);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('prefills the empty organization with the current employer on create', async () => {
    await render();

    http.expectOne(WORK_EXPERIENCES_URL).flush(CURRENT);
    await fixture.whenStable();

    expect(organization()).toBe('Acme Motors');
    http.expectNone('/api/organizations/resolve');
  });

  it('asks once, not again when the form re-renders', async () => {
    await render();
    http.expectOne(WORK_EXPERIENCES_URL).flush(CURRENT);
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectNone(WORK_EXPERIENCES_URL);
  });

  it('does not overwrite text the user typed before the lookup returned', async () => {
    await render();
    access().form.controls.contributing_organization.setValue('Typed Org');

    http.expectOne(WORK_EXPERIENCES_URL).flush(CURRENT);
    await fixture.whenStable();

    expect(organization()).toBe('Typed Org');
  });

  it('leaves the field blank, and raises no toast, when the lookup fails', async () => {
    await render();
    const add = vi.spyOn(messages, 'add');

    http.expectOne(WORK_EXPERIENCES_URL).error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect(organization()).toBe('');
    expect(add).not.toHaveBeenCalled();
  });

  it('leaves the field blank when the person has no work history', async () => {
    await render();

    http.expectOne(WORK_EXPERIENCES_URL).flush([]);
    await fixture.whenStable();

    expect(organization()).toBe('');
  });

  it('never prefills, and makes no request, on revise', async () => {
    await render({ ...VALID, contributing_organization: 'Stored Org' });

    http.expectNone(WORK_EXPERIENCES_URL);
    expect(organization()).toBe('Stored Org');
  });

  it('never prefills a revise whose stored organization is empty', async () => {
    await render({ project_name: 'Example Foundation' });

    http.expectNone(WORK_EXPERIENCES_URL);
    expect(organization()).toBe('');
  });
});
