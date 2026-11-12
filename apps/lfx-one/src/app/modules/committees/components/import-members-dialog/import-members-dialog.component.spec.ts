// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// CSV member import dialog lifecycle (GH-3849), submitted in bulk chunks with pause and resume (GH-5111).
// All people, organizations and domains are synthetic.

import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MEMBER_IMPORT_BULK_CHUNK_SIZE } from '@lfx-one/shared/constants';
import {
  Committee,
  CommitteeInvite,
  CommitteeMember,
  CommitteeMemberBulkCreateResult,
  CommitteeMemberBulkCreateRowResult,
  CreateCommitteeMemberRequest,
  MemberImportDialogData,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportMembersDialogComponent } from './import-members-dialog.component';

const OPEN_GROUP = { uid: 'committee-1', name: 'Docs Working Group', enable_voting: false, business_email_required: false, writer: true } as Committee;
const VOTING_GROUP = { ...OPEN_GROUP, name: 'Governing Board', enable_voting: true } as Committee;

interface PendingBulk {
  members: CreateCommitteeMemberRequest[];
  options: { skipNotification?: boolean } | undefined;
  response: Subject<CommitteeMemberBulkCreateResult>;
}

function emails(count: number, start = 0): string {
  return Array.from({ length: count }, (_, i) => `person${start + i}@example.com`).join('\n');
}

