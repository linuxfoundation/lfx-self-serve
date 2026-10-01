// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

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
    await TestBed.configureTestingModule({ imports: [ProjectApplicationFormComponent] }).compileComponents();
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
