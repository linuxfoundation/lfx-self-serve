// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { ADD_MEMBER_ACTION_OPTIONS, COMMITTEE_INVITE_CONCURRENCY, MEMBER_ROLES } from '@lfx-one/shared/constants';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import {
  AddMemberActionMode,
  CategorizedCommitteeEmails,
  Committee,
  CommitteeInvite,
  CommitteeInviteResult,
  CommitteeMember,
  CreateCommitteeMemberRequest,
  DecoratedCommitteeSearchResult,
  EmailListParseResult,
  UserSearchResult,
} from '@lfx-one/shared/interfaces';
import { hasLfAccount, parseEmailList, rankUserSearchResults } from '@lfx-one/shared/utils';
import { UserAvatarColorPipe } from '@pipes/user-avatar-color.pipe';
import { UserInitialsPipe } from '@pipes/user-initials.pipe';
import { CommitteeService } from '@services/committee.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, from, map, mergeMap, Observable, of, startWith, switchMap, tap, toArray } from 'rxjs';

/**
 * Add people to a committee by email — single or bulk.
 *
 * Writers choose between adding directly to the roster (`createCommitteeMember`) or
 * sending a pending invite (`createCommitteeInvite`). The typeahead appends known
 * emails from search; it is never a gate.
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
    SelectButtonComponent,
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

  /** Search hits keyed by normalized email — used to enrich direct-add payloads. */
  private readonly emailProfiles = signal<Map<string, UserSearchResult>>(new Map());

  public readonly form = new FormGroup({
    actionMode: new FormControl<AddMemberActionMode>('add_directly', { nonNullable: true }),
    emails: new FormControl<string>('', { nonNullable: true }),
    role: new FormControl<string | null>(null),
  });
  public readonly searchForm = new FormGroup({ query: new FormControl('') });

  public submitting = signal(false);
  public searchLoading = signal(false);

  public readonly actionModeOptions = [...ADD_MEMBER_ACTION_OPTIONS];

  private readonly rawEmails = toSignal(this.form.get('emails')!.valueChanges.pipe(startWith(this.form.get('emails')!.value)), { initialValue: '' });
  public readonly actionMode = toSignal(this.form.get('actionMode')!.valueChanges.pipe(startWith(this.form.get('actionMode')!.value)), {
    initialValue: 'add_directly' as AddMemberActionMode,
  });

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
  public readonly invalidSummary = computed(() => this.parsed().invalid.join(', '));
  public readonly submitLabel = computed(() => {
    const count = this.categorized().toInvite.length;
    if (this.actionMode() === 'invite') {
      return count === 1 ? 'Send Invite' : 'Send Invites';
    }
    return count === 1 ? 'Add Member' : 'Add Members';
  });
  public readonly submitIcon = computed(() => (this.actionMode() === 'invite' ? 'fa-light fa-paper-plane' : 'fa-light fa-user-plus'));

  public readonly queryValue = toSignal(
    this.searchForm.get('query')!.valueChanges.pipe(
      startWith(''),
      map((v) => (v ?? '').trim())
    ),
    { initialValue: '' }
  );
  public searchResults: Signal<DecoratedCommitteeSearchResult[]> = this.initSearchResults();

  public readonly roleOptions = MEMBER_ROLES;

  /** Append a searched person's email to the textarea (autofill convenience). */
  public addEmail(user: DecoratedCommitteeSearchResult): void {
    if (user.alreadyMember || user.alreadyInvited || user.added) {
      return;
    }
    const email = (user.email ?? '').trim();
    if (!email) {
      return;
    }
    const normalized = email.toLowerCase();
    const profiles = new Map(this.emailProfiles());
    profiles.set(normalized, user);
    this.emailProfiles.set(profiles);

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

    if (this.actionMode() === 'invite') {
      this.submitInvites(committeeId, emails);
      return;
    }

    this.submitDirectAdds(committeeId, emails);
  }

  private submitInvites(committeeId: string, emails: string[]): void {
    this.submitting.set(true);
    const role = this.form.get('role')!.value || null;

    from(emails)
      .pipe(
        mergeMap(
          (email): Observable<CommitteeInviteResult> =>
            this.committeeService.createCommitteeInvite(committeeId, { invitee_email: email, role }).pipe(
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
        this.summarizeInviteResults(results);
        if (results.some((r) => r.success)) {
          this.dialogRef.close(true);
        }
      });
  }

  private submitDirectAdds(committeeId: string, emails: string[]): void {
    this.submitting.set(true);
    const role = this.form.get('role')!.value || null;

    from(emails)
      .pipe(
        mergeMap(
          (email): Observable<CommitteeInviteResult> =>
            this.committeeService.createCommitteeMember(committeeId, this.buildMemberRequest(email, role)).pipe(
              map(() => ({ email, success: true })),
              catchError((err: HttpErrorResponse) => of({ email, success: false, reason: this.addFailureReason(err) }))
            ),
          COMMITTEE_INVITE_CONCURRENCY
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((results) => {
        this.submitting.set(false);
        this.summarizeAddResults(results);
        if (results.some((r) => r.success)) {
          this.dialogRef.close(true);
        }
      });
  }

  private buildMemberRequest(email: string, role: string | null): CreateCommitteeMemberRequest {
    const profile = this.emailProfiles().get(email);
    return {
      email,
      username: profile?.username ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      job_title: profile?.job_title ?? null,
      role: role ? { name: role as CommitteeMemberRole, start_date: null, end_date: null } : null,
    };
  }

  private summarizeInviteResults(results: CommitteeInviteResult[]): void {
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

  private summarizeAddResults(results: CommitteeInviteResult[]): void {
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (failed.length === 0) {
      this.messageService.add({
        severity: 'success',
        summary: 'Members Added',
        detail: succeeded.length === 1 ? `Added ${succeeded[0].email} to the group.` : `Added ${succeeded.length} people to the group.`,
      });
      return;
    }

    if (succeeded.length === 0) {
      this.messageService.add({
        severity: 'error',
        summary: 'Unable to Add Members',
        detail: failed.length === 1 ? `Could not add ${failed[0].email}: ${failed[0].reason}.` : `None of the ${failed.length} members could be added.`,
        life: 6000,
      });
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: 'Some Members Not Added',
      detail: `Added ${succeeded.length} of ${results.length}. Could not add: ${failed.map((f) => f.email).join(', ')}.`,
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

  private addFailureReason(err: HttpErrorResponse): string {
    if (err.status === 409) {
      return 'already a member';
    }
    const upstream = typeof err.error?.message === 'string' ? err.error.message : null;
    return upstream ?? 'add failed';
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
            alreadyInvited: this.existingInviteEmails.has(email),
            lfAccount: hasLfAccount(r),
          };
        });
    });
  }
}
