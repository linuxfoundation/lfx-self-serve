// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// CSV member import dialog lifecycle (GH-3849). All people, organizations and domains are synthetic.

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee, CommitteeInvite, CommitteeMember, CreateCommitteeMemberRequest, MemberImportDialogData } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportMembersDialogComponent } from './import-members-dialog.component';

const OPEN_GROUP = { uid: 'committee-1', name: 'Docs Working Group', enable_voting: false, business_email_required: false, writer: true } as Committee;
const VOTING_GROUP = { ...OPEN_GROUP, name: 'Governing Board', enable_voting: true } as Committee;

interface PendingCreate {
  body: CreateCommitteeMemberRequest;
  options: { skipNotification?: boolean } | undefined;
  response: Subject<CommitteeMember>;
}

function emails(count: number, start = 0): string {
  return Array.from({ length: count }, (_, i) => `person${start + i}@example.com`).join('\n');
}

describe('ImportMembersDialogComponent', () => {
  let fixture: ComponentFixture<ImportMembersDialogComponent>;
  let component: ImportMembersDialogComponent;
  let pending: PendingCreate[];
  let committeeService: {
    createCommitteeMember: ReturnType<typeof vi.fn>;
    revokeCommitteeInvite: ReturnType<typeof vi.fn>;
    createCommitteeInvite: ReturnType<typeof vi.fn>;
  };
  let revokeResponses: Subject<void>[];
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  async function setup(
    committee: Committee = OPEN_GROUP,
    existingMembers: Partial<CommitteeMember>[] = [],
    existingInvites: Partial<CommitteeInvite>[] = [],
    collectOnly = false
  ) {
    pending = [];
    revokeResponses = [];
    committeeService = {
      createCommitteeMember: vi.fn(
        (_uid: string, body: CreateCommitteeMemberRequest, options?: { skipNotification?: boolean }): Observable<CommitteeMember> => {
          const response = new Subject<CommitteeMember>();
          pending.push({ body, options, response });
          return response;
        }
      ),
      revokeCommitteeInvite: vi.fn((): Observable<void> => {
        const response = new Subject<void>();
        revokeResponses.push(response);
        return response;
      }),
      createCommitteeInvite: vi.fn(),
    };
    dialogRef = { close: vi.fn() };
    const data: MemberImportDialogData = {
      committee,
      existingMembers: existingMembers as CommitteeMember[],
      existingInvites: existingInvites as CommitteeInvite[],
      collectOnly,
    };

    await TestBed.configureTestingModule({
      imports: [ImportMembersDialogComponent],
      providers: [
        provideNoopAnimations(),
        // p-fileUpload injects HttpClient; the dialog uses customUpload, so no request is ever sent.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: CommitteeService, useValue: committeeService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ImportMembersDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function upload(csv: BlobPart, name = 'members.csv'): Promise<void> {
    const file = new File([csv], name, { type: 'text/csv' });
    component.onFileSelect({ originalEvent: new Event('change'), files: [file], currentFiles: [file] });
    await vi.waitFor(() => expect(component.reading()).toBe(false));
    await fixture.whenStable();
  }

  function succeed(index: number): void {
    pending[index].response.next({ uid: `member-${index}` } as CommitteeMember);
    pending[index].response.complete();
  }

  function fail(index: number, status: number): void {
    pending[index].response.error(new HttpErrorResponse({ status, error: { message: `Upstream said ${status}.` } }));
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  describe('preview', () => {
    beforeEach(async () => setup(OPEN_GROUP, [{ email: 'Existing@Example.com' }]));

    it('shows the open-group guidance without voting columns', async () => {
      expect(query('import-members-guide-email')?.textContent).toContain('Required');
      expect(query('import-members-guide-first_name')?.textContent).toContain('Optional');
      expect(query('import-members-guide-voting_status')).toBeNull();
      expect(component.closeLabel()).toBe('Cancel');
    });

    it('previews valid, invalid and skipped rows without writing anything', async () => {
      await upload('email,first_name\nada@example.com,Ada\nnot-an-email,Bad\nexisting@example.com,Old\nADA@example.com,Again');
      await render();

      expect(component.phase()).toBe('preview');
      expect([component.readyCount(), component.invalidCount(), component.skippedCount()]).toEqual([1, 1, 2]);
      expect(query('import-members-row-issues-3')?.textContent).toContain('Email is not a valid address.');
      expect(query('import-members-row-4')?.textContent).toContain('Already a member of this group.');
      expect(query('import-members-row-5')?.textContent).toContain('Duplicate of row 2.');
      expect(query('import-members-status')?.textContent).toContain('1 ready, 1 invalid, 2 skipped.');
      expect((query('import-members-submit-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

      component.startImport();
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });

    it('blocks a quoted comma in a single email address without sending requests', async () => {
      await upload('email\n"ada,grace@example.com"');
      await render();

      expect(component.invalidCount()).toBe(1);
      expect(component.canImport()).toBe(false);
      expect(query('import-members-row-issues-2')?.textContent).toContain('Email is not a valid address.');
      component.startImport();
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });

    it('lets the user remove an invalid row, then import', async () => {
      await upload('email\nada@example.com\nnot-an-email');
      component.removeRow(3);
      await render();

      expect(component.canImport()).toBe(true);
      expect(query('import-members-row-3')).toBeNull();
      expect(query('import-members-remove-2')?.querySelector('button')?.getAttribute('aria-label')).toBe('Remove row 2');
    });

    it.each(['', 'not-a-url'])('promotes the next occurrence after removing the first, whose LinkedIn is "%s"', async (linkedin) => {
      await upload(
        [
          'email,first_name,linkedin_profile',
          `ada@example.com,First,${linkedin}`,
          'ADA@example.com,Survivor,https://www.linkedin.com/in/example-person',
          'existing@example.com,,',
          'EXISTING@example.com,,',
          'ada@example.com,Later,',
        ].join('\n')
      );
      await render();
      expect(component.rows()[0].status).toBe(linkedin ? 'invalid' : 'ready');
      expect(component.rows()[1].status).toBe('skipped');

      query('import-members-remove-2')?.querySelector('button')?.click();
      await render();

      expect(component.rows().map((row) => [row.rowNumber, row.status])).toEqual([
        [3, 'ready'],
        [4, 'skipped'],
        [5, 'skipped'],
        [6, 'skipped'],
      ]);
      expect(component.rows()[1].reason).toBe('Already a member of this group.');
      expect(component.rows()[2].reason).toBe('Already a member of this group.');
      expect(component.rows()[3].reason).toBe('Duplicate of row 3.');
      expect(component.canImport()).toBe(true);
      expect(query('import-members-row-2')).toBeNull();

      query('import-members-submit-btn')?.querySelector('button')?.click();
      expect(pending).toHaveLength(1);
      expect(pending[0].body).toEqual({
        email: 'ada@example.com',
        first_name: 'Survivor',
        linkedin_profile: 'https://www.linkedin.com/in/example-person',
      });
      succeed(0);
      await render();
      expect(component.addedCount()).toBe(1);
      expect(component.skippedCount()).toBe(3);
    });

    it('blocks malformed organization websites in preview without sending a create request', async () => {
      await upload('email,organization_name,organization_website\nada@example.com,Example Org,https:org.example');
      await render();

      expect(component.invalidCount()).toBe(1);
      expect(component.canImport()).toBe(false);
      expect(query('import-members-row-issues-2')?.textContent).toContain('Organization website must be a full https:// address.');
      component.startImport();
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });

    it('recovers from a rejected file when a corrected file is chosen', async () => {
      await upload('email,permission\nada@example.com,manage');
      await render();
      expect(component.phase()).toBe('select');
      expect(query('import-members-file-errors')?.textContent).toContain('Unknown columns: "permission"');

      await upload('email\nada@example.com', 'fixed.csv');
      await render();
      expect(component.fileErrors()).toEqual([]);
      expect(component.phase()).toBe('preview');
      expect(component.fileName()).toBe('fixed.csv');
    });

    it.each([
      ['a non-CSV file', 'email\nada@example.com', 'members.xlsx', 'Choose a .csv file'],
      ['malformed UTF-8', new Uint8Array([0x65, 0x6d, 0x61, 0x69, 0x6c, 0x0a, 0xc3, 0x28]), 'members.csv', 'could not be read as UTF-8'],
    ])('rejects %s before previewing', async (_label, content, name, message) => {
      await upload(content, name);
      expect(component.rows()).toEqual([]);
      expect(component.fileErrors()[0]).toContain(message);
    });

    it('rejects a file over the size limit without reading it', async () => {
      const file = new File(['x'], 'big.csv', { type: 'text/csv' });
      Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 });
      const read = vi.spyOn(file, 'arrayBuffer');
      component.onFileSelect({ originalEvent: new Event('change'), files: [file], currentFiles: [file] });

      expect(read).not.toHaveBeenCalled();
      expect(component.fileErrors()[0]).toContain('larger than 5 MB');
    });

    it('sends nothing when every row is skipped', async () => {
      await upload('email\nexisting@example.com\nEXISTING@example.com');
      await render();

      expect(component.canImport()).toBe(false);
      expect(query('import-members-nothing-help')).not.toBeNull();
      component.startImport();
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });

    it('returns zero counts when the preview is cancelled', async () => {
      await upload('email\nada@example.com');
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 0, conflicts: 0 });
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });
  });

  describe('edit-wizard collection', () => {
    it('returns only ready requests without writing members or revoking invitations', async () => {
      await setup(OPEN_GROUP, [{ email: 'existing@example.com' }], [{ uid: 'invite-1', invitee_email: 'ada@example.com', status: 'pending' }], true);
      await upload('email,first_name\nada@example.com,Ada\nexisting@example.com,Existing\nADA@example.com,Duplicate');
      await render();

      expect(query('import-members-guidance')?.textContent).toContain('saved only when you select Update Group');
      expect(query('import-members-send-notification')).not.toBeNull();
      expect(component.form.controls.send_notification.value).toBe(false);
      expect(query('import-members-submit-btn')?.textContent).toContain('Import 1 member');
      query('import-members-submit-btn')?.querySelector('button')?.click();

      expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith([
        { email: 'ada@example.com', first_name: 'Ada', createOptions: { skipNotification: true }, pendingInviteUids: ['invite-1'] },
      ]);
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
      expect(committeeService.revokeCommitteeInvite).not.toHaveBeenCalled();
      expect(committeeService.createCommitteeInvite).not.toHaveBeenCalled();
    });

    it.each([false, true])('collects notification opt-in %s and only matching pending invitation IDs without writes', async (notify) => {
      await setup(
        OPEN_GROUP,
        [],
        [
          { uid: 'invite-1', invitee_email: ' ADA@EXAMPLE.COM ', status: 'pending' },
          { uid: 'invite-2', invitee_email: 'ada@example.com', status: 'pending' },
          { uid: 'revoked', invitee_email: 'ada@example.com', status: 'revoked' },
          { uid: 'other', invitee_email: 'other@example.com', status: 'pending' },
        ],
        true
      );
      await upload('email\nada@example.com');
      if (notify) {
        query('import-members-send-notification')?.querySelector('input')?.click();
      }
      component.startImport();
      expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith([
        { email: 'ada@example.com', createOptions: { skipNotification: !notify }, pendingInviteUids: ['invite-1', 'invite-2'] },
      ]);
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
      expect(committeeService.revokeCommitteeInvite).not.toHaveBeenCalled();
    });

    it('returns no members when the collected preview is cancelled', async () => {
      await setup(OPEN_GROUP, [], [], true);
      await upload('email\nada@example.com');
      component.close();
      expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith();
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });

    it('blocks collection until every invalid row is corrected or removed', async () => {
      await setup(VOTING_GROUP, [], [], true);
      await upload('email,organization_name,organization_website,role,voting_status\nada@example.com,Example Org,https://org.example,None,Invalid');
      component.startImport();
      expect(component.invalidCount()).toBe(1);
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });

    it('collects 100 voting-group members with their organizations, roles and voting statuses', async () => {
      await setup(VOTING_GROUP, [], [], true);
      const rows = Array.from({ length: 100 }, (_, i) => `person${i}@example.com,Example Org,https://org.example,LF Staff,Observer`);
      await upload(['email,organization_name,organization_website,role,voting_status', ...rows].join('\n'));
      expect(component.readyCount()).toBe(100);
      component.startImport();
      const collected = dialogRef.close.mock.calls[0][0] as CreateCommitteeMemberRequest[];
      expect(collected).toHaveLength(100);
      expect(collected[99]).toEqual({
        email: 'person99@example.com',
        organization: { id: null, name: 'Example Org', website: 'https://org.example' },
        role: { name: 'LF Staff' },
        voting: { status: 'Observer' },
        createOptions: { skipNotification: true },
        pendingInviteUids: [],
      });
      expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    });
  });

  describe('import', () => {
    beforeEach(async () => setup());

    it('sends the native payload with notifications off by default and caps concurrency', async () => {
      const others = Array.from({ length: 6 }, (_, i) => `person${i + 1}@example.com,`).join('\n');
      await upload(`email,first_name\nperson0@example.com,Ada\n${others}`);
      component.startImport();

      expect(component.phase()).toBe('importing');
      expect(pending).toHaveLength(5);
      expect(pending[0].body).toEqual({ email: 'person0@example.com', first_name: 'Ada' });
      expect(pending[0].options).toEqual({ skipNotification: true });

      succeed(0);
      expect(pending).toHaveLength(6);
    });

    it('sends notification emails when the user opts in', async () => {
      await upload('email\nada@example.com');
      component.form.controls.send_notification.setValue(true);
      component.startImport();
      expect(pending[0].options).toEqual({ skipNotification: false });
    });

    it('blocks closing, re-upload and removal while rows are in flight', async () => {
      await upload('email\nada@example.com\ngrace@example.com');
      component.startImport();
      await render();

      component.close();
      component.removeRow(2);
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(component.rows()).toHaveLength(2);
      expect(component.canChooseFile()).toBe(false);
      expect(component.form.controls.send_notification.disabled).toBe(true);
      expect((query('import-members-close-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    });

    it('records partial results, retries only failed rows and returns cumulative counts', async () => {
      await upload('email\nada@example.com\ngrace@example.com\nlin@example.com');
      component.startImport();
      succeed(0);
      fail(1, 500);
      fail(2, 422);
      await render();

      expect(component.phase()).toBe('results');
      expect([component.addedCount(), component.failedCount()]).toEqual([1, 2]);
      // A 5xx body is never shown (it is not written for users); a 4xx validation message is.
      expect(query('import-members-row-3')?.textContent).toContain('The member could not be added.');
      expect(query('import-members-row-4')?.textContent).toContain('Upstream said 422.');
      expect(query('import-members-status')?.textContent).toContain('1 added, 0 skipped, 2 failed.');

      component.retryFailed();
      expect(pending.slice(3).map((call) => call.body.email)).toEqual(['grace@example.com', 'lin@example.com']);
      succeed(3);
      fail(4, 409); // the earlier attempt may have committed — a conflict is a skip, never an update
      await render();

      expect(component.rows().map((row) => row.status)).toEqual(['added', 'added', 'skipped']);
      expect(component.canRetry()).toBe(false);
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 2, conflicts: 1 });
    });

    it.each([
      [401, 'Your session has expired. Sign in again, then retry.'],
      [403, 'You no longer have permission to manage this group.'],
      [404, 'This group could not be found.'],
      [429, 'Too many requests. Wait a minute, then retry.'],
    ])('stops sending after HTTP %i and keeps unsent rows retryable', async (status, reason) => {
      await upload(`email\n${emails(7)}`);
      component.startImport();
      fail(0, status);
      for (let i = 1; i < 5; i++) succeed(i);
      await render();

      expect(pending).toHaveLength(5);
      expect(component.stopReason()).toBe(reason);
      expect(console.error).toHaveBeenCalledExactlyOnceWith('CSV member import failed', { status });
      expect(component.rows().map((row) => row.status)).toEqual(['failed', 'added', 'added', 'added', 'added', 'failed', 'failed']);
      expect(component.rows()[6].reason).toContain('Not sent');
      expect(query('import-members-stop-reason')).not.toBeNull();
      expect(component.canRetry()).toBe(true);

      component.retryFailed();
      expect(pending.slice(5).map((call) => call.body.email)).toEqual(['person0@example.com', 'person5@example.com', 'person6@example.com']);
      for (let i = 5; i < 8; i++) succeed(i);
      await render();
      expect(component.addedCount()).toBe(7);
      expect(component.canRetry()).toBe(false);
    });
  });

  describe('organizations and invitations', () => {
    it('sends each row its own organization for an organization-required group', async () => {
      await setup(VOTING_GROUP);
      await upload(
        [
          'email,organization_name,organization_website,role,voting_status',
          'ada@example.com,Acme Motors,https://acme-motors.example,Chair,Voting Rep',
          'grace@example.com,Vendor Corp,https://vendor-corp.example,None,Observer',
        ].join('\n')
      );
      component.startImport();

      expect(pending.map((call) => call.body)).toEqual([
        {
          email: 'ada@example.com',
          organization: { id: null, name: 'Acme Motors', website: 'https://acme-motors.example' },
          role: { name: 'Chair' },
          voting: { status: 'Voting Rep' },
        },
        {
          email: 'grace@example.com',
          organization: { id: null, name: 'Vendor Corp', website: 'https://vendor-corp.example' },
          role: { name: 'None' },
          voting: { status: 'Observer' },
        },
      ]);
      expect(query('import-members-guide-voting_status')).not.toBeNull();
    });

    it.each([401, 403, 404, 429])('stops queued creates after cleanup HTTP %i while retaining the added member', async (status) => {
      await setup(OPEN_GROUP, [], [{ uid: 'invite-1', invitee_email: 'person0@example.com', status: 'pending' }]);
      await upload(`email\n${emails(7)}`);
      component.startImport();
      succeed(0);
      expect(pending).toHaveLength(5);

      revokeResponses[0].error(new HttpErrorResponse({ status }));
      for (let i = 1; i < 5; i++) succeed(i);
      await render();

      expect(pending).toHaveLength(5);
      expect(component.rows().map((row) => row.status)).toEqual(['added', 'added', 'added', 'added', 'added', 'failed', 'failed']);
      expect(component.rows()[0].cleanupWarning).toContain('pending invitation could not be revoked');
      expect(component.rows()[5].reason).toContain('Not sent');
      expect(component.stopReason()).toBeTruthy();
      if (status === 404) {
        expect(component.stopReason()).toContain('invitation');
        expect(component.stopReason()).not.toContain('group could not be found');
      }
      expect(console.error).toHaveBeenCalledExactlyOnceWith('CSV member import invitation cleanup failed', { status });
      expect(query('import-members-stop-reason')).not.toBeNull();
      expect(component.canRetry()).toBe(true);

      component.retryFailed();
      expect(component.stopReason()).toBeNull();
      expect(pending.slice(5).map((call) => call.body.email)).toEqual(['person5@example.com', 'person6@example.com']);
      succeed(5);
      succeed(6);
      await render();
      expect(component.addedCount()).toBe(7);
      expect(component.canRetry()).toBe(false);
      expect(committeeService.revokeCommitteeInvite).toHaveBeenCalledTimes(1);
    });

    it('revokes a matching pending invite after adding, warns if that fails, and never creates invites', async () => {
      await setup(
        OPEN_GROUP,
        [],
        [
          { uid: 'invite-1', invitee_email: 'Ada@Example.com', status: 'pending' },
          { uid: 'invite-2', invitee_email: 'grace@example.com', status: 'accepted' },
        ]
      );
      await upload('email\nada@example.com\ngrace@example.com');
      component.startImport();
      succeed(0);
      succeed(1);

      expect(committeeService.revokeCommitteeInvite).toHaveBeenCalledTimes(1);
      expect(committeeService.revokeCommitteeInvite).toHaveBeenCalledWith('committee-1', 'invite-1');
      revokeResponses[0].error(new HttpErrorResponse({ status: 500 }));
      await render();

      expect(component.rows().map((row) => row.status)).toEqual(['added', 'added']);
      expect(component.rows()[0].cleanupWarning).toContain('pending invitation could not be revoked');
      expect(console.error).toHaveBeenCalledExactlyOnceWith('CSV member import invitation cleanup failed', { status: 500 });
      expect(query('import-members-cleanup-warning')).not.toBeNull();
      expect(component.canRetry()).toBe(false);
      expect(committeeService.createCommitteeInvite).not.toHaveBeenCalled();
    });
  });
});
