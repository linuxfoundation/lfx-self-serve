// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Formation } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { PersonaService } from '@services/persona.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProposeConfirmationComponent } from './propose-confirmation.component';

/**
 * The Epic 1 fallback path (GH-1962) is the real path, not a degraded mode — this spec exercises
 * it end to end: no linked project record ("Record not yet created") renders the staff-facing
 * note and admin-tool link, matching the acceptance criteria's "fallback path exercised in tests".
 */
function buildFormation(overrides: Partial<Formation> = {}): Formation {
  return {
    uid: 'formation-1',
    state: 'proposed' as Formation['state'],
    parent_project_uid: null,
    project_uid: null,
    template_version: 'project-formation-v1',
    submitted_by: 'proposer1',
    submitted_at: '2026-08-31T00:00:00.000Z',
    intake: {
      parent_project_uid: null,
      project_name: 'Example Project',
      project_repository_url: null,
      project_logo_filename: null,
      trademark_status: 'not_filed',
      contributing_org_name: 'Example Org',
      contributing_org_id: null,
      contributing_org_website_url: null,
      legal_contact: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' },
      additional_contacts: [],
      license: 'MIT',
      chat_platform: 'slack',
      mission_statement: 'Our mission.',
      agreement_type: 'dco',
      is_spec_project: false,
      description: 'A description.',
      website_url: null,
    },
    participant_granted: true,
    data_source: 'mock',
    ...overrides,
  };
}

describe('ProposeConfirmationComponent', () => {
  let fixture: ComponentFixture<ProposeConfirmationComponent>;
  let getFormationByUid: ReturnType<typeof vi.fn>;
  let getCurrentNavigation: ReturnType<typeof vi.fn>;
  let canViewExecutiveDashboards: ReturnType<typeof signal<boolean>>;
  let personaLoaded: ReturnType<typeof signal<boolean>>;

  async function setup(uid: string | null, options: { staff?: boolean; personaLoaded?: boolean } = {}): Promise<void> {
    canViewExecutiveDashboards.set(options.staff ?? true);
    personaLoaded.set(options.personaLoaded ?? true);

    await TestBed.configureTestingModule({
      imports: [ProposeConfirmationComponent],
      providers: [
        { provide: FormationService, useValue: { getFormationByUid } },
        { provide: Router, useValue: { getCurrentNavigation } },
        { provide: PersonaService, useValue: { canViewExecutiveDashboards, personaLoaded } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap(uid ? { formationUid: uid } : {})) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProposeConfirmationComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    getFormationByUid = vi.fn();
    // No in-flight navigation state by default — exercises the GET-by-uid fallback path.
    getCurrentNavigation = vi.fn().mockReturnValue(null);
    canViewExecutiveDashboards = signal(true);
    personaLoaded = signal(true);
  });

  it('renders the "Record not yet created" fallback state with a staff admin-tool link for a staff viewer', async () => {
    getFormationByUid.mockReturnValue(of(buildFormation({ project_uid: null })));

    await setup('formation-1', { staff: true });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="propose-confirmation-not-created"]')).toBeTruthy();
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="propose-confirmation-admin-link"]');
    expect(link).toBeTruthy();
    expect(link!.href).toContain('/project/new');
    expect(link!.href).toContain('formation_uid=formation-1');
    expect(link!.rel).toContain('noopener');
    expect(link!.rel).toContain('noreferrer');
  });

  it('hides the staff admin-tool link and framing from an ordinary proposer', async () => {
    getFormationByUid.mockReturnValue(of(buildFormation({ project_uid: null })));

    await setup('formation-1', { staff: false });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="propose-confirmation-not-created"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="propose-confirmation-admin-link"]')).toBeNull();
    expect(el.textContent).not.toContain('Staff only');
    expect(el.textContent).toContain('The formation team will follow up');
  });

  it('fails closed to the proposer-safe copy while persona data is still loading, even for a staff viewer', async () => {
    getFormationByUid.mockReturnValue(of(buildFormation({ project_uid: null })));

    await setup('formation-1', { staff: true, personaLoaded: false });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="propose-confirmation-admin-link"]')).toBeNull();
    expect(el.textContent).toContain('The formation team will follow up');
  });

  it('does not render the fallback note once a project record is linked', async () => {
    getFormationByUid.mockReturnValue(of(buildFormation({ project_uid: 'project-uid-1' })));

    await setup('formation-1');

    expect(fixture.nativeElement.querySelector('[data-testid="propose-confirmation-not-created"]')).toBeNull();
  });

  it('renders the "Proposed on {date}" banner', async () => {
    getFormationByUid.mockReturnValue(of(buildFormation()));

    await setup('formation-1');

    const banner = fixture.nativeElement.querySelector('[data-testid="propose-confirmation-banner"]');
    expect(banner?.textContent).toContain('Your submission was received.');
  });

  it('shows a not-found state when the formation cannot be resolved (e.g. a different pod, or after a server restart)', async () => {
    getFormationByUid.mockReturnValue(of(null));

    await setup('unknown-uid');

    expect(fixture.nativeElement.textContent).toContain("couldn't find that proposal");
  });

  it('reads the formation from router state (the primary path) without calling the fallback GET', async () => {
    const formation = buildFormation({ uid: 'from-state', project_uid: null });
    getCurrentNavigation.mockReturnValue({ extras: { state: { formation } } });

    await setup('from-state');

    expect(getFormationByUid).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="propose-confirmation-not-created"]')).toBeTruthy();
  });
});
