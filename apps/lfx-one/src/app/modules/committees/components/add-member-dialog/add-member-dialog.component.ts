// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MEMBER_ROLES } from '@lfx-one/shared/constants';
import { Committee, CommitteeInvite, CommitteeInviteResult, CommitteeMember, EmailListParseResult, UserSearchResult } from '@lfx-one/shared/interfaces';
import { hasLfAccount, parseEmailList, rankUserSearchResults } from '@lfx-one/shared/utils';
import { UserAvatarColorPipe } from '@pipes/user-avatar-color.pipe';
import { UserInitialsPipe } from '@pipes/user-initials.pipe';
import { CommitteeService } from '@services/committee.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, from, map, mergeMap, Observable, of, startWith, switchMap, tap, toArray } from 'rxjs';

/** A search hit decorated for the typeahead: whether it's already added/member/invited and has an LF account. */
type DecoratedResult = UserSearchResult & { added: boolean; alreadyMember: boolean; alreadyInvited: boolean; lfAccount: boolean };

/** Parsed valid emails partitioned by what the submit action will do with each. */
interface CategorizedEmails {
  /** Emails that will be invited (not already a member or pending invite). */
  toInvite: string[];
  /** Emails skipped because the person is already a member. */
  alreadyMembers: string[];
  /** Emails skipped because a pending invite already exists. */
  alreadyInvited: string[];
}

/** Max concurrent create-invite requests when fanning out a bulk invite. */
const INVITE_CONCURRENCY = 5;

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

  public readonly committee: Committee | null = this.config.data?.committee ?? null;
  private readonly existingMemberEmails = new Set<string>(
    ((this.config.data?.existingMembers as CommitteeMember[]) ?? []).map((m) => (m.email ?? '').trim().toLowerCase()).filter(Boolean)
  );
  private readonly existingInviteEmails = new Set<string>(
    ((this.config.data?.existingInvites as CommitteeInvite[]) ?? []).map((i) => (i.invitee_email ?? '').trim().toLowerCase()).filter(Boolean)
  );

  public readonly form = new FormGroup({
    emails: new FormControl<string>('', { nonNullable: true }),
    role: new FormControl<string | null>(null),
  });
  public readonly searchForm = new FormGroup({ query: new FormControl('') });

  public submitting = signal(false);
  public searchLoading = signal(false);

  private readonly rawEmails = toSignal(this.form.get('emails')!.valueChanges.pipe(startWith(this.form.get('emails')!.value)), { initialValue: '' });

  public readonly parsed: Signal<EmailListParseResult> = computed(() => parseEmailList(this.rawEmails()));
  public readonly categorized: Signal<CategorizedEmails> = computed(() => {
    const result: CategorizedEmails = { toInvite: [], alreadyMembers: [], alreadyInvited: [] };
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

  public readonly queryValue = toSignal(
    this.searchForm.get('query')!.valueChanges.pipe(
      startWith(''),
      map((v) => (v ?? '').trim())
    ),
    { initialValue: '' }
  );
  public searchResults: Signal<DecoratedResult[]> = this.initSearchResults();

  public readonly roleOptions = MEMBER_ROLES;

  /** Append a searched person's email to the textarea (autofill convenience). */
  public addEmail(user: DecoratedResult): void {
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

    this.submitting.set(true);
    const role = this.form.get('role')!.value || null;

    // No bulk endpoint upstream — fan out one create-invite per email with bounded
    // concurrency, catching per-email so one failure never aborts the rest.
    from(emails)
      .pipe(
        mergeMap(
          (email): Observable<CommitteeInviteResult> =>
            this.committeeService.createCommitteeInvite(committeeId, { invitee_email: email, role }).pipe(
              map(() => ({ email, success: true })),
              catchError((err: HttpErrorResponse) => of({ email, success: false, reason: this.inviteFailureReason(err) }))
            ),
          INVITE_CONCURRENCY
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

  private initSearchResults(): Signal<DecoratedResult[]> {
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
