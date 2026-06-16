// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Component, DestroyRef, inject, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { PendingInvitation } from '@lfx-one/shared/interfaces';
import { RouterLink } from '@angular/router';
import { InvitationSubtextPipe } from '@pipes/invitation-subtext.pipe';
import { invitationRequiresOrganization } from '@lfx-one/shared/utils';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InvitationService } from '@services/invitation.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { take } from 'rxjs';

/** Window before a declined invite is actually sent upstream, during which the user can undo. */
const DECLINE_UNDO_MS = 5000;

/** Dedicated toast key so the inline undo template renders only for this component's toasts. */
const TOAST_KEY = 'committee-invitations';

/**
 * "Invitations" section shown above the My Groups table (Me lens only).
 *
 * Sources pending committee invitations from {@link InvitationService} (the shared cross-surface
 * cache) and renders nothing when there are none. Accept is optimistic + emits {@link accepted} so
 * the parent can refresh the active list. Decline uses a deferred-undo pattern: the row is removed
 * immediately, the upstream decline is fired after a short window, and an Undo toast cancels it.
 */
@Component({
  selector: 'lfx-committee-invitations',
  imports: [ButtonComponent, TagComponent, ToastModule, InvitationSubtextPipe, RouterLink],
  templateUrl: './committee-invitations.component.html',
  styleUrl: './committee-invitations.component.scss',
})
export class CommitteeInvitationsComponent {
  // ── Injections ──────────────────────────────────────────────────────────────
  private readonly invitationService = inject(InvitationService);
  private readonly invitationAcceptFlow = inject(InvitationAcceptFlowService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Outputs ───────────────────────────────────────────────────────────────
  /** Emitted after an invite is accepted so the parent can refresh My Committees. */
  public readonly accepted = output<void>();

  // Dedicated toast key exposed to the template.
  protected readonly toastKey = TOAST_KEY;

  // ── Computed / Read-only Signals ──────────────────────────────────────────
  /** Pending invitations not yet resolved (accepted/declined) this session. */
  public readonly invitations: Signal<PendingInvitation[]> = computed(() =>
    this.invitationService.pendingInvitations().filter((invitation) => !this.invitationService.resolvedInviteUids().has(invitation.uid))
  );

  /**
   * Pending decline timers keyed by invite UID, carrying the committee UID and timer handle so
   * undo can cancel and destroy can flush (the invite is already out of the cache by then, so the
   * committee UID can't be re-derived from the service).
   */
  private readonly pendingDeclines = new Map<string, { committeeUid: string; timerId: ReturnType<typeof setTimeout> }>();

  public constructor() {
    // On destroy, flush any deferred declines immediately so they are not silently dropped.
    this.destroyRef.onDestroy(() => {
      for (const inviteUid of [...this.pendingDeclines.keys()]) {
        this.flushDecline(inviteUid);
      }
    });
  }

  public onAccept(invitation: PendingInvitation): void {
    const requiresOrganization = invitationRequiresOrganization(invitation);

    if (!requiresOrganization) {
      this.invitationService.markResolved(invitation.uid);
    }

    this.invitationAcceptFlow
      .accept({
        committeeUid: invitation.committee_uid,
        inviteUid: invitation.uid,
        committeeName: invitation.committee_name,
        organization: invitation.organization,
        enable_voting: invitation.enable_voting,
        business_email_required: invitation.business_email_required,
        inviteRequiresOrganization: requiresOrganization,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          if (requiresOrganization) {
            this.invitationService.markResolved(invitation.uid);
          }
          this.invitationService.forgetResolved(invitation.uid);
          this.messageService.add({
            key: TOAST_KEY,
            severity: 'success',
            summary: `You've joined ${invitation.committee_name}`,
            life: 3000,
          });
          this.accepted.emit();
        },
        error: () => {
          if (!requiresOrganization) {
            this.invitationService.unmarkResolved(invitation.uid);
          }
          this.messageService.add({
            key: TOAST_KEY,
            severity: 'error',
            summary: `Couldn't accept — try again.`,
            life: 4000,
          });
        },
      });
  }

  public onDecline(invitation: PendingInvitation): void {
    this.invitationService.markResolved(invitation.uid);

    const timerId = setTimeout(() => {
      this.pendingDeclines.delete(invitation.uid);
      this.sendDecline(invitation.committee_uid, invitation.uid);
    }, DECLINE_UNDO_MS);
    this.pendingDeclines.set(invitation.uid, { committeeUid: invitation.committee_uid, timerId });

    // life matches the undo window so the Undo affordance disappears exactly when the decline
    // commits — never leaving a stale Undo that would falsely "restore" an already-declined invite.
    this.messageService.add({
      key: TOAST_KEY,
      severity: 'info',
      summary: 'Invite declined',
      data: { uid: invitation.uid, committeeUid: invitation.committee_uid },
      life: DECLINE_UNDO_MS,
      closable: true,
    });
  }

  public onUndoDecline(invitation: { uid: string; committeeUid: string }): void {
    const pending = this.pendingDeclines.get(invitation.uid);
    // If the timer already fired, the decline is committed upstream — there's nothing to undo.
    // Restoring the row here would lie to the user (it would reappear, then vanish on next load).
    if (!pending) {
      this.messageService.clear(TOAST_KEY);
      return;
    }
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(invitation.uid);
    this.invitationService.unmarkResolved(invitation.uid);
    this.messageService.clear(TOAST_KEY);
  }

  /** Cancels the deferred timer and fires the upstream decline immediately (destroy flush). */
  private flushDecline(inviteUid: string): void {
    const pending = this.pendingDeclines.get(inviteUid);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(inviteUid);
    this.sendDecline(pending.committeeUid, inviteUid);
  }

  private sendDecline(committeeUid: string, inviteUid: string): void {
    this.invitationService
      .declineInvitation(committeeUid, inviteUid)
      .pipe(take(1))
      .subscribe({
        next: () => this.invitationService.forgetResolved(inviteUid),
        error: () => {
          this.invitationService.unmarkResolved(inviteUid);
          this.messageService.add({
            key: TOAST_KEY,
            severity: 'error',
            summary: `Couldn't decline — try again.`,
            life: 4000,
          });
        },
      });
  }
}
