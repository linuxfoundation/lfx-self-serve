// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AcceptInviteOrganizationDialogComponent } from '@components/accept-invite-organization-dialog/accept-invite-organization-dialog.component';
import { ButtonComponent } from '@components/button/button.component';
import { JoinApplicationDialogComponent } from '@components/join-application-dialog/join-application-dialog.component';
import {
  AcceptInviteOrganizationDialogData,
  AcceptInviteOrganizationDialogResult,
  ButtonProps,
  CommitteeOrganizationReference,
  GroupJoinStateChange,
  GroupJoinTarget,
  JoinApplicationDialogData,
  JoinApplicationDialogResult,
} from '@lfx-one/shared/interfaces';
import { committeeRequiresOrganization } from '@lfx-one/shared/utils';
import { CommitteeJoinApplicationSessionService } from '@services/committee-join-application-session.service';
import { CommitteeService } from '@services/committee.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { UserService } from '@services/user.service';
import { committeeJoinErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { finalize, firstValueFrom, map, merge, take } from 'rxjs';

/**
 * Self-service join action for a group, driven by its `join_mode`:
 *
 * - `open` — joins directly, after an organization dialog when the group requires one.
 * - `application` — opens the request-to-join dialog (after the organization dialog when required)
 *   and records the pending application in `CommitteeJoinApplicationSessionService`, because
 *   listing applications is writer-only and the server cannot rehydrate it.
 * - `closed` — "Contact Admin" informational toast.
 * - `invite_only` — no action.
 *
 * An anonymous viewer is sent to sign in with `returnTo` set to the current page. The host decides
 * whether the viewer may act (membership, pending invitation) through `showButton`, and reacts to
 * `stateChange` (e.g. refreshing the roster on `joined`). Hosts that render their own join CTAs can
 * call `requestJoin()` so every entry point shares one flow and one busy state.
 */
@Component({
  selector: 'lfx-group-join-button',
  imports: [ButtonComponent],
  providers: [DialogService],
  templateUrl: './group-join-button.component.html',
  // `contents` keeps the host out of the parent's layout — a hidden button (showButton false or
  // an invite-only group) must not leave an empty flex item that shifts its siblings by a gap.
  host: { class: 'contents' },
})
export class GroupJoinButtonComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly joinApplicationSession = inject(CommitteeJoinApplicationSessionService);
  private readonly invitationAcceptFlow = inject(InvitationAcceptFlowService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * The group to join. `null` renders nothing and makes `requestJoin()` a no-op — a host passes it
   * while the group on screen is not (or no longer) the one being navigated to, and a flow that is
   * waiting on a dialog is abandoned if the group changes underneath it.
   */
  public readonly group = input<GroupJoinTarget | null>(null);
  /** When false nothing renders, but `requestJoin()` still runs the flow for host-owned CTAs. */
  public readonly showButton = input<boolean>(true);
  public readonly size = input<ButtonProps['size']>('small');
  /** Prefix for the buttons' `data-testid`s, so a host can keep its existing E2E selectors. */
  public readonly testIdPrefix = input<string>('group-join-button');

  public readonly stateChange = output<GroupJoinStateChange>();

  /** A join or application request is in flight (or its dialog is open). */
  public readonly joining = signal(false);
  /**
   * Blocks the action while the org prefetch runs and while the organization dialog is open, so a
   * second tap can't open a parallel resolveCurrentEmployer() + dialog pair.
   */
  public readonly resolvingOrg = signal(false);

  public readonly busy: Signal<boolean> = computed(() => this.joining() || this.resolvingOrg());
  /** True when the viewer submitted an application for this group this session. */
  public readonly hasPendingApplication: Signal<boolean> = this.initHasPendingApplication();

  private destroyed = false;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }

  public async requestJoin(): Promise<void> {
    const group = this.group();
    if (!group || this.busy()) {
      return;
    }

    const joinMode = group.join_mode;
    if ((joinMode === 'open' || joinMode === 'application') && !this.userService.authenticated()) {
      this.promptSignIn();
      return;
    }

    if (joinMode === 'open') {
      const organization = await this.resolveOrganization(group);
      if (organization === null) {
        return;
      }
      this.join(group, organization);
    } else if (joinMode === 'application') {
      if (this.hasPendingApplication()) {
        return;
      }
      const organization = await this.resolveOrganization(group);
      if (organization === null) {
        return;
      }
      this.openApplicationDialog(group, organization);
    } else {
      // closed / invite_only — no self-service action available
      this.messageService.add({ severity: 'info', summary: 'Contact Admin', detail: 'Contact a group admin to request membership.' });
    }
  }

  private initHasPendingApplication(): Signal<boolean> {
    return computed(() => {
      const uid = this.group()?.uid;
      return !!uid && this.joinApplicationSession.pendingCommitteeUids().has(uid);
    });
  }

  private promptSignIn(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  /**
   * Resolves the organization to send with the request. `undefined` means none is needed; `null`
   * means the flow was abandoned (dialog dismissed, component destroyed, or the host swapped the
   * group while the dialog was open).
   */
  private async resolveOrganization(group: GroupJoinTarget): Promise<CommitteeOrganizationReference | undefined | null> {
    if (!committeeRequiresOrganization(group)) {
      return undefined;
    }
    this.resolvingOrg.set(true);
    const result = await this.openOrganizationDialog(group.name).finally(() => this.resolvingOrg.set(false));
    if (!result?.organization || this.destroyed || this.group()?.uid !== group.uid) {
      return null;
    }
    return result.organization;
  }

  private join(group: GroupJoinTarget, organization: CommitteeOrganizationReference | undefined): void {
    this.joining.set(true);
    this.committeeService
      .joinCommittee(group.uid, organization)
      .pipe(finalize(() => this.joining.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Joined', detail: `You have joined "${group.name}"` });
          this.stateChange.emit({ group_uid: group.uid, state: 'joined' });
        },
        error: (err: HttpErrorResponse) => {
          const detail = committeeJoinErrorMessage(err, group.name);
          this.messageService.add({ severity: 'error', summary: 'Unable to Join', detail, life: 6000 });
        },
      });
  }

  private openApplicationDialog(group: GroupJoinTarget, organization: CommitteeOrganizationReference | undefined): void {
    if (this.joining()) {
      return;
    }

    this.joining.set(true);

    const ref = this.dialogService.open(JoinApplicationDialogComponent, {
      header: 'Request to Join',
      width: '520px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { committeeName: group.name } satisfies JoinApplicationDialogData,
    }) as DynamicDialogRef;

    // PrimeNG DynamicDialog fires destroy() — not close() — when the user dismisses via the
    // header X button (onDialogHide path). In that case onClose never emits. Merge onDestroy
    // as a null fallback so `joining` is always reset on every dismiss path.
    merge(ref.onClose, ref.onDestroy.pipe(map(() => null as JoinApplicationDialogResult | null)))
      .pipe(takeUntilDestroyed(this.destroyRef), take(1))
      .subscribe((result: JoinApplicationDialogResult | null) => {
        if (!result) {
          this.joining.set(false);
          return;
        }

        this.committeeService
          .submitApplication(group.uid, result.message, organization)
          .pipe(finalize(() => this.joining.set(false)))
          .subscribe({
            next: () => {
              this.markApplicationPending(group.uid);
              this.messageService.add({
                severity: 'success',
                summary: 'Application Submitted',
                detail: `Your request to join "${group.name}" has been submitted. An admin will review it shortly.`,
                life: 8000,
              });
            },
            error: (err: HttpErrorResponse) => {
              const upstream = err.error?.message as string | undefined;
              let detail: string;
              if (err.status === 409) {
                this.markApplicationPending(group.uid);
                detail = 'You already have a pending application for this group.';
              } else {
                detail = upstream ?? `Failed to submit your request for "${group.name}". Please try again.`;
              }
              this.messageService.add({ severity: 'error', summary: 'Unable to Submit', detail, life: 6000 });
            },
          });
      });
  }

  private markApplicationPending(groupUid: string): void {
    this.joinApplicationSession.markPending(groupUid);
    this.stateChange.emit({ group_uid: groupUid, state: 'application_pending' });
  }

  private async openOrganizationDialog(groupName: string): Promise<AcceptInviteOrganizationDialogResult | null> {
    // Pre-fill from the user's profile work experiences — same pre-resolution the invite
    // accept flow uses so the user doesn't have to re-enter an org they've already set.
    // takeUntilDestroyed cancels the lookup (≤4 s worst case — 2 s for the work-experiences GET +
    // 2 s for the CDP domain resolve) if the component is destroyed while it is in flight.
    // firstValueFrom's defaultValue: null resolves the await even after that early completion,
    // so the `destroyed` flag stops the dialog opening over a new route.
    const prefillOrg = await firstValueFrom(this.invitationAcceptFlow.resolveCurrentEmployer().pipe(takeUntilDestroyed(this.destroyRef)), {
      defaultValue: null,
    });

    if (this.destroyed) {
      return null;
    }

    const ref = this.dialogService.open(AcceptInviteOrganizationDialogComponent, {
      header: 'Confirm Organization',
      width: '32rem',
      modal: true,
      closable: true,
      data: { committeeName: groupName, organization: prefillOrg } satisfies AcceptInviteOrganizationDialogData,
    });
    if (!ref) {
      return null;
    }
    return new Promise((resolve) => {
      // Same PrimeNG destroy()-vs-close() issue: X button fires onDestroy, not onClose.
      // Merge onDestroy as a null fallback so resolvingOrg is always cleared on dismiss.
      merge(ref.onClose, ref.onDestroy.pipe(map(() => null as AcceptInviteOrganizationDialogResult | null)))
        .pipe(take(1))
        .subscribe((result: AcceptInviteOrganizationDialogResult | null) => resolve(result ?? null));
    });
  }
}
