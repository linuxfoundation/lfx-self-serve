// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Formation, FormationChecklistResponse, FormationPeopleResponse, FormationPerson } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationPeopleCardComponent } from './formation-people-card.component';

describe('FormationPeopleCardComponent', () => {
  let fixture: ComponentFixture<FormationPeopleCardComponent>;
  let getFormationPeople: ReturnType<typeof vi.fn>;

  const person = (overrides: Partial<FormationPerson> = {}): FormationPerson => ({
    key: 'sam.chen',
    username: 'sam.chen',
    name: 'Sam Chen',
    email: 'sam.chen@cascade-data.example',
    role: 'view',
    group: 'invited',
    is_pending: false,
    job_title: 'Partner contact',
    organization: 'Cascade Data',
    avatar: null,
    assigned_item_count: 1,
    ...overrides,
  });

  const staff = person({
    key: 'alex.rivera',
    username: 'alex.rivera',
    name: 'Alex Rivera',
    email: 'alex.rivera@linuxfoundation.org',
    role: 'manage',
    group: 'staff',
    job_title: 'Program Manager',
    organization: null,
  });
  const pending = person({
    key: 'jordan.lee@partner-corp.example',
    username: null,
    name: 'Jordan Lee',
    email: 'jordan.lee@partner-corp.example',
    is_pending: true,
    job_title: null,
    organization: null,
    assigned_item_count: 0,
  });

  /** Only the slug and writer flag matter — the card reads nothing else off the checklist. */
  function checklist(overrides: Partial<FormationChecklistResponse> = {}): FormationChecklistResponse {
    return {
      formation: { parent_project_uid: 'proj-1', parent_project_slug: 'cascade-data-alliance' } as Formation,
      template: null,
      items: [],
      can_write: false,
      can_set_status: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    getFormationPeople = vi.fn(() => of<FormationPeopleResponse>({ state: 'loaded', people: [staff, person(), pending] }));
  });

  async function render(people$?: Observable<FormationPeopleResponse>, response: FormationChecklistResponse = checklist()): Promise<void> {
    if (people$) {
      getFormationPeople.mockReturnValue(people$);
    }

    await TestBed.configureTestingModule({
      imports: [FormationPeopleCardComponent],
      providers: [{ provide: FormationService, useValue: { getFormationPeople } }],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationPeopleCardComponent);
    // Set before the first change detection: `toObservable(this.projectSlug)` reads the required
    // input in an effect, which throws NG0950 if the input is still unset when it first runs.
    fixture.componentRef.setInput('checklist', response);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function byTestId(id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  it('fetches the list for the checklist’s own slug, never a context-derived one', async () => {
    await render();

    expect(getFormationPeople).toHaveBeenCalledWith('cascade-data-alliance');
  });

  it('shows skeleton rows until the read resolves', async () => {
    await render(new Subject<FormationPeopleResponse>());

    expect(byTestId('formation-people-loading')).not.toBeNull();
    expect(byTestId('formation-people-group-staff')).toBeNull();
  });

  it('groups LF staff apart from invited people and keeps the group order staff-first', async () => {
    await render();

    const groups = [...fixture.nativeElement.querySelectorAll('[data-testid^="formation-people-group-"]')] as HTMLElement[];
    expect(groups.map((el) => el.dataset['testid'])).toEqual(['formation-people-group-staff', 'formation-people-group-invited']);
    expect(byTestId('formation-people-group-staff')?.querySelector('[data-testid="formation-people-row-alex.rivera"]')).not.toBeNull();
    expect(byTestId('formation-people-group-invited')?.querySelector('[data-testid="formation-people-row-sam.chen"]')).not.toBeNull();
    expect(byTestId('formation-people-group-invited')?.querySelector('[data-testid="formation-people-row-jordan.lee@partner-corp.example"]')).not.toBeNull();
  });

  it('labels an accepted external as Invited, a pending one as Invite Sent, and staff with no chip', async () => {
    await render();

    expect(byTestId('formation-people-status-sam.chen')?.textContent?.trim()).toBe('Invited');
    expect(byTestId('formation-people-status-jordan.lee@partner-corp.example')?.textContent?.trim()).toBe('Invite Sent');
    expect(byTestId('formation-people-status-alex.rivera')).toBeNull();
  });

  it('renders title · organization · item count, falling back to the email for a pending invitee', async () => {
    await render();

    expect(byTestId('formation-people-row-sam.chen')?.textContent).toContain('Partner contact · Cascade Data · 1 item');
    expect(byTestId('formation-people-row-alex.rivera')?.textContent).toContain('Program Manager · 1 item');
    expect(byTestId('formation-people-row-jordan.lee@partner-corp.example')?.textContent).toContain('jordan.lee@partner-corp.example');
  });

  it('omits an empty group rather than rendering its heading', async () => {
    await render(of<FormationPeopleResponse>({ state: 'loaded', people: [staff] }));

    expect(byTestId('formation-people-group-staff')).not.toBeNull();
    expect(byTestId('formation-people-group-invited')).toBeNull();
  });

  it('shows the empty state when the settings hold no one', async () => {
    await render(of<FormationPeopleResponse>({ state: 'loaded', people: [] }));

    expect(byTestId('formation-people-empty')).not.toBeNull();
    expect(byTestId('formation-people-unavailable')).toBeNull();
  });

  it('shows the unavailable state when the BFF could not read settings for this caller', async () => {
    await render(of<FormationPeopleResponse>({ state: 'unavailable', people: [] }));

    expect(byTestId('formation-people-unavailable')).not.toBeNull();
    expect(byTestId('formation-people-empty')).toBeNull();
  });

  it('always renders the footer note about display labels versus grants', async () => {
    await render();

    expect(byTestId('formation-people-footer')?.textContent).toContain('access comes from grants');
  });
});
