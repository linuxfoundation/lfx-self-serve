// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, CreateMailingListRequest, GroupsIOMailingList, JoinMode, MailingListPickerDialogResult, ValidationError } from '@lfx-one/shared/interfaces';
import { CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import { SLACK_INCOMING_WEBHOOK_URL_PATTERN } from '@lfx-one/shared/constants';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, filter, finalize, forkJoin, map, merge, Observable, of, Subject, switchMap, take } from 'rxjs';

import { MailingListPickerDialogComponent } from '../mailing-list-picker-dialog/mailing-list-picker-dialog.component';
import { CommitteeSettingsComponent } from '../committee-settings/committee-settings.component';
import { MailingListEmailPipe } from '../../pipes/mailing-list-email.pipe';
import { MailingListTypePipe } from './pipes/mailing-list-type.pipe';

@Component({
  selector: 'lfx-committee-settings-tab',
  imports: [CommitteeSettingsComponent, ButtonComponent, TagComponent, ConfirmDialogModule, MailingListEmailPipe, MailingListTypePipe],
  providers: [DialogService],
  templateUrl: './committee-settings-tab.component.html',
  styleUrl: './committee-settings-tab.component.scss',
})
export class CommitteeSettingsTabComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // Outputs
  public readonly committeeUpdated = output<void>();

  // State
  public saving = signal(false);
  public deleting = signal(false);
  public savingMl = signal(false);
  public removingMlUid = signal<string | null>(null);
  /** Whether the Slack webhook "Replace" affordance is open, revealing the input for a new URL. Reset to false on a successful save, or on a committee refresh unless the control has an unsaved (dirty) edit in progress — see the constructor. */
  public editingSlackWebhookUrl = signal(false);
  private mlLoadingInternal = signal(true);

  // Subject to trigger ML list refresh after association changes
  private refreshMl$ = new Subject<void>();

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
    // Write-only — never patched from the committee (Committee.has_slack_webhook is the only
    // read signal). Reset to null when `committee` refreshes, unless the control has an unsaved
    // (dirty) edit in progress; see the constructor.
    chat_webhook_url: new FormControl<string | null>(null, [Validators.pattern(SLACK_INCOMING_WEBHOOK_URL_PATTERN)]),
  });

  // Project mailing lists (loaded when committee has a project_uid — used by the picker dialog)
  public projectMailingLists: Signal<GroupsIOMailingList[]> = this.initProjectMailingLists();

  // Associated mailing lists (queried directly by committee_uid tag)
  public associatedMailingLists: Signal<GroupsIOMailingList[]> = this.initAssociatedMailingLists();

  // Derived loading state: true until first emission from associatedMailingLists
  public mlLoading = computed(() => this.mlLoadingInternal() && !!this.committee()?.uid);

  // Dark-launch gate for the whole Slack webhook card — mirrors committee-overview.component.ts's
  // 'wg-weekly-brief' flag on the brief card itself, but as its own flag: the upstream
  // committee-service has no chat_webhook_url field yet (see committee.service.ts's
  // updateCommittee/getSlackWebhookUrlStrict comments), so every save deterministically fails
  // with 409 SLACK_WEBHOOK_NOT_PERSISTED today. Rendering the card unconditionally would show
  // every user a dead end; this keeps it hidden until the upstream schema change lands and the
  // flag is flipped on.
  public slackWebhookEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag('wg-weekly-brief-slack', false);

  // Whether the committee already has a Slack webhook configured — drives the settings card's Configured/Replace vs. empty-input display.
  public slackWebhookConfigured = computed(() => !!this.committee()?.has_slack_webhook);

  // Whether the webhook-URL input is currently rendered/editable — passed straight to
  // CommitteeSettingsComponent as its single source of truth for that decision (not re-derived
  // independently in the child from two separately-passed inputs, which is how the "input
  // visible but the save didn't send it" bug happened in the first place).
  public slackWebhookInputVisible = computed(() => this.editingSlackWebhookUrl() || !this.slackWebhookConfigured());

  public constructor() {
    // Patch form when committee input changes
    toObservable(this.committee)
      .pipe(
        filter((c): c is Committee => !!c),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((c) => {
        // A dirty chat_webhook_url means the user has an unsaved edit in progress (including
        // "saved everything except the webhook" — see saveSettings' SLACK_WEBHOOK_NOT_PERSISTED
        // branch, which emits committeeUpdated without resetting this control). Preserve it
        // across the resulting refresh instead of silently discarding what they typed; a
        // successful save already reset the control itself (see saveSettings' next handler), so
        // this only ever preserves a genuinely unsaved value.
        const preserveWebhookEdit = this.form.controls.chat_webhook_url.dirty;
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
          ...(preserveWebhookEdit ? {} : { chat_webhook_url: null }),
        });
        if (!preserveWebhookEdit) {
          this.editingSlackWebhookUrl.set(false);
        }
      });

    // Disable form fields for read-only (Auditor) access
    toObservable(this.canEdit)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((editable) => {
        if (editable) {
          this.form.enable();
        } else {
          this.form.disable();
        }
      });
  }

  public openMailingListPicker(): void {
    const committee = this.committee();
    const committeeUid = committee.uid;
    const projectUid = committee.project_uid;
    const overviewPath = this.lensService.activeLens() === 'foundation' ? '/foundation/overview' : '/project/overview';
    const denyParams: Record<string, string> = { _notice: 'mailing-lists' };
    if (committee.project_slug) denyParams['project'] = committee.project_slug;
    const deny = () => void this.router.navigate([overviewPath], { queryParams: denyParams });

    this.committeeService
      .getCommittee(committeeUid)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fresh) => {
          if (fresh?.writer !== true) {
            if (fresh?.project_slug) denyParams['project'] = fresh.project_slug;
            deny();
            return;
          }
          this.openPickerDialog(committeeUid, projectUid, fresh?.project_slug ?? committee.project_slug);
        },
        error: () => deny(),
      });
  }

  public removeMailingList(ml: GroupsIOMailingList): void {
    const committee = this.committee();
    if (!committee?.uid || this.removingMlUid()) return;

    this.removingMlUid.set(ml.uid);

    this.mailingListService
      .updateMailingList(ml.uid, this.buildMlUpdatePayload(ml, null))
      .pipe(finalize(() => this.removingMlUid.set(null)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Removed', detail: `${ml.group_name} removed from this group` });
          this.refreshMl$.next();
        },
        error: (err: any) => {
          const detail = this.getMlErrorDetail(err, `Failed to remove ${ml.group_name}`);
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
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
              this.router.navigate(['/', 'groups']);
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
        // Gated on the control's own dirty flag, not on whether the input happens to be
        // rendered — patchValue (constructor) never marks a control dirty, only a real user
        // edit does, so this is "the user actually typed something" rather than "the input was
        // visible". Gating on visibility alone would send chat_webhook_url: null on every save
        // for a not-yet-configured committee (untouched or not), forcing a needless read-back
        // round trip and risking clobbering a webhook someone else configured after this page
        // loaded.
        ...(this.form.controls.chat_webhook_url.dirty ? { chat_webhook_url: values.chat_webhook_url || null } : {}),
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Settings saved' });
          // Reset locally rather than relying on the refresh triggered by the emit below — that
          // refresh is async (a refetch round-trip) and its timing shouldn't be what keeps this
          // control's dirty/value state correct.
          if (this.form.controls.chat_webhook_url.dirty) {
            this.form.controls.chat_webhook_url.reset(null);
          }
          this.editingSlackWebhookUrl.set(false);
          this.committeeUpdated.emit();
        },
        error: (err: any) => {
          const code = err?.error?.code;
          const status = err?.status;
          let detail = 'Failed to save settings';
          if (status === 409 && code === 'SLACK_WEBHOOK_NOT_PERSISTED') {
            detail = err.error.error ?? 'Your other changes were saved, but the Slack webhook could not be stored.';
            // Everything else the user set did persist (see committee.service.ts's
            // updateCommittee — this check runs last, after the core PUT and settings update), so
            // still emit to refresh the rest of the page (e.g. the committee header's public/
            // voting-enabled indicators) from that saved state. chat_webhook_url is deliberately
            // left dirty here (not reset) — the constructor's committee-refresh subscription
            // preserves a dirty control's current value instead of nulling it, so the URL the
            // user just typed survives this refresh instead of vanishing before they can read
            // the error.
            this.committeeUpdated.emit();
          } else if (status === 400) {
            const fieldErrors = err?.error?.errors as ValidationError[] | undefined;
            detail = fieldErrors?.[0]?.message ?? detail;
          }
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
      });
  }

  // -- Private methods --

  private openPickerDialog(committeeUid: string, projectUid: string, projectSlug: string | undefined): void {
    const associatedUids = new Set(this.associatedMailingLists().map((ml) => ml.uid));

    const ref = this.dialogService.open(MailingListPickerDialogComponent, {
      header: 'Associated Mailing Lists',
      width: '700px',
      modal: true,
      closable: true,
      draggable: false,
      data: {
        mailingLists: this.projectMailingLists(),
        associatedUids,
        projectUid,
        projectSlug,
        committeeUid,
      },
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1)).subscribe((result: MailingListPickerDialogResult | null) => {
      if (!result) return;
      this.saveMailingListAssociation(result.selectedUids, associatedUids);
    });
  }

  private saveMailingListAssociation(currentSelection: Set<string>, originalSelectedUids: Set<string>): void {
    const committee = this.committee();
    if (!committee?.uid) return;

    const added = [...currentSelection].filter((uid) => !originalSelectedUids.has(uid));
    const removed = [...originalSelectedUids].filter((uid) => !currentSelection.has(uid));

    if (added.length === 0 && removed.length === 0) {
      return;
    }

    const updates$: Observable<{ uid: string; success: boolean }>[] = [];

    // Associate: set committee_uid on newly selected MLs
    for (const uid of added) {
      const ml = this.projectMailingLists().find((m) => m.uid === uid);
      if (ml) {
        updates$.push(
          this.mailingListService.updateMailingList(uid, this.buildMlUpdatePayload(ml, committee.uid)).pipe(
            map(() => ({ uid, success: true })),
            catchError(() => of({ uid, success: false }))
          )
        );
      }
    }

    // Disassociate: clear committee_uid on deselected MLs
    for (const uid of removed) {
      const ml = this.projectMailingLists().find((m) => m.uid === uid) ?? this.associatedMailingLists().find((m) => m.uid === uid);
      if (ml) {
        updates$.push(
          this.mailingListService.updateMailingList(uid, this.buildMlUpdatePayload(ml, null)).pipe(
            map(() => ({ uid, success: true })),
            catchError(() => of({ uid, success: false }))
          )
        );
      }
    }

    if (updates$.length === 0) {
      return;
    }

    this.savingMl.set(true);
    forkJoin(updates$)
      .pipe(finalize(() => this.savingMl.set(false)))
      .subscribe({
        next: (results) => {
          const failed = results.filter((r) => !r.success).length;
          const succeeded = results.filter((r) => r.success).length;
          if (failed === 0) {
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Mailing list associations updated' });
          } else if (succeeded > 0) {
            this.messageService.add({ severity: 'warn', summary: 'Partial Success', detail: `${succeeded} updated, ${failed} failed` });
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update mailing list associations' });
          }
          this.refreshMl$.next();
        },
      });
  }

  private getMlErrorDetail(err: any, fallback: string): string {
    const body = err?.error;
    if (body?.error?.includes?.('subgroup not found') || body?.code === 'NOT_FOUND') {
      return 'Mailing list sync failed — the Groups.io subgroup may not exist for this list';
    }
    return fallback;
  }

  private buildMlUpdatePayload(ml: GroupsIOMailingList, committeeUid: string | null): Partial<CreateMailingListRequest> {
    return {
      name: ml.group_name,
      public: ml.public,
      type: ml.type,
      audience_access: ml.audience_access,
      description: ml.description,
      title: ml.title,
      service_id: ml.service_uid,
      committee_uid: committeeUid,
      subject_tag: ml.subject_tag,
      writers: ml.writers,
      auditors: ml.auditors,
    };
  }

  private initAssociatedMailingLists(): Signal<GroupsIOMailingList[]> {
    const committee$ = toObservable(this.committee);
    const refresh$ = this.refreshMl$.pipe(map(() => this.committee()));

    return toSignal(
      merge(committee$, refresh$).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.mlLoadingInternal.set(true);
          return this.mailingListService.getMailingListsByCommittee(c!.uid).pipe(
            finalize(() => this.mlLoadingInternal.set(false)),
            catchError(() => of([] as GroupsIOMailingList[]))
          );
        })
      ),
      { initialValue: [] as GroupsIOMailingList[] }
    );
  }

  private initProjectMailingLists(): Signal<GroupsIOMailingList[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.project_uid),
        switchMap((c) => {
          return this.mailingListService.getMailingListsByProject(c!.project_uid!).pipe(catchError(() => of([] as GroupsIOMailingList[])));
        })
      ),
      { initialValue: [] as GroupsIOMailingList[] }
    );
  }
}
