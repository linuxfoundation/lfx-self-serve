// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_INVITE_CONCURRENCY, MEMBER_ROLES } from '@lfx-one/shared/constants';
import {
  CategorizedCommitteeEmails,
  Committee,
  CommitteeInvite,
  CommitteeInviteResult,
  CommitteeMember,
  DecoratedCommitteeSearchResult,
  EmailListParseResult,
  MeetingRegistrant,
  MeetingSelectOption,
  UserSearchResult,
  OrganizationResolveResult,
  CommitteeOrganizationReference,
} from '@lfx-one/shared/interfaces';
import {
  buildCommitteeOrganizationPayload,
  committeeRequiresOrganization,
  extractRegistrantEmails,
  hasLfAccount,
  parseEmailList,
  rankUserSearchResults,
} from '@lfx-one/shared/utils';
import { UserAvatarColorPipe } from '@pipes/user-avatar-color.pipe';
import { UserInitialsPipe } from '@pipes/user-initials.pipe';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, from, map, mergeMap, Observable, of, startWith, switchMap, take, tap, toArray } from 'rxjs';

/**
 * Invite people to a committee by email — single or bulk.
 *
 * The committee/registrant search corpus is not the LF identity directory, so this
 * flow does not try to match every person to an existing account. Anyone is added by
 * inviting their email (invite-and-forget); the invitee completes their own profile on
 * accept, and an LFID is reconciled then. The typeahead is a convenience for finding
 * people already known to v2 and appending their email — never a gate.
 */
