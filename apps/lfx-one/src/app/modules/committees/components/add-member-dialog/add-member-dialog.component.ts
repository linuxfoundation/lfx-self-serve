// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_INVITE_CONCURRENCY, MEMBER_ROLES } from '@lfx-one/shared/constants';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import {
  AddMemberDialogMode,
  CategorizedCommitteeEmails,
  Committee,
  CommitteeInvite,
  CommitteeInviteResult,
  CommitteeMember,
  CommitteeOrganizationReference,
  CreateCommitteeInviteRequest,
  CreateCommitteeMemberRequest,
  DecoratedCommitteeSearchResult,
  EmailListParseResult,
  MeetingRegistrant,
  MeetingSelectOption,
  OrganizationResolveResult,
  UserSearchResult,
} from '@lfx-one/shared/interfaces';
import {
  buildCommitteeOrganizationPayload,
  committeeOrganizationFormComplete,
  committeeRequiresOrganization,
  extractRegistrantEmails,
  hasLfAccount,
  normalizeToUrl,
  parseEmailList,
  rankUserSearchResults,
} from '@lfx-one/shared/utils';
import { UserAvatarColorPipe } from '@pipes/user-avatar-color.pipe';
import { UserInitialsPipe } from '@pipes/user-initials.pipe';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { SearchService } from '@services/search.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  expand,
  from,
  map,
  mergeMap,
  Observable,
  of,
  startWith,
  switchMap,
  take,
  tap,
  toArray,
} from 'rxjs';

interface DirectAddResult {
  email: string;
  success: boolean;
  reason?: string;
  inviteCleanupFailed?: boolean;
}

/**
 * Add people to a committee by email — single or bulk.
 *
 * Supports two modes (see {@link AddMemberDialogMode}):
 * - `direct-add` — writers add members immediately via POST /members (LFXV2-2690).
 * - `invite` — non-writer members in invite_only groups send email invites.
 *
 * The typeahead is a convenience for finding people already known to v2 and appending
 * their email — never a gate.
 */
