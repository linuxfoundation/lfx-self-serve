// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ERROR_CODES, LF_STAFF_EMAIL_DOMAIN } from '@lfx-one/shared/constants';
import {
  Formation,
  FormationChecklistResponse,
  FormationInviteFormValue,
  FormationItem,
  FormationPeopleResponse,
  FormationPerson,
} from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { PermissionsService } from '@services/permissions.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationPeopleCardComponent } from './formation-people-card.component';

describe('FormationPeopleCardComponent', () => {
  let fixture: ComponentFixture<FormationPeopleCardComponent>;
  let getFormationPeople: ReturnType<typeof vi.fn>;
  let addUserToProject: ReturnType<typeof vi.fn>;
  let invalidateProjectSettings: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;

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
    ...overrides,
  });

  // Built from the constant: check-fixture-emails.sh (GH-1674) denylists the LF domain itself in spec files.
  const staff = person({
    key: 'alex.rivera',
    username: 'alex.rivera',
    name: 'Alex Rivera',
    email: `alex.rivera@${LF_STAFF_EMAIL_DOMAIN}`,
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
  });

  /** Only the slug and the items' owners matter — the card reads nothing else off the checklist. */
  function checklist(overrides: Partial<FormationChecklistResponse> = {}): FormationChecklistResponse {
    return {
      formation: { parent_project_uid: 'proj-1', parent_project_slug: 'cascade-data-alliance' } as Formation,
      template: null,
      // One item each for the staff row and the accepted partner; none for the pending invitee.
      items: [
        { owner: { username: 'alex.rivera', name: 'Alex Rivera' } } as FormationItem,
        { owner: { username: 'sam.chen', name: 'sam.chen' } } as FormationItem,
      ],
      can_write: false,
      can_set_status: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    getFormationPeople = vi.fn(() => of<FormationPeopleResponse>({ state: 'loaded', people: [staff, person(), pending] }));
    addUserToProject = vi.fn(() => of(undefined));
    invalidateProjectSettings = vi.fn();
    toast = vi.fn();
  });

  async function render(people$?: Observable<FormationPeopleResponse>, response: FormationChecklistResponse = checklist()): Promise<void> {
    if (people$) {
      getFormationPeople.mockReturnValue(people$);
    }

    await TestBed.configureTestingModule({
      imports: [FormationPeopleCardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FormationService, useValue: { getFormationPeople } },
        { provide: PermissionsService, useValue: { addUserToProject, invalidateProjectSettings } },
        { provide: MessageService, useValue: { add: toast } },
      ],
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

  describe('invite (PR 2)', () => {
    const invite: FormationInviteFormValue = { name: 'Kim Park', email: 'kim.park@partner-corp.example', role: 'view' };
    const directoryMiss = () => new HttpErrorResponse({ status: 404, error: { code: ERROR_CODES.NOT_FOUND, error: 'User not found' } });

    /** `onInvite` is the dialog's `(submitted)` handler — protected, so specs drive it the way the template does. */
    async function submitInvite(value: FormationInviteFormValue = invite): Promise<void> {
      fixture.componentInstance.inviteVisible.set(true);
      (fixture.componentInstance as unknown as { onInvite(v: FormationInviteFormValue): void }).onInvite(value);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    it('hides the Invite action from readers', async () => {
      await render();

      expect(byTestId('formation-people-invite-btn')).toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-formation-invite-dialog')).toBeNull();
    });

    it('offers Invite to writers and opens the dialog', async () => {
      await render(undefined, checklist({ can_write: true }));

      const button = byTestId('formation-people-invite-btn') as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      button?.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.inviteVisible()).toBe(true);
    });

    it('adds an address with an LF account in one request, refreshes the list, evicts the settings cache, and toasts Added', async () => {
      await render(undefined, checklist({ can_write: true }));
      getFormationPeople.mockClear();

      await submitInvite();

      expect(addUserToProject).toHaveBeenCalledTimes(1);
      expect(addUserToProject).toHaveBeenCalledWith('proj-1', { email: invite.email, role: 'view' });
      expect(invalidateProjectSettings).toHaveBeenCalledWith('proj-1');
      expect(getFormationPeople).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.inviteVisible()).toBe(false);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Added', detail: expect.stringContaining('View access') }));
    });

    it('re-sends with the name on a directory miss — the manual add that makes upstream email the invite — and toasts Invite sent', async () => {
      addUserToProject.mockReturnValueOnce(throwError(directoryMiss)).mockReturnValueOnce(of(undefined));
      await render(undefined, checklist({ can_write: true }));

      await submitInvite({ ...invite, role: 'manage' });

      expect(addUserToProject).toHaveBeenCalledTimes(2);
      expect(addUserToProject).toHaveBeenNthCalledWith(1, 'proj-1', { email: invite.email, role: 'manage' });
      expect(addUserToProject).toHaveBeenNthCalledWith(2, 'proj-1', { name: 'Kim Park', email: invite.email, role: 'manage' });
      expect(fixture.componentInstance.inviteVisible()).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', summary: 'Invite sent', detail: expect.stringContaining('Manage access') })
      );
    });

    it('surfaces any other failure as an error toast and keeps the dialog open for a retry', async () => {
      addUserToProject.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));
      await render(undefined, checklist({ can_write: true }));

      await submitInvite();

      expect(addUserToProject).toHaveBeenCalledTimes(1);
      expect(invalidateProjectSettings).not.toHaveBeenCalled();
      expect(fixture.componentInstance.inviteVisible()).toBe(true);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Invite failed' }));
    });

    it('ignores a second submission while one is in flight', async () => {
      const pendingAdd = new Subject<void>();
      addUserToProject.mockReturnValue(pendingAdd.asObservable());
      await render(undefined, checklist({ can_write: true }));

      await submitInvite();
      await submitInvite();

      expect(addUserToProject).toHaveBeenCalledTimes(1);
    });
  });
});
