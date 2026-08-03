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
  CreateCommitteeMemberRequest,
  DecoratedCommitteeSearchResult,
  EmailListParseResult,
  OrganizationResolveResult,
  UserSearchResult,
} from '@lfx-one/shared/interfaces';
import {
  buildCommitteeOrganizationPayload,
  committeeOrganizationFormComplete,
  committeeRequiresOrganization,
  hasLfAccount,
  normalizeToUrl,
  parseEmailList,
  rankUserSearchResults,
} from '@lfx-one/shared/utils';
import { UserAvatarColorPipe } from '@pipes/user-avatar-color.pipe';
import { UserInitialsPipe } from '@pipes/user-initials.pipe';
import { CommitteeService } from '@services/committee.service';
import { SearchService } from '@services/search.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, from, map, mergeMap, Observable, of, startWith, switchMap, take, tap, toArray } from 'rxjs';

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
  private readonly searchService = inject(SearchService);
  private readonly messageService = inject(MessageService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  private readonly organizationSearch = viewChild(OrganizationSearchComponent);
  private resolvedOrganizationName = '';

  public readonly committee: Committee | null = this.config.data?.committee ?? null;
  public readonly mode: AddMemberDialogMode = this.config.data?.mode ?? 'direct-add';
  public readonly isDirectAdd = computed(() => this.mode === 'direct-add');
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
    send_notification: new FormControl<boolean>(true, { nonNullable: true }),
  });
  public readonly searchForm = new FormGroup({ query: new FormControl('') });

  public submitting = signal(false);
  public searchLoading = signal(false);
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
  public readonly canSubmit = computed(
    () => !this.submitting() && this.categorized().toInvite.length > 0 && !(this.showOrganizationField() && this.orgInvalid())
  );
  public readonly orgInvalid: Signal<boolean> = this.initOrgInvalid();
  public readonly showOrgError: Signal<boolean> = this.initShowOrgError();
  public readonly orgErrorMessage: Signal<string | null> = this.initOrgErrorMessage();
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
    this.dialogRef.close(false);
  }

  public onSubmit(): void {
    const committeeId = this.committee?.uid;
    const emails = this.categorized().toInvite;
    if (!committeeId || emails.length === 0) {
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

    this.submitting.set(true);
    const role = this.form.get('role')!.value || null;

    const fanOut = (organization: CommitteeOrganizationReference | null | undefined): void => {
      if (this.isDirectAdd()) {
        this.fanOutDirectAdd(committeeId, emails, role, organization);
        return;
      }
      this.fanOutInvites(committeeId, emails, role, organization);
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
          fanOut(buildCommitteeOrganizationPayload(formValue));
        },
      });
      return;
    }

    fanOut(undefined);
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
