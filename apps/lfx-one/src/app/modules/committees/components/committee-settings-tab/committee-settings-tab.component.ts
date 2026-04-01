// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { Committee, GroupsIOMailingList, JoinMode } from '@lfx-one/shared/interfaces';
import { CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import { CommitteeService } from '@services/committee.service';
import { MailingListService } from '@services/mailing-list.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { catchError, filter, finalize, of, switchMap, take } from 'rxjs';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { CommitteeSettingsComponent } from '../committee-settings/committee-settings.component';
import { MailingListPickerDialogResult } from '@lfx-one/shared/interfaces';
import { MailingListPickerDialogComponent } from '../mailing-list-picker-dialog/mailing-list-picker-dialog.component';
import { MailingListEmailPipe } from './pipes/mailing-list-email.pipe';

@Component({
  selector: 'lfx-committee-settings-tab',
  imports: [CommitteeSettingsComponent, ButtonComponent, ReactiveFormsModule, ConfirmDialogModule],
  providers: [DialogService],
  templateUrl: './committee-settings-tab.component.html',
  styleUrl: './committee-settings-tab.component.scss',
})
export class CommitteeSettingsTabComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly mailingListEmailPipe = new MailingListEmailPipe();

  // Inputs
  public committee = input.required<Committee>();

  // Outputs
  public readonly committeeUpdated = output<void>();

  // State
  public saving = signal(false);
  public deleting = signal(false);
  public savingMl = signal(false);
  public mlLoading = signal(false);

  // Form
  public form = new FormGroup({
    member_visibility: new FormControl(''),
    join_mode: new FormControl(''),
    business_email_required: new FormControl(false),
    enable_voting: new FormControl(false),
    is_audit_enabled: new FormControl(false),
    public: new FormControl(false),
    sso_group_enabled: new FormControl(false),
    show_meeting_attendees: new FormControl(false),
    chat_channel: new FormControl<string | null>(null),
    website: new FormControl<string | null>(null),
  });

  // Project mailing lists (loaded when committee has a project_uid)
  public projectMailingLists: Signal<GroupsIOMailingList[]> = this.initProjectMailingLists();

  // Currently linked mailing list (matched by email)
  public linkedMailingList: Signal<GroupsIOMailingList | null> = computed(() => {
    const email = this.committee().mailing_list;
    if (!email) return null;
    return this.projectMailingLists().find((ml) => this.mailingListEmailPipe.transform(ml) === email) ?? null;
  });

  public constructor() {
    toObservable(this.committee)
      .pipe(
        filter((c): c is Committee => !!c),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((c) => {
        this.form.patchValue({
          member_visibility: c.member_visibility || 'hidden',
          join_mode: c.join_mode || 'invite_only',
          business_email_required: c.business_email_required || false,
          enable_voting: c.enable_voting || false,
          is_audit_enabled: c.is_audit_enabled || false,
          public: c.public || false,
          sso_group_enabled: c.sso_group_enabled || false,
          show_meeting_attendees: c.show_meeting_attendees || false,
          chat_channel: c.chat_channel ?? null,
          website: c.website ?? null,
        });
      });
  }

  public openMailingListPicker(): void {
    const linked = this.linkedMailingList();

    const ref = this.dialogService.open(MailingListPickerDialogComponent, {
      header: 'Associated Mailing List',
      width: '640px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: {
        mailingLists: this.projectMailingLists(),
        selectedUid: linked?.uid ?? null,
        loading: this.mlLoading(),
      },
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1)).subscribe((result: MailingListPickerDialogResult | null) => {
      if (result) {
        this.saveMailingListAssociation(result.selectedUid);
      }
    });
  }

  public confirmDelete(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to permanently delete "${this.committee().name}"? This will remove all associated meetings, votes, surveys, and member records. This action cannot be undone.`,
      header: 'Delete Group',
      icon: 'fa-light fa-triangle-exclamation',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-outlined p-button-sm',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.deleting.set(true);
        this.committeeService
          .deleteCommittee(this.committee().uid)
          .pipe(finalize(() => this.deleting.set(false)))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `"${this.committee().name}" has been deleted` });
              this.router.navigate(['/groups']);
            },
            error: () => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete group' });
            },
          });
      },
    });
  }

  public saveSettings(): void {
    this.saving.set(true);
    const values = this.form.getRawValue();
    this.committeeService
      .updateCommittee(this.committee().uid, {
        member_visibility: (values.member_visibility as CommitteeMemberVisibility) || undefined,
        join_mode: (values.join_mode as JoinMode) || undefined,
        business_email_required: values.business_email_required ?? false,
        enable_voting: values.enable_voting ?? false,
        is_audit_enabled: values.is_audit_enabled ?? false,
        public: values.public ?? false,
        sso_group_enabled: values.sso_group_enabled ?? false,
        show_meeting_attendees: values.show_meeting_attendees ?? false,
        chat_channel: values.chat_channel || null,
        website: values.website || null,
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Settings saved' });
          this.committeeUpdated.emit();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save settings' });
        },
      });
  }

  // -- Private helpers --
  private saveMailingListAssociation(uid: string | null): void {
    const committee = this.committee();
    if (!committee?.uid) return;

    const selectedList = uid ? (this.projectMailingLists().find((ml) => ml.uid === uid) ?? null) : null;
    const emailValue = selectedList ? this.mailingListEmailPipe.transform(selectedList) : null;

    // Guard: upstream service requires a valid email (group_name@domain)
    if (emailValue && !emailValue.includes('@')) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Selected mailing list has no associated domain and cannot be linked.' });
      return;
    }

    this.savingMl.set(true);
    this.committeeService
      .updateCommittee(committee.uid, { mailing_list: emailValue })
      .pipe(finalize(() => this.savingMl.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Mailing list association updated' });
          this.committeeUpdated.emit();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update mailing list association' });
        },
      });
  }

  private initProjectMailingLists(): Signal<GroupsIOMailingList[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        switchMap((c) => {
          if (!c?.project_uid) return of([] as GroupsIOMailingList[]);
          this.mlLoading.set(true);
          return this.mailingListService.getMailingListsByProject(c.project_uid).pipe(
            catchError(() => of([] as GroupsIOMailingList[])),
            finalize(() => this.mlLoading.set(false))
          );
        })
      ),
      { initialValue: [] as GroupsIOMailingList[] }
    );
  }
}
