// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { MeetingRegistrantWithState, MeetingSelfGuest } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, NEVER } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../../meeting-composer-form.service';
import { ComposerGuestsRedesignComponent } from './composer-guests-redesign.component';

describe('ComposerGuestsRedesignComponent', () => {
  let fixture: ComponentFixture<ComposerGuestsRedesignComponent>;
  let formService: MeetingComposerFormService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let selfGuest$: BehaviorSubject<MeetingSelfGuest | null>;

  const SELF_GUEST: MeetingSelfGuest = {
    email: 'pat.doe@acme.example',
    first_name: 'Pat',
    last_name: 'Doe',
    job_title: null,
    org_name: 'Acme',
    username: 'pdoe',
    avatar_url: null,
    matchEmails: ['pat.doe@acme.example'],
  };

  const guest = (overrides: Partial<MeetingRegistrantWithState> = {}): MeetingRegistrantWithState => ({
    uid: 'registrant-1',
    meeting_id: 'meeting-1',
    occurrence_id: null,
    email: 'ada@acme.example',
    first_name: 'Ada',
    last_name: 'Byron',
    job_title: null,
    org_name: null,
    host: false,
    org_is_member: false,
    org_is_project_member: false,
    avatar_url: null,
    username: null,
    linkedin_profile: null,
    created_at: '',
    updated_at: '',
    type: 'direct',
    invite_accepted: null,
    attended: null,
    state: 'existing',
    ...overrides,
  });

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => el(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const click = (testId: string): void => {
    const target = el(testId);
    (target?.querySelector('button') ?? target)?.click();
  };
  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    dialogOpen = vi.fn().mockReturnValue({ onClose: NEVER });
    selfGuest$ = new BehaviorSubject<MeetingSelfGuest | null>(SELF_GUEST);
    TestBed.configureTestingModule({
      providers: [
        { provide: LiveAnnouncer, useValue: { announce: vi.fn().mockResolvedValue(undefined) } },
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: CommitteeService, useValue: {} },
        { provide: SearchService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => selfGuest$ } },
        { provide: MeetingInviteResendService, useValue: { canResend: () => true, isResending: () => false, confirmAndResend: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({ email: new FormControl(''), first_name: new FormControl(''), last_name: new FormControl('') }),
            stripMetadata: (meetingUid: string, registrant: MeetingRegistrantWithState) => ({ ...registrant, meeting_id: meetingUid }),
            getChangedFields: () => ({}),
          },
        },
      ],
    });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerGuestsRedesignComponent);
    fixture.componentRef.setInput('form', formService.form());
    await render();
  });

  it('shows the empty list with the search and manual entry', () => {
    expect(text('composer-guest-search-label')).toBe('Search and add guests');
    expect(text('composer-guests-count')).toBe('Invited people');
    expect(text('composer-guests-empty')).toContain('No guests yet');
    expect(el('composer-guests-filter')).toBeNull();
  });

  it('opens the manual guest dialog from Add manually', () => {
    click('composer-guest-manual-link');

    expect(dialogOpen).toHaveBeenCalledTimes(1);
  });

  it('counts invited people in the header', async () => {
    formService.setGuests([guest()]);
    await render();
    expect(text('composer-guests-count')).toBe('1 person invited');

    formService.setGuests([guest(), guest({ uid: 'registrant-2', email: 'grace@acme.example' })]);
    await render();
    expect(text('composer-guests-count')).toBe('2 people invited');
  });

  it('adds the signed-in user from Add me with a You badge, then hides the button', async () => {
    click('composer-guest-add-self');
    await render();

    const [row] = formService.guests();
    expect(el(`composer-guest-row-${row.tempId}`)?.querySelector('[data-testid="composer-guest-you"]')).not.toBeNull();
    expect(text(`composer-guest-subline-${row.tempId}`)).toBe('pat.doe@acme.example · LFX member · Acme');
    expect(el('composer-guest-add-self')).toBeNull();
  });

  it('marks a directory pick as an LFX member', async () => {
    const component = fixture.componentInstance;
    component['quickAddForm'].patchValue({ email: 'grace@acme.example', first_name: 'Grace', last_name: 'Hopper', username: 'ghopper' });
    component['onUserSelected']();
    await render();

    const [row] = formService.guests();
    expect(text(`composer-guest-subline-${row.tempId}`)).toBe('grace@acme.example · LFX member');
  });

  it('names the group a guest came through', async () => {
    formService.setGuests([guest({ type: 'committee', committee_name: 'TSC' })]);
    await render();

    expect(text('composer-guest-subline-registrant-1')).toBe('ada@acme.example · via TSC');
  });

  it('marks a guest as host from the row toggle', async () => {
    formService.setGuests([guest()]);
    await render();

    click('composer-guest-host-toggle-registrant-1');
    await render();

    expect(el('composer-guest-host-toggle-registrant-1')?.getAttribute('aria-pressed')).toBe('true');
    expect(el('composer-guest-host')).not.toBeNull();
  });

  it('removes a guest from the row', async () => {
    formService.setGuests([guest()]);
    await render();

    click('composer-guest-remove-registrant-1');
    await render();

    expect(el('composer-guest-row-registrant-1')).toBeNull();
    expect(formService.guests()[0].state).toBe('deleted');
  });

  it('hands focus to the next remove button, then to the guest search', async () => {
    formService.setGuests([guest(), guest({ uid: 'registrant-2', email: 'grace@acme.example' })]);
    await render();

    click('composer-guest-remove-registrant-1');
    await render();
    expect(document.activeElement).toBe(el('composer-guest-remove-registrant-2'));

    click('composer-guest-remove-registrant-2');
    await render();
    expect(document.activeElement?.id).toBe('composer-guest-search');
  });

  it('moves focus to the guest search when clearing the filter hides it', async () => {
    formService.setGuests([guest()]);
    fixture.componentInstance['onFilterChange']('ada');
    await render();
    expect(el('composer-guests-filter')).not.toBeNull();

    fixture.componentInstance['onFilterChange']('');
    await render();
    expect(el('composer-guests-filter')).toBeNull();
    expect(document.activeElement?.id).toBe('composer-guest-search');
  });

  it('offers a filter past six guests and says when nothing matches', async () => {
    formService.setGuests(Array.from({ length: 7 }, (_, index) => guest({ uid: `registrant-${index}`, email: `person${index}@acme.example` })));
    await render();
    expect(el('composer-guests-filter')).not.toBeNull();

    fixture.componentInstance['onFilterChange']('person3');
    await render();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="composer-guests-list"] li')).toHaveLength(1);

    fixture.componentInstance['onFilterChange']('nobody');
    await render();
    expect(text('composer-guests-filter-empty')).toBe('No guests match “nobody”.');
  });

  it('lets an edit undo a removal and offers to resend invites', async () => {
    formService.mode.set('edit');
    formService.meetingId.set('meeting-1');
    formService.setGuests([guest()]);
    await render();
    expect(el('composer-guest-resend-registrant-1')).not.toBeNull();

    click('composer-guest-remove-registrant-1');
    await render();
    expect(text('composer-guest-undo-message')).toBe('Ada Byron removed.');

    click('composer-guest-undo-button');
    await render();
    expect(el('composer-guest-undo')).toBeNull();
    expect(el('composer-guest-row-registrant-1')).not.toBeNull();
  });

  it('shows the load failure with a retry', async () => {
    const retry = vi.spyOn(formService, 'retryLoadGuests').mockImplementation(() => undefined);
    formService.guestsLoadFailed.set(true);
    await render();

    click('composer-guests-load-retry');

    expect(el('composer-guests-load-error')).not.toBeNull();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows groups and the attendees switch, locked with a note for board meetings', async () => {
    expect(el('composer-guests-groups')).not.toBeNull();
    expect(el('toggle-show_meeting_attendees')).not.toBeNull();
    expect(el('feature-note-show_meeting_attendees')).toBeNull();

    formService.form().get('meeting_type')?.setValue('Board');
    await render();

    expect(el('feature-note-show_meeting_attendees')).not.toBeNull();
  });

  it('scopes the section to the occurrence when editing one', async () => {
    formService.mode.set('edit');
    formService.occurrenceId.set('1700000000');
    formService.setGuests([guest()]);
    await render();

    expect(text('composer-guest-search-label')).toBe('Add guests to this occurrence');
    expect(text('composer-guest-subline-registrant-1')).toBe('ada@acme.example · Series guest');
    expect(el('composer-guest-remove-registrant-1')).toBeNull();
    expect(el('composer-guests-groups')).toBeNull();
    expect(el('toggle-show_meeting_attendees')).toBeNull();
  });
});
