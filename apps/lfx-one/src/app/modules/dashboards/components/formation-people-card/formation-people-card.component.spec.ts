// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LF_STAFF_EMAIL_DOMAIN } from '@lfx-one/shared/constants';
import { Formation, FormationChecklistResponse, FormationItem, FormationPeopleResponse, FormationPerson } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationPeopleCardComponent } from './formation-people-card.component';

describe('FormationPeopleCardComponent', () => {
  let fixture: ComponentFixture<FormationPeopleCardComponent>;
  let getFormationPeople: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  /** Stands in for the dialog's own close stream so each test drives the result it needs. */
  let onClose: Subject<unknown>;

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

  /** Only the slug, the writer flag and the items' owners matter — the card reads nothing else off the checklist. */
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
    onClose = new Subject<unknown>();
    open = vi.fn(() => ({ onClose }));
  });

  async function render(people$?: Observable<FormationPeopleResponse>, response: FormationChecklistResponse = checklist()): Promise<void> {
    if (people$) {
      getFormationPeople.mockReturnValue(people$);
    }

    await TestBed.configureTestingModule({
      imports: [FormationPeopleCardComponent],
      providers: [{ provide: FormationService, useValue: { getFormationPeople } }],
    })
      // The card provides its own DialogService (component-scoped, like the checklist section);
      // override at the component level so the mock wins over that provider.
      .overrideComponent(FormationPeopleCardComponent, { set: { providers: [{ provide: DialogService, useValue: { open } }] } })
      .compileComponents();

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

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
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
    it('hides the Invite action from readers', async () => {
      await render();

      expect(byTestId('formation-people-invite-btn')).toBeNull();
    });

    it('hides the Invite action from a writer until the list has loaded', async () => {
      await render(new Subject<FormationPeopleResponse>(), checklist({ can_write: true }));

      expect(byTestId('formation-people-invite-btn')).toBeNull();
    });

    it('hides the Invite action from a writer while the list is unavailable', async () => {
      await render(of<FormationPeopleResponse>({ state: 'unavailable', people: [] }), checklist({ can_write: true }));

      expect(byTestId('formation-people-invite-btn')).toBeNull();
    });

    it('opens the invite dialog for a writer with the project uid and the listed addresses', async () => {
      await render(undefined, checklist({ can_write: true }));

      (byTestId('formation-people-invite-btn') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(open).toHaveBeenCalledTimes(1);
      const [, config] = open.mock.calls[0];
      expect(config).toEqual(
        expect.objectContaining({ modal: true, closable: false, dismissableMask: false, closeOnEscape: false, style: { maxWidth: '90vw' } })
      );
      expect(config.data).toEqual({
        projectUid: 'proj-1',
        existingEmails: [`alex.rivera@${LF_STAFF_EMAIL_DOMAIN}`, 'sam.chen@cascade-data.example', 'jordan.lee@partner-corp.example'],
      });
    });

    it('hides the Invite action while the list re-reads after an invite, so a stale duplicate list is never used', async () => {
      const reread = new Subject<FormationPeopleResponse>();
      getFormationPeople.mockReturnValueOnce(of<FormationPeopleResponse>({ state: 'loaded', people: [staff] })).mockReturnValue(reread.asObservable());
      await render(undefined, checklist({ can_write: true }));
      expect(byTestId('formation-people-invite-btn')).not.toBeNull();

      (byTestId('formation-people-invite-btn') as HTMLButtonElement).click();
      onClose.next('added');
      await settle();
      expect(byTestId('formation-people-invite-btn')).toBeNull();

      reread.next({ state: 'loaded', people: [staff, person()] });
      await settle();
      expect(byTestId('formation-people-invite-btn')).not.toBeNull();
    });

    it('leaves an email-less settings entry out of the addresses handed to the dialog', async () => {
      await render(
        of<FormationPeopleResponse>({ state: 'loaded', people: [person({ key: 'no.email', username: 'no.email', email: '' }), staff] }),
        checklist({ can_write: true })
      );

      (byTestId('formation-people-invite-btn') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(open.mock.calls[0][1].data.existingEmails).toEqual([`alex.rivera@${LF_STAFF_EMAIL_DOMAIN}`]);
    });

    it('re-reads the list when the dialog closes with an outcome, and not on a plain dismiss', async () => {
      await render(undefined, checklist({ can_write: true }));
      getFormationPeople.mockClear();

      (byTestId('formation-people-invite-btn') as HTMLButtonElement).click();
      onClose.next(undefined);
      await settle();
      expect(getFormationPeople).not.toHaveBeenCalled();

      (byTestId('formation-people-invite-btn') as HTMLButtonElement).click();
      onClose.next('invite_sent');
      await settle();
      expect(getFormationPeople).toHaveBeenCalledTimes(1);
    });
  });
});
