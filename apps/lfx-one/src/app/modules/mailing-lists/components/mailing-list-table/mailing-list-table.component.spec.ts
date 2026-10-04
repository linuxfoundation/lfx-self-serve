// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { MailingListAudienceAccess } from '@lfx-one/shared/enums';
import type { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import type { Confirmation } from 'primeng/api';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import type { MockInstance } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import { MailingListTableComponent } from './mailing-list-table.component';

const baseList: GroupsIOMailingList = {
  uid: 'list-1',
  group_name: 'maintainers',
  public: true,
  source: 'api',
  type: 'discussion_open' as GroupsIOMailingList['type'],
  audience_access: MailingListAudienceAccess.PUBLIC,
  description: 'A test mailing list description long enough to pass validation.',
  title: 'Maintainers List',
  service_uid: 'service-1',
  project_uid: 'project-1',
  project_name: 'Test Project',
  project_slug: 'test-project',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  subscriber_count: 10,
};

describe('MailingListTableComponent — join/leave UI (PR #3211 review)', () => {
  let fixture: ComponentFixture<MailingListTableComponent>;
  let createMember: ReturnType<typeof vi.fn>;
  let deleteMember: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let confirm: MockInstance<(confirmation: Confirmation) => ConfirmationService>;

  const render = async (mailingLists: GroupsIOMailingList[], userEmail: string | null = 'me@example.com'): Promise<void> => {
    TestBed.resetTestingModule();
    createMember = vi.fn(() => of({}));
    deleteMember = vi.fn(() => of(undefined));
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MailingListTableComponent],
      providers: [
        provideRouter([]),
        { provide: MailingListService, useValue: { createMember, deleteMember } },
        { provide: UserService, useValue: { user: () => (userEmail ? { email: userEmail } : null) } },
        { provide: PersonaService, useValue: { currentPersona: () => 'contributor' } },
        ConfirmationService,
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    // Spy on the real ConfirmationService rather than mocking it outright — p-confirmDialog's
    // constructor subscribes to its requireConfirmation$/accept observables, which a plain object
    // mock doesn't provide and which crashes fixture.detectChanges() with a TypeError.
    confirm = vi.spyOn(TestBed.inject(ConfirmationService), 'confirm');

    fixture = TestBed.createComponent(MailingListTableComponent);
    fixture.componentRef.setInput('mailingLists', mailingLists);
    fixture.componentRef.setInput(
      'searchForm',
      new FormGroup({ search: new FormControl(''), committee: new FormControl(null), status: new FormControl(null) })
    );
    fixture.componentRef.setInput('committeeFilterOptions', []);
    fixture.componentRef.setInput('statusFilterOptions', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  describe('canJoin / mySubscriptionLabel', () => {
    it('marks a public list the user has not joined as joinable', async () => {
      await render([baseList]);

      expect(fixture.componentInstance['tableRows']()[0].canJoin).toBe(true);
    });

    it('does not mark a list the user already joined as joinable even if public', async () => {
      TestBed.resetTestingModule();
      await render([baseList]);
      fixture.componentRef.setInput('myMailingListUids', new Set(['list-1']));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance['tableRows']()[0].canJoin).toBe(false);
    });

    it('does not mark a non-public list as joinable', async () => {
      await render([{ ...baseList, audience_access: MailingListAudienceAccess.APPROVAL_REQUIRED }]);

      expect(fixture.componentInstance['tableRows']()[0].canJoin).toBe(false);
    });

    it('does not mark a list as joinable when membership lookup failed', async () => {
      await render([baseList]);
      fixture.componentRef.setInput('membershipError', true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance['tableRows']()[0].canJoin).toBe(false);
    });
  });

  describe('onJoin', () => {
    it('calls createMember with the caller own email and emits refresh on success', async () => {
      await render([baseList]);
      const refreshSpy = vi.fn();
      fixture.componentInstance.refresh.subscribe(refreshSpy);

      vi.useFakeTimers();
      try {
        fixture.componentInstance['onJoin'](new Event('click'), fixture.componentInstance['tableRows']()[0]);

        expect(createMember).toHaveBeenCalledWith('list-1', expect.objectContaining({ email: 'me@example.com' }));
        expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
        expect(refreshSpy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);
        expect(refreshSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows an error toast and does not call createMember when the caller has no email', async () => {
      await render([baseList], null);

      fixture.componentInstance['onJoin'](new Event('click'), fixture.componentInstance['tableRows']()[0]);

      expect(createMember).not.toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('shows an error toast when createMember fails', async () => {
      await render([baseList]);
      createMember.mockReturnValue(throwError(() => new Error('boom')));

      fixture.componentInstance['onJoin'](new Event('click'), fixture.componentInstance['tableRows']()[0]);

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });
  });

  describe('onLeave', () => {
    it('opens a confirmation dialog and calls deleteMember on accept', async () => {
      await render([{ ...baseList, my_member_uid: 'member-1' } as GroupsIOMailingList]);

      fixture.componentInstance['onLeave'](new Event('click'), fixture.componentInstance['tableRows']()[0]);

      expect(confirm).toHaveBeenCalledTimes(1);
      const confirmArgs = confirm.mock.calls[0][0];
      confirmArgs.accept?.();

      expect(deleteMember).toHaveBeenCalledWith('list-1', 'member-1');
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    });

    it('includes the committee-linked caveat in the confirmation message when the list syncs from a committee', async () => {
      await render([
        {
          ...baseList,
          my_member_uid: 'member-1',
          committees: [{ uid: 'committee-1', name: 'Technical Steering Committee' }],
        } as GroupsIOMailingList,
      ]);

      fixture.componentInstance['onLeave'](new Event('click'), fixture.componentInstance['tableRows']()[0]);

      const confirmArgs = confirm.mock.calls[0][0];
      expect(confirmArgs.message).toContain('Technical Steering Committee');
      expect(confirmArgs.message).toContain('may not persist if your committee role changes');
    });

    it('does nothing when the row has no my_member_uid', async () => {
      await render([baseList]);

      fixture.componentInstance['onLeave'](new Event('click'), fixture.componentInstance['tableRows']()[0]);

      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