@Component({
  selector: 'lfx-add-member-dialog',
  imports: [
    ReactiveFormsModule,
    NgClass,
    UserInitialsPipe,
    UserAvatarColorPipe,
    ButtonComponent,
    CheckboxComponent,
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
  /** Set by onCancel() — lets a still-pending async org resolution's collect-only close no-op. */
  private cancelled = false;

  public readonly committee: Committee | null = this.config.data?.committee ?? null;
  public readonly mode: AddMemberDialogMode = this.config.data?.mode ?? 'direct-add';
  public readonly isDirectAdd = computed(() => this.mode === 'direct-add');
  /**
   * Collect-only mode: instead of sending invites immediately (POST /invites), validate + build
   * the invite payloads and return them to the caller to stage. Used by the create-group wizard so
   * invites are only sent when the wizard is completed — cancelling sends nothing (LFXV2-2606).
   */
  public readonly collectOnly: boolean = this.config.data?.collectOnly ?? false;
  /** True when the committee requires organization (voting or business email). */
  public readonly showOrganizationField = computed(() => (this.committee ? committeeRequiresOrganization(this.committee) : false));
  /** Direct-add must include a valid organization before members can be created upstream. */
  public readonly organizationRequiredForDirectAdd = computed(() => this.showOrganizationField() && this.isDirectAdd());
  private readonly existingMemberEmails = new Set<string>(
    ((this.config.data?.existingMembers as CommitteeMember[]) ?? []).map((m) => (m.email ?? '').trim().toLowerCase()).filter(Boolean)
  );
  private readonly existingInviteEmails = new Set<string>(
    ((this.config.data?.existingInvites as CommitteeInvite[]) ?? []).map((i) => (i.invitee_email ?? '').trim().toLowerCase()).filter(Boolean)
  );
  /** Pending invite UID by email — used to revoke stale invites after admin direct-add. */
  private readonly pendingInviteUidByEmail = new Map<string, string>(
    ((this.config.data?.existingInvites as CommitteeInvite[]) ?? [])
      .filter((invite) => (invite.status ?? '').toLowerCase() === 'pending')
      .flatMap((invite) => {
        const email = (invite.invitee_email ?? '').trim().toLowerCase();
        return email && invite.uid ? [[email, invite.uid] as const] : [];
      })
  );

  public readonly form = new FormGroup({
    emails: new FormControl<string>('', { nonNullable: true }),
    role: new FormControl<string | null>(null),
    organization: new FormControl(''),
    organization_url: new FormControl(''),
    organization_id: new FormControl<string | null>(null),
    send_notification: new FormControl<boolean>(false, { nonNullable: true }),
  });
  public readonly searchForm = new FormGroup({ query: new FormControl('') });
  /** Picker for "import registrants from a meeting" (LFXV2-2607). */
  public readonly importForm = new FormGroup({ meeting: new FormControl<string | null>(null) });

  public submitting = signal(false);
  public searchLoading = signal(false);
  public importing = signal(false);
  /** Human-readable outcome of the last import, shown under the picker. */
  public importSummary = signal<string | null>(null);
  private readonly orgSubmitAttempted = signal(false);

  private readonly rawEmails = toSignal(this.form.get('emails')!.valueChanges.pipe(startWith(this.form.get('emails')!.value)), { initialValue: '' });
  private readonly orgFormValues = this.initOrgFormValues();
  private readonly orgUrlStatus = toSignal(this.form.get('organization_url')!.statusChanges.pipe(startWith(this.form.get('organization_url')!.status)), {
    initialValue: this.form.get('organization_url')!.status,
  });

  public readonly parsed: Signal<EmailListParseResult> = computed(() => parseEmailList(this.rawEmails()));
  public readonly categorized: Signal<CategorizedCommitteeEmails> = computed(() => {
    const result: CategorizedCommitteeEmails = { toInvite: [], alreadyMembers: [], alreadyInvited: [] };
    const skipPendingInvites = this.isDirectAdd();
    for (const email of this.parsed().valid) {
      if (this.existingMemberEmails.has(email)) {
        result.alreadyMembers.push(email);
      } else if (!skipPendingInvites && this.existingInviteEmails.has(email)) {
        result.alreadyInvited.push(email);
      } else {
        result.toInvite.push(email);
      }
    }
    return result;
  });
  /** Org-required direct-add uses one shared organization field — bulk add would mis-assign employers. */
  public readonly directAddRequiresSingleEmail = computed(() => this.organizationRequiredForDirectAdd() && this.categorized().toInvite.length > 1);
  public readonly canSubmit = computed(
    () =>
      !this.submitting() &&
      this.categorized().toInvite.length > 0 &&
      !this.directAddRequiresSingleEmail() &&
      !(this.showOrganizationField() && this.orgInvalid())
  );
  public readonly orgInvalid: Signal<boolean> = this.initOrgInvalid();
  public readonly showOrgError: Signal<boolean> = this.initShowOrgError();
  public readonly orgErrorMessage: Signal<string | null> = this.initOrgErrorMessage();
  /** Comma-joined invalid tokens for the preview — precomputed so the template reads a signal, not a function call. */
  public readonly invalidSummary = computed(() => this.parsed().invalid.join(', '));
  /** Submit button copy — three distinct destinations (stage / add directly / send invite), so not a single ternary. */
  public readonly submitLabel = computed(() => {
    if (this.collectOnly) {
      return 'Add to invitations';
    }
    return this.isDirectAdd() ? 'Add Members' : 'Send Invites';
  });
  public readonly submitIcon = computed(() => {
    if (this.collectOnly) {
      return 'fa-light fa-list-check';
    }
    return this.isDirectAdd() ? 'fa-light fa-user-plus' : 'fa-light fa-paper-plane';
  });

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
        if (this.organizationSearch()?.manualMode()) return;
        const normalizedName = (name ?? '').trim();
        if (!normalizedName || normalizedName !== this.resolvedOrganizationName) {
          this.resolvedOrganizationName = '';
          this.form.patchValue({ organization_id: null, organization_url: '' });
        }
      });
  }

  /** Append a searched person's email to the textarea (autofill convenience). */
  public addEmail(user: DecoratedCommitteeSearchResult): void {
    if (user.alreadyMember || user.added || (!this.isDirectAdd() && user.alreadyInvited)) {
      return;
    }
    const email = (user.email ?? '').trim();
    if (!email) {
      return;
    }
    const current = this.form.get('emails')!.value.trim();
    this.form.get('emails')!.setValue(current ? `${current}\n${email}` : email);
    this.searchForm.get('query')!.setValue('');

    // Pre-fill organization from search result / profile when the field is shown.
    if (this.showOrganizationField()) {
      const searchOrg = user.organization;
      if (!this.form.get('organization')!.value?.trim() && searchOrg?.name) {
        this.prefillOrganization(searchOrg.name, searchOrg.website);
      }
      if (user.username && !committeeOrganizationFormComplete(this.organizationFormValue())) {
        this.searchService
          .getUserCurrentEmployer(user.username)
          .pipe(take(1), takeUntilDestroyed(this.destroyRef))
          .subscribe((employer) => {
            if (!employer?.name) {
              return;
            }
            if (!this.form.get('organization')!.value?.trim()) {
              this.prefillOrganization(employer.name, employer.website);
              return;
            }
            if (!committeeOrganizationFormComplete(this.organizationFormValue()) && employer.website) {
              const normalizedUrl = normalizeToUrl(employer.website) ?? employer.website.trim();
              this.form.patchValue({ organization_url: normalizedUrl });
            }
          });
      }
    }
  }

  public onOrgResolved(result: OrganizationResolveResult): void {
    this.resolvedOrganizationName = result.name;
    this.form.patchValue({ organization_id: result.id || null });
  }

  public onCancel(): void {
    // Collect-only submit can still be mid-flight (awaiting async org resolution) when Cancel is
    // clicked — dialogRef.close(false) here would otherwise be silently followed by a second,
    // ignored close(staged) once resolution finishes, discarding the staged invites with no
    // feedback. Guard that late close instead of re-disabling Cancel (see onSubmit's comment).
    this.cancelled = true;
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
      .getMeetingRegistrants(meetingId, false, undefined, true)
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
    // Immediate mode POSTs to a committee, so it needs one; collect mode only stages payloads.
    if ((!this.collectOnly && !committeeId) || emails.length === 0) {
      return;
    }

    if (this.organizationRequiredForDirectAdd() && emails.length > 1) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Add one member at a time',
        detail: 'This group requires an organization for each member. Add people individually so each organization is recorded correctly.',
        life: 6000,
      });
      return;
    }

    if (this.showOrganizationField()) {
      this.orgSubmitAttempted.set(true);
      this.form.get('organization')?.markAsTouched();
      if (this.organizationSearch()?.manualMode()) {
        this.form.get('organization_url')?.markAsTouched();
      }
      if (this.orgInvalid()) {
        return;
      }
    }

    // Disable the submit button up front — org resolution below is async, and leaving it enabled
    // during that window allows a double-click that fires a second resolve → invite chain. Cancel
    // stays enabled in collect-only mode (see the template) so the dialog is never unresponsive —
    // but if the user cancels while org resolution below is still pending, the collect-only close
    // in complete() below must no-op (see the `cancelled` guard) rather than staging after the
    // dialog already closed. Cancel stays disabled while submitting in the immediate-send modes,
    // since canceling mid-flight can abort in-progress member/invite POSTs after some have already
    // succeeded, with no summary toast and no parent refresh.
    this.submitting.set(true);
    const role = this.form.get('role')!.value || null;

    const complete = (organization: CommitteeOrganizationReference | null | undefined): void => {
      // Collect-only: return the built invites for the caller to stage; do not send them now.
      if (this.collectOnly) {
        if (this.cancelled) {
          return;
        }
        const staged: CreateCommitteeInviteRequest[] = emails.map((email) => ({ invitee_email: email, role, organization: organization ?? null }));
        this.dialogRef.close(staged);
        return;
      }

      if (this.isDirectAdd()) {
        this.fanOutDirectAdd(committeeId!, emails, role, organization);
        return;
      }
      this.fanOutInvites(committeeId!, emails, role, organization);
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
          const formValue = this.organizationFormValue();
          if (this.organizationRequiredForDirectAdd() && !committeeOrganizationFormComplete(formValue)) {
            this.orgSubmitAttempted.set(true);
            this.submitting.set(false);
            return;
          }
          complete(buildCommitteeOrganizationPayload(formValue));
        },
      });
      return;
    }

    complete(undefined);
  }

  private fanOutDirectAdd(committeeId: string, emails: string[], role: string | null, organization: CommitteeOrganizationReference | null | undefined): void {
    const skipNotification = !this.form.get('send_notification')!.value;

    from(emails)
      .pipe(
        mergeMap((email): Observable<DirectAddResult> => {
          const memberData: CreateCommitteeMemberRequest = { email };
          if (role) {
            memberData.role = { name: role as CommitteeMemberRole };
          }
          if (organization) {
            memberData.organization = organization;
          }
          return this.committeeService.createCommitteeMember(committeeId, memberData, { skipNotification }).pipe(
            switchMap(() => {
              const inviteUid = this.pendingInviteUidByEmail.get(email.toLowerCase());
              if (!inviteUid) {
                return of({ email, success: true, inviteCleanupFailed: false } satisfies DirectAddResult);
              }
              // Reconcile stale pending invite so the roster does not show member + invite.
              return this.committeeService.revokeCommitteeInvite(committeeId, inviteUid).pipe(
                map(() => ({ email, success: true, inviteCleanupFailed: false }) satisfies DirectAddResult),
                catchError(() => of({ email, success: true, inviteCleanupFailed: true } satisfies DirectAddResult))
              );
            }),
            catchError((err: HttpErrorResponse) => of({ email, success: false, reason: this.directAddFailureReason(err) } satisfies DirectAddResult))
          );
        }, COMMITTEE_INVITE_CONCURRENCY),
        toArray(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((results) => {
        this.submitting.set(false);
        this.summarizeDirectAdd(results);
        if (results.some((r) => r.success)) {
          this.dialogRef.close(true);
        }
      });
  }

  private fanOutInvites(committeeId: string, emails: string[], role: string | null, organization: CommitteeOrganizationReference | null | undefined): void {
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
        this.summarizeInvites(results);
        if (results.some((r) => r.success)) {
          this.dialogRef.close(true);
        }
      });
  }

  private summarizeDirectAdd(results: DirectAddResult[]): void {
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const cleanupFailed = succeeded.filter((r) => r.inviteCleanupFailed);

    if (failed.length === 0) {
      this.messageService.add({
        severity: 'success',
        summary: 'Members Added',
        detail: succeeded.length === 1 ? `Added ${succeeded[0].email}.` : `Added ${succeeded.length} people to the group.`,
      });
    } else if (succeeded.length === 0) {
      this.messageService.add({
        severity: 'error',
        summary: 'Unable to Add',
        detail: failed.length === 1 ? `Could not add ${failed[0].email}: ${failed[0].reason}.` : `None of the ${failed.length} members could be added.`,
        life: 6000,
      });
    } else {
      this.messageService.add({
        severity: 'warn',
        summary: 'Some Adds Failed',
        detail: `Added ${succeeded.length} of ${results.length}. Could not add: ${failed.map((f) => f.email).join(', ')}.`,
        life: 8000,
      });
    }

    this.warnInviteCleanupFailures(cleanupFailed);
  }

  private warnInviteCleanupFailures(cleanupFailed: DirectAddResult[]): void {
    if (cleanupFailed.length === 0) {
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: 'Invite Cleanup Failed',
      detail:
        cleanupFailed.length === 1
          ? `Added ${cleanupFailed[0].email}, but could not remove their stale invitation.`
          : `Added ${cleanupFailed.length} people, but could not remove stale invitations for: ${cleanupFailed.map((r) => r.email).join(', ')}.`,
      life: 8000,
    });
  }

  private summarizeInvites(results: CommitteeInviteResult[]): void {
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

  private directAddFailureReason(err: HttpErrorResponse): string {
    if (err.status === 409) {
      return 'already a member';
    }
    return extractErrorMessage(err, 'add failed');
  }

  private inviteFailureReason(err: HttpErrorResponse): string {
    if (err.status === 409) {
      return 'already invited or a member';
    }
    const upstream = typeof err.error?.message === 'string' ? err.error.message : null;
    return upstream ?? 'invite failed';
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

  private initOrgFormValues() {
    return toSignal(this.form.valueChanges.pipe(startWith(this.form.value)), { initialValue: this.form.value });
  }

  private initOrgInvalid(): Signal<boolean> {
    return computed(() => {
      if (!this.showOrganizationField()) {
        return false;
      }

      const required = this.organizationRequiredForDirectAdd();
      const formValue = this.organizationFormValue();
      const hasName = !!formValue.organization.trim();
      const pendingSearch = this.organizationSearch()?.searchTerm() ?? '';

      if (this.organizationSearch()?.manualMode()) {
        if (required && !hasName) {
          return true;
        }
        return this.orgUrlStatus() === 'INVALID';
      }

      if (!hasName && pendingSearch) {
        return true;
      }
      if (!hasName) {
        return required;
      }

      return !committeeOrganizationFormComplete(formValue);
    });
  }

  private initShowOrgError(): Signal<boolean> {
    return computed(() => {
      if (!this.orgInvalid()) {
        return false;
      }
      if (this.orgSubmitAttempted()) {
        return true;
      }
      if (this.organizationSearch()?.manualMode()) {
        return false;
      }
      const hasName = !!(this.orgFormValues().organization ?? '').trim();
      return !hasName && !!(this.organizationSearch()?.searchTerm() ?? '');
    });
  }

  private initOrgErrorMessage(): Signal<string | null> {
    return computed(() => {
      if (!this.showOrgError()) {
        return null;
      }
      const formValue = this.organizationFormValue();
      if (this.organizationRequiredForDirectAdd() && !formValue.organization.trim()) {
        return 'Organization is required. Search for an organization or enter the name and website.';
      }
      if (this.organizationSearch()?.manualMode()) {
        return 'Enter the organization name and a valid https:// website.';
      }
      return 'Select an organization from the search results, or enter the name and website.';
    });
  }

  private prefillOrganization(name: string, website?: string | null): void {
    const trimmedName = name.trim();
    const normalizedUrl = website ? (normalizeToUrl(website) ?? website.trim()) : '';
    this.resolvedOrganizationName = trimmedName;
    this.form.patchValue({
      organization: trimmedName,
      organization_id: null,
      organization_url: normalizedUrl,
    });
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

    const fetchPage = (pageToken?: string) => this.meetingService.getMeetingsByProjectPaginated(projectUid, undefined, pageToken);

    return toSignal(
      fetchPage().pipe(
        expand((response) => (response.page_token ? fetchPage(response.page_token) : EMPTY)),
        toArray(),
        map((responses) =>
          responses
            .flatMap((response) => response.data)
            .sort((a, b) => this.meetingStartMs(b.start_time) - this.meetingStartMs(a.start_time))
            .map((meeting) => ({ value: meeting.id, label: this.buildMeetingLabel(meeting.title, meeting.start_time), title: meeting.title }))
        ),
        catchError(() => of([] as MeetingSelectOption[]))
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
            alreadyInvited: !this.isDirectAdd() && this.existingInviteEmails.has(email),
            lfAccount: hasLfAccount(r),
          };
        });
    });
  }
}
