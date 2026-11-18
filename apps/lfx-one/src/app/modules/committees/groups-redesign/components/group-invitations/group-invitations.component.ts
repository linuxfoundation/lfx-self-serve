// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  PLATFORM_ID,
  Signal,
  signal,
  TemplateRef,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BEHAVIORAL_CLASS_CONFIG, GROUP_INVITATION_DECLINE_UNDO_MS } from '@lfx-one/shared/constants';
import { GroupInvitationItem, PendingInvitation, UiFocusable, UiToastRef } from '@lfx-one/shared/interfaces';
import { formatInviteExpiry, getGroupBehavioralClass, invitationRequiresOrganization } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InvitationService } from '@services/invitation.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { defaultIfEmpty, exhaustMap, filter, finalize, pairwise, take, timer } from 'rxjs';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';
import { GroupsHomeStore } from '../../services/groups-home.store';

/**
 * Invitations button of the Groups page header, with the number of open invitations, and its drawer listing them.
 * @description Accept joins the group and reloads the page's groups; Decline is sent once its Undo toast runs out. Hidden when
 * nothing is open; the drawer closes when its last invitation is answered and focus moves to `fallbackFocus`.
 */
@Component({
  selector: 'lfx-group-invitations',
  imports: [MeetingProjectLogoComponent, UiBadgeComponent, UiButtonComponent, UiDrawerComponent, UiTooltipDirective],
  templateUrl: './group-invitations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class GroupInvitationsComponent {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawerService = inject(UiDrawerService);
  private readonly toast = inject(UiToastService);
  private readonly invitationService = inject(InvitationService);
  private readonly acceptFlow = inject(InvitationAcceptFlowService);
  private readonly committeeService = inject(CommitteeService);
  private readonly store = inject(GroupsHomeStore);
  private readonly drawerTemplate = viewChild.required<TemplateRef<unknown>>('drawer');
  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');

  /** Takes focus when the last invitation is answered, since the button then hides. */
  public readonly fallbackFocus = input<UiFocusable | null>(null);

  /** Invitations waiting for the organization step of Accept. */
  protected readonly accepting = signal<ReadonlySet<string>>(new Set());
  protected readonly drawerOpen = signal(false);
  /** Names cut off by the row width; only those get a tooltip with the full text. */
  protected readonly truncated = signal<ReadonlySet<HTMLElement>>(new Set());
  /** Open invitations, without those answered this session. */
  protected readonly invitations: Signal<PendingInvitation[]> = this.initInvitations();
  protected readonly items: Signal<GroupInvitationItem[]> = this.initItems();
  protected readonly subtitle: Signal<string> = this.initSubtitle();

  private drawerRef: DialogRef | null = null;
  /** Declines waiting out their Undo window, by invitation uid. */
  private readonly pendingDeclines = new Map<string, { committeeUid: string; timerId: ReturnType<typeof setTimeout>; toast: UiToastRef }>();

  public constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) this.invitationService.loadPendingInvitations().pipe(takeUntilDestroyed()).subscribe();
    this.initCloseWhenEmpty();
    this.destroyRef.onDestroy(() => {
      // Leaving the page commits a decline instead of dropping it.
      for (const uid of [...this.pendingDeclines.keys()]) this.sendDecline(uid);
      this.drawerRef?.close();
    });
  }

  protected openDrawer(): void {
    if (this.drawerRef) return;
    const ref = this.drawerService.open(this.drawerTemplate(), { width: 640, describedBy: true });
    this.drawerRef = ref;
    this.drawerOpen.set(true);
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.drawerRef = null;
      this.drawerOpen.set(false);
    });
  }

  protected checkTruncated(element: HTMLElement): void {
    const cut = element.scrollWidth > element.clientWidth;
    if (cut === this.truncated().has(element)) return;
    this.truncated.update((elements) => {
      const next = new Set(elements);
      if (cut) next.add(element);
      else next.delete(element);
      return next;
    });
  }

  protected accept(invitation: PendingInvitation): void {
    const requiresOrganization = invitationRequiresOrganization(invitation);
    // Without the organization step the row leaves at once; with it, the row waits for the dialog.
    if (requiresOrganization) this.setAccepting(invitation.uid, true);
    else this.removeRow(invitation.uid);
    this.acceptFlow
      .accept({
        committeeUid: invitation.committee_uid,
        inviteUid: invitation.uid,
        committeeName: invitation.committee_name,
        organization: invitation.organization,
        enable_voting: invitation.enable_voting,
        business_email_required: invitation.business_email_required,
        inviteRequiresOrganization: requiresOrganization,
      })
      .pipe(
        take(1),
        finalize(() => this.setAccepting(invitation.uid, false))
      )
      .subscribe({
        next: () => {
          if (requiresOrganization) this.removeRow(invitation.uid);
          this.invitationService.forgetResolved(invitation.uid);
          this.toast.show({ message: `You've joined ${invitation.committee_name}` });
          this.reloadGroupsWith(invitation.committee_uid);
        },
        error: () => {
          if (!requiresOrganization) this.invitationService.unmarkResolved(invitation.uid);
          this.toast.show({ variant: 'error', message: "Couldn't accept the invitation", description: 'Try again.' });
        },
      });
  }

  protected decline(invitation: PendingInvitation): void {
    this.removeRow(invitation.uid);
    const toast = this.toast.show({
      message: 'Invite declined',
      duration: GROUP_INVITATION_DECLINE_UNDO_MS,
      actions: [{ label: 'Undo', run: () => this.undoDecline(invitation.uid) }],
    });
    const timerId = setTimeout(() => this.sendDecline(invitation.uid), GROUP_INVITATION_DECLINE_UNDO_MS);
    this.pendingDeclines.set(invitation.uid, { committeeUid: invitation.committee_uid, timerId, toast });
  }

  private initInvitations(): Signal<PendingInvitation[]> {
    return computed(() => this.invitationService.pendingInvitations().filter((invitation) => !this.invitationService.resolvedInviteUids().has(invitation.uid)));
  }

  private initItems(): Signal<GroupInvitationItem[]> {
    return computed(() => this.invitations().map((invitation) => this.toItem(invitation)));
  }

  // Keeps the last count while the emptied drawer slides out.
  private initSubtitle(): Signal<string> {
    return linkedSignal<number, string>({
      source: () => this.invitations().length,
      computation: (count, previous) => (count || !previous ? `${count} waiting for a response` : previous.value),
    });
  }

  /** Answering the last invitation closes the drawer; the opener is gone with it, so focus goes to `fallbackFocus`. */
  private initCloseWhenEmpty(): void {
    toObservable(this.invitations)
      .pipe(pairwise(), takeUntilDestroyed())
      .subscribe(([previous, invitations]) => {
        const ref = this.drawerRef;
        if (!ref || invitations.length || !previous.length) return;
        ref.closed.pipe(take(1)).subscribe(() => this.fallbackFocus()?.focus());
        ref.close();
      });
  }

  private undoDecline(uid: string): void {
    const pending = this.pendingDeclines.get(uid);
    if (!pending) return;
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(uid);
    this.invitationService.unmarkResolved(uid);
  }

  private sendDecline(uid: string): void {
    const pending = this.pendingDeclines.get(uid);
    if (!pending) return;
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(uid);
    // A toast kept open by hover or focus must not offer an Undo that can no longer work.
    pending.toast.dismiss();
    this.invitationService
      .declineInvitation(pending.committeeUid, uid)
      .pipe(take(1))
      .subscribe({
        next: () => this.invitationService.forgetResolved(uid),
        error: () => {
          this.invitationService.unmarkResolved(uid);
          this.toast.show({ variant: 'error', message: "Couldn't decline the invitation", description: 'Try again.' });
        },
      });
  }

  /** Hides the row and moves focus to the next one left, as the focused button leaves with it. */
  private removeRow(uid: string): void {
    const index = this.invitations().findIndex((invitation) => invitation.uid === uid);
    this.invitationService.markResolved(uid);
    if (!this.drawerRef || index < 0) return;
    afterNextRender(() => this.rowElements()[Math.min(index, this.rowElements().length - 1)]?.nativeElement.querySelector('button')?.focus(), {
      injector: this.injector,
    });
  }

  /** The membership index lags the accept, so poll until the group is listed, then reload the page's groups. */
  private reloadGroupsWith(committeeUid: string): void {
    timer(400, 400)
      .pipe(
        take(6),
        exhaustMap(() => this.committeeService.getMyCommittees()),
        filter((groups) => groups.some((group) => group.uid === committeeUid)),
        take(1),
        defaultIfEmpty(null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.store.reload());
  }

  private setAccepting(uid: string, accepting: boolean): void {
    this.accepting.update((uids) => {
      const next = new Set(uids);
      if (accepting) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }

  private toItem(invitation: PendingInvitation): GroupInvitationItem {
    const display = BEHAVIORAL_CLASS_CONFIG[getGroupBehavioralClass(invitation.category ?? undefined)];
    const expiry = formatInviteExpiry(invitation.expires_at);
    const invited = invitation.inviter_name ? `Invited by ${invitation.inviter_name}` : "You've been invited";
    return {
      invitation,
      typeIcon: display.icon,
      typeLabel: invitation.category?.trim() || display.label,
      detail: invitation.inviter_name && expiry ? `${invited} · Expires ${expiry}` : invited,
    };
  }
}