@Component({
  selector: 'lfx-add-member-dialog',
  imports: [
    ReactiveFormsModule,
    NgClass,
    UserInitialsPipe,
    UserAvatarColorPipe,
    ButtonComponent,
    InputTextComponent,
    OrganizationSearchComponent,
    SelectComponent,
    TextareaComponent,
    SkeletonModule,
  ],
  templateUrl: './add-member-dialog.component.html',
  styleUrl: './add-member-dialog.component.scss',
})
export class AddMemberDialogComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly meetingService = inject(MeetingService);
  private readonly searchService = inject(SearchService);
  private readonly messageService = inject(MessageService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  private readonly organizationSearch = viewChild(OrganizationSearchComponent);
  private resolvedOrganizationName = '';

  public readonly committee: Committee | null = this.config.data?.committee ?? null;
  /** True when the committee requires organization on accept — shows an optional default org field. */
  public readonly showOrganizationField = computed(() => (this.committee ? committeeRequiresOrganization(this.committee) : false));
  private readonly existingMemberEmails = new Set<string>(
    ((this.config.data?.existingMembers as CommitteeMember[]) ?? []).map((m) => (m.email ?? '').trim().toLowerCase()).filter(Boolean)
  );
  private readonly existingInviteEmails = new Set<string>(
    ((this.config.data?.existingInvites as CommitteeInvite[]) ?? []).map((i) => (i.invitee_email ?? '').trim().toLowerCase()).filter(Boolean)
  );

  public readonly form = new FormGroup({
    emails: new FormControl<string>('', { nonNullable: true }),
    role: new FormControl<string | null>(null),
    organization: new FormControl(''),
    organization_url: new FormControl(''),
    organization_id: new FormControl<string | null>(null),
  });
  public readonly searchForm = new FormGroup({ query: new FormControl('') });
  /** Picker for "import registrants from a meeting" (LFXV2-2607). */
  public readonly importForm = new FormGroup({ meeting: new FormControl<string | null>(null) });

  public submitting = signal(false);
  public searchLoading = signal(false);
  public importing = signal(false);
  /** Human-readable outcome of the last import, shown under the picker. */
  public importSummary = signal<string | null>(null);

  private readonly rawEmails = toSignal(this.form.get('emails')!.valueChanges.pipe(startWith(this.form.get('emails')!.value)), { initialValue: '' });

  public readonly parsed: Signal<EmailListParseResult> = computed(() => parseEmailList(this.rawEmails()));
  public readonly categorized: Signal<CategorizedCommitteeEmails> = computed(() => {
    const result: CategorizedCommitteeEmails = { toInvite: [], alreadyMembers: [], alreadyInvited: [] };
    for (const email of this.parsed().valid) {
      if (this.existingMemberEmails.has(email)) {
        result.alreadyMembers.push(email);
      } else if (this.existingInviteEmails.has(email)) {
        result.alreadyInvited.push(email);
      } else {
        result.toInvite.push(email);
      }
    }
    return result;
  });
  public readonly canSubmit = computed(() => !this.submitting() && this.categorized().toInvite.length > 0);
  /** Comma-joined invalid tokens for the preview — precomputed so the template reads a signal, not a function call. */
  public readonly invalidSummary = computed(() => this.parsed().invalid.join(', '));

  public readonly queryValue = toSignal(
    this.searchForm.get('query')!.valueChanges.pipe(
      startWith(''),
      map((v) => (v ?? '').trim())
    ),
    { initialValue: '' }
  );
  public searchResults: Signal<DecoratedCommitteeSearchResult[]> = this.initSearchResults();
  /** Meetings in the committee's project, for the import picker. Empty when none / no project. */
  public readonly meetingOptions: Signal<MeetingSelectOption[]> = this.initMeetingOptions();

  public readonly roleOptions = MEMBER_ROLES;

  public constructor() {
    this.form
      .get('organization')!
      .valueChanges.pipe(takeUntilDestroyed())
      .subscribe((name) => {
        const normalizedName = (name ?? '').trim();
        if (!normalizedName || normalizedName !== this.resolvedOrganizationName) {
          this.form.patchValue({ organization_id: null }, { emitEvent: false });
        }
      });
  }

  /** Append a searched person's email to the textarea (autofill convenience). */
  public addEmail(user: DecoratedCommitteeSearchResult): void {
    if (user.alreadyMember || user.alreadyInvited || user.added) {
      return;
    }
    const email = (user.email ?? '').trim();
    if (!email) {
      return;
    }
    const current = this.form.get('emails')!.value.trim();
    this.form.get('emails')!.setValue(current ? `${current}\n${email}` : email);
    this.searchForm.get('query')!.setValue('');

    // Pre-fill the org field from the selected user's current employer when shown and blank.
    if (this.showOrganizationField() && user.username && !this.form.get('organization')!.value?.trim()) {
      this.searchService
        .getUserCurrentEmployer(user.username)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe((employer) => {
          if (employer?.name && !this.form.get('organization')!.value?.trim()) {
            this.form.patchValue({ organization: employer.name });
          }
        });
    }
  }

  public onOrgResolved(result: OrganizationResolveResult): void {
    this.resolvedOrganizationName = result.name;
    this.form.patchValue({ organization_id: result.id || null });
  }

  public onCancel(): void {
    this.dialogRef.close(false);
  }

  /**
   * Pull the selected meeting's registrant emails into the email list (LFXV2-2607).
   * The BFF returns the full roster in one call (it auto-pages), so the imported
   * emails just flow through the existing parse/dedupe/preview and invite fan-out —
   * no invite logic is duplicated here.
   */
  public onImportFromMeeting(): void {
    const meetingId = this.importForm.get('meeting')!.value;
    if (!meetingId || this.importing()) {
      return;
    }

    this.importing.set(true);
    this.meetingService
      .getMeetingRegistrants(meetingId, false)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registrants) => this.applyImportedRegistrants(meetingId, registrants),
        error: () => {
          this.importing.set(false);
          this.importSummary.set(null);
          this.messageService.add({
            severity: 'warn',
            summary: 'Import Failed',
            detail: 'Could not load registrants for that meeting. Please try again.',
            life: 5000,
          });
        },
      });
  }

  public onSubmit(): void {
    const committeeId = this.committee?.uid;
    const emails = this.categorized().toInvite;
    if (!committeeId || emails.length === 0) {
      return;
    }

    this.submitting.set(true);
    const role = this.form.get('role')!.value || null;

    const fanOut = (organization: CommitteeOrganizationReference | null | undefined): void => {
      from(emails)
        .pipe(
          mergeMap(
            (email): Observable<CommitteeInviteResult> =>
              this.committeeService.createCommitteeInvite(committeeId, { invitee_email: email, role, organization }).pipe(
                map(() => ({ email, success: true })),
                catchError((err: HttpErrorResponse) => of({ email, success: false, reason: this.inviteFailureReason(err) }))
              ),
            COMMITTEE_INVITE_CONCURRENCY
          ),
          toArray(),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((results) => {
          this.submitting.set(false);
          this.summarize(results);
          if (results.some((r) => r.success)) {
            this.dialogRef.close(true);
          }
        });
    };

    if (this.showOrganizationField()) {
      const orgSearch = this.organizationSearch();
      const resolve$ = orgSearch ? orgSearch.resolveCurrentEntry() : of(null);
      resolve$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => {
          if (result) {
            this.resolvedOrganizationName = result.name;
            this.form.patchValue({ organization_id: result.id || null, organization: result.name });
          }
          fanOut(buildCommitteeOrganizationPayload(this.organizationFormValue()));
        },
      });
      return;
    }

    fanOut(undefined);
  }

  private organizationFormValue(): {
    organization: string;
    organization_url: string;
    organization_id: string | null;
  } {
    const raw = this.form.getRawValue();
    return {
      organization: raw.organization ?? '',
      organization_url: raw.organization_url ?? '',
      organization_id: raw.organization_id,
    };
  }

  private summarize(results: CommitteeInviteResult[]): void {
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (failed.length === 0) {
      this.messageService.add({
        severity: 'success',
        summary: 'Invitations Sent',
        detail: succeeded.length === 1 ? `Invited ${succeeded[0].email}.` : `Invited ${succeeded.length} people to the group.`,
      });
      return;
    }

    if (succeeded.length === 0) {
      this.messageService.add({
        severity: 'error',
        summary: 'Unable to Invite',
        detail: failed.length === 1 ? `Could not invite ${failed[0].email}: ${failed[0].reason}.` : `None of the ${failed.length} invitations could be sent.`,
        life: 6000,
      });
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: 'Some Invitations Failed',
      detail: `Invited ${succeeded.length} of ${results.length}. Could not invite: ${failed.map((f) => f.email).join(', ')}.`,
      life: 8000,
    });
  }

  private inviteFailureReason(err: HttpErrorResponse): string {
    if (err.status === 409) {
      return 'already invited or a member';
    }
    const upstream = typeof err.error?.message === 'string' ? err.error.message : null;
    return upstream ?? 'invite failed';
  }

  /**
   * Append imported emails not already listed to the emails textarea and report the outcome.
   * Filters against `parsed().valid` (already lowercased) so re-imports don't re-add rows and
   * the summary's "already listed" count is accurate.
   */
  private applyImportedRegistrants(meetingId: string, registrants: MeetingRegistrant[]): void {
    const { emails, skippedNoEmail } = extractRegistrantEmails(registrants);
    const meetingTitle = this.meetingOptions().find((option) => option.value === meetingId)?.title ?? 'the meeting';

    const alreadyListed = new Set(this.parsed().valid);
    const toAppend = emails.filter((email) => !alreadyListed.has(email.toLowerCase()));
    if (toAppend.length > 0) {
      const current = this.form.get('emails')!.value.trim();
      const appended = toAppend.join('\n');
      this.form.get('emails')!.setValue(current ? `${current}\n${appended}` : appended);
    }

    this.importSummary.set(this.buildImportSummary(meetingTitle, toAppend.length, emails.length - toAppend.length, skippedNoEmail));
    this.importForm.get('meeting')!.setValue(null);
    this.importing.set(false);
  }

  /** Compose the import result line: how many were added, already listed, and skipped for no email. */
  private buildImportSummary(meetingTitle: string, added: number, alreadyListed: number, skippedNoEmail: number): string {
    const parts: string[] = [added === 1 ? `Added 1 address from "${meetingTitle}"` : `Added ${added} addresses from "${meetingTitle}"`];
    if (alreadyListed > 0) {
      parts.push(`${alreadyListed} already listed`);
    }
    if (skippedNoEmail > 0) {
      parts.push(skippedNoEmail === 1 ? '1 registrant had no email and was skipped' : `${skippedNoEmail} registrants had no email and were skipped`);
    }
    return `${parts.join(' — ')}.`;
  }

  private initMeetingOptions(): Signal<MeetingSelectOption[]> {
    const projectUid = this.committee?.project_uid;
    if (!projectUid) {
      return signal<MeetingSelectOption[]>([]);
    }

    return toSignal(
      this.meetingService.getMeetingsByProject(projectUid).pipe(
        map((meetings) =>
          [...meetings]
            .sort((a, b) => this.meetingStartMs(b.start_time) - this.meetingStartMs(a.start_time))
            .map((meeting) => ({ value: meeting.id, label: this.buildMeetingLabel(meeting.title, meeting.start_time), title: meeting.title }))
        ),
        catchError(() => of([] as MeetingSelectOption[])),
        take(1)
      ),
      { initialValue: [] as MeetingSelectOption[] }
    );
  }

  /** Epoch ms for a meeting start, or 0 when missing/unparseable so the sort stays stable. */
  private meetingStartMs(startTime: string | null | undefined): number {
    if (!startTime) {
      return 0;
    }
    const ms = new Date(startTime).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }

  /** "<title> — <Mon D, YYYY>", or just the title when start_time is missing/unparseable. */
  private buildMeetingLabel(title: string, startTime: string | null | undefined): string {
    if (!startTime) {
      return title;
    }
    const date = new Date(startTime);
    if (Number.isNaN(date.getTime())) {
      return title;
    }
    return `${title} — ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  private initSearchResults(): Signal<DecoratedCommitteeSearchResult[]> {
    const rawResults = toSignal(
      this.searchForm.get('query')!.valueChanges.pipe(
        startWith(''),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (typeof q !== 'string' || q.trim().length < 2) {
            this.searchLoading.set(false);
            return of([] as UserSearchResult[]);
          }
          this.searchLoading.set(true);
          const trimmed = q.trim();
          return this.searchService.searchUsers(trimmed, 'committee_member').pipe(
            // Re-rank so name matches surface first and incidental email/alias matches are demoted (LFXV2-2058).
            map((users) => rankUserSearchResults(users, trimmed)),
            tap(() => this.searchLoading.set(false)),
            catchError(() => {
              this.searchLoading.set(false);
              this.messageService.add({
                severity: 'warn',
                summary: 'Search Unavailable',
                detail: 'Could not reach the user search service. Please try again.',
                life: 4000,
              });
              return of([] as UserSearchResult[]);
            })
          );
        })
      ),
      { initialValue: [] as UserSearchResult[] }
    );

    return computed(() => {
      const added = new Set(this.parsed().valid);
      const seen = new Set<string>();
      return rawResults()
        .filter((r) => {
          const key = (r.email ?? '').toLowerCase();
          if (!key || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .map((r) => {
          const email = (r.email ?? '').toLowerCase();
          return {
            ...r,
            added: added.has(email),
            alreadyMember: this.existingMemberEmails.has(email),
            alreadyInvited: this.existingInviteEmails.has(email),
            lfAccount: hasLfAccount(r),
          };
        });
    });
  }
}
