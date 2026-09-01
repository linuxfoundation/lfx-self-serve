// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { Project, ProjectSettings } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { PersonaService } from '@services/persona.service';
import { ProjectService } from '@services/project.service';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { FormationCardComponent } from './formation-card.component';

function project(stage: string): Project {
  return {
    uid: 'proj-1',
    slug: 'project-one',
    description: '',
    name: 'Project One',
    public: true,
    parent_uid: '',
    stage,
    category: '',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: 'https://github.com/example/repo',
    website_url: '',
    created_at: '',
    updated_at: '',
    mailing_list_count: 0,
  } as Project;
}

function settings(): ProjectSettings {
  return {
    uid: 'proj-1',
    announcement_date: '2026-09-01',
    writers: [],
    auditors: [],
    executive_director: { name: 'Ada Lovelace', email: 'ada@example.com' },
    program_manager: null,
    opportunity_owner: null,
    created_at: '',
    updated_at: '',
  };
}

describe('FormationCardComponent', () => {
  let fixture: ComponentFixture<FormationCardComponent>;
  let isLFStaff: WritableSignal<boolean>;

  async function render(stage: string, staff: boolean, sfid: string | null = 'sfid-1'): Promise<void> {
    isLFStaff = signal(staff);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [FormationCardComponent],
      providers: [
        { provide: ProjectService, useValue: { getProject: () => of(project(stage)), getProjectSfid: () => of(sfid) } },
        { provide: PermissionsService, useValue: { getProjectSettings: () => of(settings()) } },
        { provide: PersonaService, useValue: { isLFStaff } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationCardComponent);
    fixture.componentRef.setInput('projectUid', 'proj-1');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it.each([
    ['Formation - Exploratory', 'Exploratory'],
    ['Formation - Engaged', 'Engaged'],
    ['Formation - On Hold', 'On Hold'],
    ['Formation - Disengaged', 'Disengaged'],
    ['Formation - Confidential', 'Confidential'],
  ])('renders the %s sub-stage as %s', async (stage, label) => {
    await render(stage, false);

    expect(text()).toContain(label);
  });

  it('never renders the literal string "PCC", staff or not', async () => {
    await render('Formation - Engaged', false);
    expect(text()).not.toContain('PCC');

    await render('Formation - Engaged', true);
    expect(text()).not.toContain('PCC');
  });

  it('hides the admin-tool links and "Staff only" chip for a non-staff user', async () => {
    await render('Formation - Engaged', false);

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
  });

  it('shows the admin-tool links and "Staff only" chip for an LF-staff user with a resolved SFID', async () => {
    await render('Formation - Engaged', true, 'sfid-1');

    const links = fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]');
    expect(links).not.toBeNull();
    expect(text()).toContain('Staff only');
    expect(text()).toContain('Edit stage in admin tool');
    expect(text()).toContain('Set up in admin tool');
  });

  it('hides the admin-tool links for an LF-staff user with no v1 mapping (null SFID)', async () => {
    await render('Formation - Engaged', true, null);

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
  });

  it('renders the intake repository link', async () => {
    await render('Formation - Engaged', false);

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-intake"]')).not.toBeNull();
    expect(text()).toContain('https://github.com/example/repo');
  });
});