describe('ImportMembersDialogComponent', () => {
  let fixture: ComponentFixture<ImportMembersDialogComponent>;
  let component: ImportMembersDialogComponent;
  let pending: PendingBulk[];
  let committeeService: {
    createCommitteeMember: ReturnType<typeof vi.fn>;
    bulkCreateCommitteeMembers: ReturnType<typeof vi.fn>;
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
      createCommitteeMember: vi.fn(),
      bulkCreateCommitteeMembers: vi.fn(
        (_uid: string, members: CreateCommitteeMemberRequest[], options?: { skipNotification?: boolean }): Observable<CommitteeMemberBulkCreateResult> => {
          const response = new Subject<CommitteeMemberBulkCreateResult>();
          pending.push({ members, options, response });
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

  /** Answers bulk call `call` with one result per row: added unless overridden by row index. */
  function respond(call: number, overrides: Record<number, Partial<CommitteeMemberBulkCreateRowResult>> = {}): void {
    const results = pending[call].members.map(
      (member, index): CommitteeMemberBulkCreateRowResult => ({
        index,
        email: member.email,
        status: 'added',
        retryable: false,
        member_uid: `member-${call}-${index}`,
        ...overrides[index],
      })
    );
    const count = (status: CommitteeMemberBulkCreateRowResult['status']): number => results.filter((result) => result.status === status).length;
    pending[call].response.next({ results, added: count('added'), skipped: count('skipped'), failed: count('failed') });
    pending[call].response.complete();
  }

  function failBulk(call: number, status: number, headers: Record<string, string> = {}): void {
    pending[call].response.error(new HttpErrorResponse({ status, headers: new HttpHeaders(headers), error: { message: `Upstream said ${status}.` } }));
  }

  function expectNothingWritten(): void {
    expect(committeeService.bulkCreateCommitteeMembers).not.toHaveBeenCalled();
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  }

  function sentEmails(call: number): string[] {
    return pending[call].members.map((member) => member.email);
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
    vi.useRealTimers();
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
      expectNothingWritten();
    });

    it('blocks a quoted comma in a single email address without sending requests', async () => {
      await upload('email\n"ada,grace@example.com"');
      await render();

      expect(component.invalidCount()).toBe(1);
      expect(component.canImport()).toBe(false);
      expect(query('import-members-row-issues-2')?.textContent).toContain('Email is not a valid address.');
      component.startImport();
      expectNothingWritten();
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
      expect(pending[0].members).toEqual([
        {
          email: 'ada@example.com',
          first_name: 'Survivor',
          linkedin_profile: 'https://www.linkedin.com/in/example-person',
        },
      ]);
      respond(0);
      await render();
      expect(component.addedCount()).toBe(1);
      expect(component.skippedCount()).toBe(3);
    });

    it('blocks malformed organization websites in preview without sending a create request', async () => {
      await upload('email,organization_name,organization_website\nada@example.com,Example Org,https:org.example');
      await render();

      expect(component.invalidCount()).toBe(1);
      expect(component.canImport()).toBe(false);
      expect(query('import-members-row-issues-2')?.textContent).toContain('Company website must be a full https:// address.');
      component.startImport();
      expectNothingWritten();
    });

    it('recovers from a rejected file when a corrected file is chosen', async () => {
      await upload('Email,email\nada@example.com,ada@example.com');
      await render();
      expect(component.phase()).toBe('select');
      expect(query('import-members-file-errors')?.textContent).toContain('The column "email" appears more than once.');

      await upload('email\nada@example.com', 'fixed.csv');
      await render();
      expect(component.fileErrors()).toEqual([]);
      expect(component.phase()).toBe('preview');
      expect(component.fileName()).toBe('fixed.csv');
    });

    it('rejects a non-CSV file before previewing', async () => {
      await upload('email\nada@example.com', 'members.xlsx');
      expect(component.rows()).toEqual([]);
      expect(component.fileErrors()[0]).toContain('Choose a .csv file');
    });

    it('previews flexible headers and values, listing ignored columns in a notice', async () => {
      await upload('Email,First Name,Last Name,Notes,Role\nada@example.com,Ada,Lovelace,met at summit,chair');
      await render();

      expect(component.phase()).toBe('preview');
      expect(component.fileErrors()).toEqual([]);
      expect(component.readyCount()).toBe(1);
      expect(component.rows()[0].cells).toEqual({ email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace', role: 'Chair' });
      expect(query('import-members-row-2')?.textContent).toContain('Chair');
      const notices = query('import-members-file-notices');
      expect(notices?.getAttribute('role')).toBeNull();
      expect(notices?.textContent).toContain("Ignored columns: Notes. The import doesn't use them.");
      expect(query('import-members-status')?.getAttribute('aria-live')).toBe('polite');
      expect(query('import-members-status')?.textContent).toContain("1 ready, 0 invalid, 0 skipped. Ignored columns: Notes. The import doesn't use them.");
      expect(notices?.textContent).not.toContain('UTF-8');
    });

    it('reads a non-UTF-8 file as Windows-1252 and says so in the preview', async () => {
      await upload(new Uint8Array([...new TextEncoder().encode('email,first_name\nada@example.com,Jos'), 0xe9]));
      await render();

      expect(component.phase()).toBe('preview');
      expect(component.rows()[0].cells.first_name).toBe('José');
      expect(query('import-members-row-2')?.textContent).toContain('José');
      expect(component.fileNotices()).toEqual([
        "This file wasn't saved as UTF-8, so it was read as Windows (Western European) text. Check that names with accents look right before adding.",
      ]);
      expect(query('import-members-file-notices')?.textContent).toContain('read as Windows (Western European) text');
      expect(query('import-members-status')?.textContent).toContain(component.fileNotices()[0]);
    });

    it('clears file notices when a different file is chosen', async () => {
      await upload(new Uint8Array([...new TextEncoder().encode('email,notes\nada@example.com,Jos'), 0xe9]));
      await render();
      expect(component.fileNotices()).toHaveLength(2);

      await upload('email\ngrace@example.com', 'clean.csv');
      await render();
      expect(component.phase()).toBe('preview');
      expect(component.fileNotices()).toEqual([]);
      expect(query('import-members-file-notices')).toBeNull();
      expect(query('import-members-status')?.textContent?.trim()).toBe('1 ready, 0 invalid, 0 skipped.');
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
      expectNothingWritten();
    });

    it('returns zero counts when the preview is cancelled', async () => {
      await upload('email\nada@example.com');
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 0, conflicts: 0 });
      expectNothingWritten();
    });
  });

  describe('wizard collection', () => {
    it('explains both wizard save actions before upload and in the preview', async () => {
      await setup(OPEN_GROUP, [], [], true);
      expect(component.phase()).toBe('select');
      expect(query('import-members-guidance')?.textContent).toContain('Done (when creating) or Update Group (when editing)');

      await upload('email\nada@example.com');
      await render();
      expect(query('import-members-summary')?.textContent?.replace(/\s+/g, ' ')).toContain(
        'Confirm to add them to the form, then select Done (when creating) or Update Group (when editing) to save.'
      );
      expectNothingWritten();
    });

    it('returns only ready requests without writing members or revoking invitations', async () => {
      await setup(OPEN_GROUP, [{ email: 'existing@example.com' }], [{ uid: 'invite-1', invitee_email: 'ada@example.com', status: 'pending' }], true);
      await upload('email,first_name\nada@example.com,Ada\nexisting@example.com,Existing\nADA@example.com,Duplicate');
      await render();

      expect(query('import-members-guidance')?.textContent).toContain('Done (when creating) or Update Group (when editing)');
      expect(query('import-members-send-notification')).not.toBeNull();
      expect(component.form.controls.send_notification.value).toBe(false);
      expect(query('import-members-submit-btn')?.textContent).toContain('Import 1 member');
      query('import-members-submit-btn')?.querySelector('button')?.click();

      expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith([
        { email: 'ada@example.com', first_name: 'Ada', createOptions: { skipNotification: true }, pendingInviteUids: ['invite-1'] },
      ]);
      expectNothingWritten();
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
      expectNothingWritten();
      expect(committeeService.revokeCommitteeInvite).not.toHaveBeenCalled();
    });

    it('returns no members when the collected preview is cancelled', async () => {
      await setup(OPEN_GROUP, [], [], true);
      await upload('email\nada@example.com');
      component.close();
      expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith();
      expectNothingWritten();
    });

    it('blocks collection until every invalid row is corrected or removed', async () => {
      await setup(VOTING_GROUP, [], [], true);
      await upload('email,organization_name,organization_website,role,voting_status\nada@example.com,Example Org,https://org.example,None,Invalid');
      component.startImport();
      expect(component.invalidCount()).toBe(1);
      expect(dialogRef.close).not.toHaveBeenCalled();
      expectNothingWritten();
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
      expectNothingWritten();
    });
  });

  describe('import', () => {
    beforeEach(async () => setup());

    it('sends rows in sequential chunks with the native payload and notifications off by default', async () => {
      expect(MEMBER_IMPORT_BULK_CHUNK_SIZE).toBe(25);
      // Every record needs one cell per header, so the remaining rows leave first_name empty.
      const others = emails(29, 1)
        .split('\n')
        .map((email) => `${email},`)
        .join('\n');
      await upload(`email,first_name\nperson0@example.com,Ada\n${others}`);
      component.startImport();

      expect(component.phase()).toBe('importing');
      expect(pending).toHaveLength(1);
      expect(pending[0].members).toHaveLength(25);
      expect(pending[0].members[0]).toEqual({ email: 'person0@example.com', first_name: 'Ada' });
      expect(pending[0].options).toEqual({ skipNotification: true });
      expect(component.rows().map((row) => row.status)).toEqual([...Array(25).fill('importing'), ...Array(5).fill('not_submitted')]);

      respond(0);
      expect(pending).toHaveLength(2);
      expect(sentEmails(1)).toEqual(emails(5, 25).split('\n'));

      respond(1);
      await render();
      expect(component.phase()).toBe('results');
      expect(component.addedCount()).toBe(30);
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 30, conflicts: 0 });
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
      component.stopImport();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(component.stopReason()).toBeNull();
      expect(component.rows()).toHaveLength(2);
      expect(component.canChooseFile()).toBe(false);
      expect(component.form.controls.send_notification.disabled).toBe(true);
      expect((query('import-members-close-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect(query('import-members-stop-btn')).toBeNull();
    });

    it('records added, existing and invalid rows, and never retries invalid rows', async () => {
      await upload('email\nada@example.com\ngrace@example.com\nlin@example.com');
      component.startImport();
      respond(0, {
        1: { status: 'skipped', reason: 'already_member' },
        2: { status: 'failed', reason: 'invalid', message: 'organization website is not a valid URL' },
      });
      await render();

      expect(component.phase()).toBe('results');
      expect(component.rows().map((row) => row.status)).toEqual(['added', 'skipped', 'failed']);
      expect(query('import-members-row-4')?.textContent).toContain('organization website is not a valid URL. Fix this row in the file and import it again.');
      expect(query('import-members-status')?.textContent).toContain('1 added, 1 skipped, 1 failed.');
      expect(query('import-members-retry-help')).not.toBeNull();
      expect(component.canRetry()).toBe(false);
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 1, conflicts: 1 });
    });

    it('pauses for Retry-After on a 429, then resubmits the throttled chunk', async () => {
      await upload(`email\n${emails(30)}`);
      vi.useFakeTimers();
      component.startImport();
      respond(0);
      failBulk(1, 429, { 'Retry-After': '30' });
      fixture.detectChanges();

      expect(component.paused()).toBe(true);
      expect(component.waitingCount()).toBe(5);
      expect(component.statusMessage()).toBe('Paused: 30-second recovery pause (pause 1 of 3). The import will resume automatically.');
      expect(query('import-members-paused-notice')?.textContent).toContain('pause 1 of 3');
      expect(query('import-members-stop-btn')).not.toBeNull();
      expect(console.error).toHaveBeenCalledExactlyOnceWith('CSV member import chunk failed', { status: 429 });

      const pausedNotice = query('import-members-paused-notice')?.textContent;
      expect(pausedNotice).toContain('This pause lasts about 30 seconds;');
      expect(pausedNotice).toContain('resume is scheduled for');
      expect(pausedNotice).not.toContain('in about 30 seconds');
      const resumeAt = component.resumeAt();
      vi.advanceTimersByTime(29_999);
      fixture.detectChanges();
      expect(pending).toHaveLength(2);
      expect(component.resumeAt()).toBe(resumeAt);
      expect(query('import-members-paused-notice')?.textContent).toBe(pausedNotice);
      expect(query('import-members-status')?.textContent).toContain('Paused: 30-second recovery pause (pause 1 of 3). The import will resume automatically.');
      vi.advanceTimersByTime(1);
      expect(pending).toHaveLength(3);
      expect(sentEmails(2)).toEqual(emails(5, 25).split('\n'));
      expect(component.paused()).toBe(false);

      respond(2);
      expect(component.phase()).toBe('results');
      expect(component.addedCount()).toBe(30);
      fixture.detectChanges();
      expect(component.retryNotBefore()).toBe(0);
      expect(query('import-members-retry-deadline')).toBeNull();
    });

    it('retries only a missing result and preserves the existing-member outcome on recovery', async () => {
      await upload('email\nada@example.com\ngrace@example.com');
      vi.useFakeTimers();
      component.startImport();
      pending[0].response.next({
        results: [{ index: 0, email: 'ada@example.com', status: 'added', retryable: false, member_uid: 'member-0' }],
        added: 1,
        skipped: 0,
        failed: 0,
      });
      pending[0].response.complete();

      expect(component.rows().map((row) => row.status)).toEqual(['added', 'waiting']);
      expect(component.rows()[1].uncertain).toBe(true);
      expect(component.batchSettled()).toBe(1);
      vi.advanceTimersByTime(14_999);
      expect(pending).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sentEmails(1)).toEqual(['grace@example.com']);
      respond(1, { 0: { status: 'skipped', reason: 'already_member' } });

      expect(component.rows()[1]).toMatchObject({ status: 'skipped', conflict: true, uncertain: false });
      expect(component.rows()[1].reason).toContain('earlier addition could not be confirmed');
      expect(component.addedCount()).toBe(1);
      expect(component.conflictCount()).toBe(1);
      expect(component.phase()).toBe('results');
      expect(committeeService.revokeCommitteeInvite).not.toHaveBeenCalled();
    });

    it('waits on temporary and not-attempted rows, then resubmits only those rows', async () => {
      await upload('email\nada@example.com\ngrace@example.com\nlin@example.com');
      vi.useFakeTimers();
      component.startImport();
      respond(0, {
        1: { status: 'failed', reason: 'temporary', retryable: true },
        2: { status: 'failed', reason: 'not_attempted', retryable: true },
      });

      expect(component.rows().map((row) => row.status)).toEqual(['added', 'waiting', 'waiting']);
      expect(component.rows()[1].uncertain).toBe(true);
      vi.advanceTimersByTime(14_999);
      expect(pending).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sentEmails(1)).toEqual(['grace@example.com', 'lin@example.com']);

      respond(1);
      expect(component.phase()).toBe('results');
      expect(component.addedCount()).toBe(3);
    });

    it('stops after the third pause and preserves unknown outcomes for Retry', async () => {
      await upload('email\nada@example.com');
      vi.useFakeTimers();
      component.startImport();
      for (const [call, delay] of [
        [0, 15_000],
        [1, 30_000],
        [2, 60_000],
      ]) {
        failBulk(call, 503);
        expect(component.paused()).toBe(true);
        vi.advanceTimersByTime(delay);
      }
      expect(pending).toHaveLength(4);
      failBulk(3, 503);
      fixture.detectChanges();

      expect(component.phase()).toBe('results');
      expect(component.paused()).toBe(false);
      expect(component.stopReason()).toBe('Automatic recovery has stopped after three pauses. Review the outcomes before retrying.');
      expect(component.rows()[0]).toMatchObject({ status: 'unknown', uncertain: true });
      expect(component.retryableCount()).toBe(1);
      expect(query('import-members-unknown-count')?.textContent).toContain('1 outcome unknown');
      expect(query('import-members-not-submitted-count')).toBeNull();
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 0, conflicts: 0, uncertain: true });
      expect(query('import-members-retry-btn')?.textContent).toContain('Retry 1');

      component.retryFailed();
      expect(pending).toHaveLength(5);
      expect(component.pauseCount()).toBe(0);
    });

    it('stops during a pause without sending anything else', async () => {
      await upload(`email\n${emails(30)}`);
      vi.useFakeTimers();
      component.startImport();
      failBulk(0, 429, { 'Retry-After': '30' });
      fixture.detectChanges();
      (query('import-members-stop-btn')?.querySelector('button') as HTMLButtonElement).click();

      expect(component.phase()).toBe('results');
      expect(component.stopReason()).toBe('You stopped the import.');
      expect(component.rows().every((row) => row.status === 'not_submitted')).toBe(true);
      expect(component.rows()[0].reason).toBe('Not sent: You stopped the import.');
      expect(component.rows()[29].reason).toBe('Not sent: You stopped the import.');
      vi.advanceTimersByTime(120_000);
      expect(pending).toHaveLength(1);
      expect(component.retryableCount()).toBe(30);
    });

    it('keeps lost-response attempts unknown on Stop and Close while later chunks remain unsent', async () => {
      await upload(`email\n${emails(30)}`);
      vi.useFakeTimers();
      component.startImport();
      failBulk(0, 0);
      component.stopImport();
      fixture.detectChanges();

      expect(
        component
          .rows()
          .slice(0, 25)
          .every((row) => row.status === 'unknown' && row.uncertain)
      ).toBe(true);
      expect(component.rows()[0].reason).toContain('outcome of an earlier attempt is unknown');
      expect(
        component
          .rows()
          .slice(25)
          .every((row) => row.status === 'not_submitted' && !row.uncertain)
      ).toBe(true);
      expect(query('import-members-unknown-count')?.textContent).toContain('25 outcome unknown');
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 0, conflicts: 0, uncertain: true });
      vi.advanceTimersByTime(120_000);
      expect(pending).toHaveLength(1);
    });

    it.each(['seconds', 'date'])('stops for a long %s cooldown and guards manual Retry until its deadline', async (format) => {
      await upload(`email\n${emails(30)}`);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
      component.startImport();
      const header = format === 'seconds' ? '300' : new Date(Date.now() + 300_000).toUTCString();
      failBulk(0, 429, { 'Retry-After': header });
      fixture.detectChanges();

      expect(component.phase()).toBe('results');
      expect(component.paused()).toBe(false);
      expect(component.rows().every((row) => row.status === 'not_submitted')).toBe(true);
      expect(component.stopReason()).toContain('cooldown exceeds');
      expect(query('import-members-retry-deadline')?.textContent).toContain('Retry no earlier than');
      expect((query('import-members-retry-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      vi.advanceTimersByTime(299_999);
      component.retryFailed();
      expect(pending).toHaveLength(1);
      vi.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(query('import-members-retry-deadline')).toBeNull();
      expect((query('import-members-retry-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
      component.retryFailed();
      expect(pending).toHaveLength(2);
      respond(1);
      respond(2);
      expect(component.addedCount()).toBe(30);
    });

    it('retains the cooldown when Stop ends a short pause', async () => {
      await upload('email\nada@example.com');
      vi.useFakeTimers();
      component.startImport();
      failBulk(0, 429, { 'Retry-After': '30' });
      component.stopImport();
      component.retryFailed();
      expect(pending).toHaveLength(1);
      vi.advanceTimersByTime(30_000);
      component.retryFailed();
      expect(pending).toHaveLength(2);
    });

    it('preserves uncertainty if a retry is refused before Stop', async () => {
      await upload('email\nada@example.com');
      vi.useFakeTimers();
      component.startImport();
      failBulk(0, 0);
      vi.advanceTimersByTime(15_000);
      failBulk(1, 403);
      expect(component.rows()[0]).toMatchObject({ status: 'unknown', uncertain: true });
      component.close();
      expect(dialogRef.close).toHaveBeenCalledWith({ added: 0, conflicts: 0, uncertain: true });
    });

    it.each([
      [401, 'Your session has expired. Sign in again, then retry.'],
      [403, 'You no longer have permission to manage this group.'],
      [404, 'This group could not be found.'],
    ])('stops sending after HTTP %i and keeps unsent rows retryable', async (status, reason) => {
      await upload(`email\n${emails(30)}`);
      component.startImport();
      failBulk(0, status);
      await render();

      expect(pending).toHaveLength(1);
      expect(component.phase()).toBe('results');
      expect(component.stopReason()).toBe(reason);
      expect(console.error).toHaveBeenCalledExactlyOnceWith('CSV member import chunk failed', { status });
      expect(component.rows().every((row) => row.status === 'not_submitted')).toBe(true);
      expect(component.rows()[0].reason).toBe(`Not sent: ${reason}`);
      expect(query('import-members-stop-reason')?.textContent).toContain('marked Not yet submitted');
      expect(component.retryableCount()).toBe(30);

      component.retryFailed();
      expect(component.stopReason()).toBeNull();
      expect(sentEmails(1)).toEqual(emails(25).split('\n'));
    });

    it('fails a rejected chunk for good and still sends the next chunk', async () => {
      await upload(`email\n${emails(30)}`);
      component.startImport();
      failBulk(0, 400);

      expect(pending).toHaveLength(2);
      respond(1);
      await render();

      expect(component.failedCount()).toBe(25);
      expect(component.addedCount()).toBe(5);
      expect(component.rows()[0]).toMatchObject({ status: 'failed', retryable: false });
      expect(component.rows()[0].reason).toBe('Upstream said 400. Fix the file and import it again.');
      expect(component.stopReason()).toBeNull();
      expect(component.canRetry()).toBe(false);
    });

    it('stops resubmitting when the dialog is destroyed mid-pause', async () => {
      await upload('email\nada@example.com');
      vi.useFakeTimers();
      component.startImport();
      failBulk(0, 429, { 'Retry-After': '5' });
      const deadline = component.retryNotBefore();
      fixture.destroy();

      vi.advanceTimersByTime(120_000);
      expect(pending).toHaveLength(1);
      expect(component.retryNotBefore()).toBe(deadline);
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

      expect(pending[0].members).toEqual([
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

    it.each(['lost successful create', 'concurrent addition', 'stale preview snapshot'])(
      'preserves existing-member skips after a %s instead of attributing creation or revoking invites',
      async () => {
        await setup(OPEN_GROUP, [], [{ uid: 'invite-1', invitee_email: 'ada@example.com', status: 'pending' }]);
        await upload('email,role\nada@example.com,Chair');
        vi.useFakeTimers();
        component.startImport();
        // These histories are indistinguishable on the wire: no response, then membership exists.
        failBulk(0, 0);
        expect(component.rows()[0]).toMatchObject({ status: 'waiting', uncertain: true });
        vi.advanceTimersByTime(15_000);
        respond(1, { 0: { status: 'skipped', reason: 'already_member', member_uid: 'existing-member' } });

        expect(component.rows()[0]).toMatchObject({ status: 'skipped', conflict: true, uncertain: false });
        expect(component.rows()[0].reason).toContain('imported details may not have been applied');
        expect(component.conflictCount()).toBe(1);
        expect(committeeService.revokeCommitteeInvite).not.toHaveBeenCalled();
        expect(component.phase()).toBe('results');
        expect(component.addedCount()).toBe(0);
        component.close();
        expect(dialogRef.close).toHaveBeenCalledWith({ added: 0, conflicts: 1 });
      }
    );

    it('keeps going after a rate-limited invite cleanup, with a warning on the added row', async () => {
      await setup(OPEN_GROUP, [], [{ uid: 'invite-1', invitee_email: 'person0@example.com', status: 'pending' }]);
      await upload(`email\n${emails(30)}`);
      component.startImport();
      respond(0);
      // The next chunk waits for this chunk's cleanup.
      expect(pending).toHaveLength(1);

      revokeResponses[0].error(new HttpErrorResponse({ status: 429 }));
      expect(pending).toHaveLength(2);
      expect(component.stopReason()).toBeNull();
      expect(component.rows()[0]).toMatchObject({ status: 'added' });
      expect(component.rows()[0].cleanupWarning).toContain('pending invitation could not be revoked');

      respond(1);
      expect(component.phase()).toBe('results');
      expect(component.addedCount()).toBe(30);
    });

    it.each([401, 403, 404])('stops queued chunks after cleanup HTTP %i while retaining the added member', async (status) => {
      await setup(OPEN_GROUP, [], [{ uid: 'invite-1', invitee_email: 'person0@example.com', status: 'pending' }]);
      await upload(`email\n${emails(30)}`);
      component.startImport();
      respond(0);

      revokeResponses[0].error(new HttpErrorResponse({ status }));
      await render();

      expect(pending).toHaveLength(1);
      expect(component.rows().map((row) => row.status)).toEqual([...Array(25).fill('added'), ...Array(5).fill('not_submitted')]);
      expect(component.rows()[0].cleanupWarning).toContain('pending invitation could not be revoked');
      expect(component.rows()[25].reason).toContain('Not sent');
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
      expect(sentEmails(1)).toEqual(emails(5, 25).split('\n'));
      respond(1);
      await render();
      expect(component.addedCount()).toBe(30);
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
      respond(0);

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
