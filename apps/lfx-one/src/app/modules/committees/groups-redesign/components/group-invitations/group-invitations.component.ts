// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
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
import { BEHAVIORAL_CLASS_CONFIG, GROUPS_HOME_UNDO_MS } from '@lfx-one/shared/constants';
import { GroupInvitationItem, GroupsHomeUndo, PendingInvitation, UiFocusable, UiToastRef } from '@lfx-one/shared/interfaces';
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
import { defaultIfEmpty, exhaustMap, filter, finalize, identity, Observable, pairwise, switchMap, take, timer } from 'rxjs';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';
import { MeetingsHomeResizeService } from '../../../../meetings/meetings-redesign/services/meetings-home-resize.service';
import { GroupsHomeStore } from '../../services/groups-home.store';

/**
 * Invitations button of the Groups page header, with the number of open invitations, and its drawer listing them.
 * @description Accept joins the group and refreshes the page's groups; Decline is sent once its Undo window ends. Hidden when
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
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawerService = inject(UiDrawerService);
  private readonly toast = inject(UiToastService);
  private readonly resize = inject(MeetingsHomeResizeService);
  private readonly invitationService = inject(InvitationService);
  private readonly acceptFlow = inject(InvitationAcceptFlowService);
  private readonly committeeService = inject(CommitteeService);
  private readonly store = inject(GroupsHomeStore);
  private readonly drawerTemplate = viewChild.required<TemplateRef<unknown>>('drawer');
  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');
  private readonly names = viewChildren<ElementRef<HTMLElement>>('name');
  private readonly undoButton = viewChild('undoButton', { read: ElementRef<HTMLElement> });

  /** Takes focus when the last invitation is answered, since the button then hides. */
  public readonly fallbackFocus = input<UiFocusable | null>(null);

  /** Invitations waiting for the organization step of Accept. */
  protected readonly accepting = signal<ReadonlySet<string>>(new Set());
  protected readonly drawerOpen = signal(false);
  /** Names cut off by the row width; only those get a tooltip with the full text. */
  protected readonly truncated = signal<ReadonlySet<HTMLElement>>(new Set());
  /** Undo of the last decline, also shown in the drawer while its window lasts. */
  protected readonly undo = signal<GroupsHomeUndo | null>(null);
  /** Open invitations, without those answered this session. */
  protected readonly invitations: Signal<PendingInvitation[]> = this.initInvitations();
  protected readonly items: Signal<GroupInvitationItem[]> = this.initItems();
  protected readonly subtitle: Signal<string> = this.initSubtitle();

  private drawerRef: DialogRef | null = null;
  /** Invitation the drawer's Undo restores. */
  private undoUid: string | null = null;
  /** Declines waiting out their Undo window, by invitation uid. */
  private readonly pendingDeclines = new Map<string, { committeeUid: string; timerId: ReturnType<typeof setTimeout>; toast: UiToastRef }>();

  public constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) this.invitationService.loadPendingInvitations().pipe(takeUntilDestroyed()).subscribe();
    this.initCloseWhenEmpty();
    this.initTruncation();
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

  protected accept(invitation: PendingInvitation): void {
    if (!invitationRequiresOrganization(invitation)) {
      this.removeRow(invitation.uid);
      this.runAccept(invitation, false);
      return;
    }
    // The row waits for the company step, whose dialog would open under the drawer, so the drawer closes first.
    this.setAccepting(invitation.uid, true);
    const ref = this.drawerRef;
    if (!ref) {
      this.runAccept(invitation, true);
      return;
    }
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.runAccept(invitation, true));
    ref.close();
  }

  protected decline(invitation: PendingInvitation): void {
    this.removeRow(invitation.uid);
    const toast = this.toast.show({
      message: 'Invite declined',
      duration: GROUPS_HOME_UNDO_MS,
      actions: [{ label: 'Undo', run: () => this.undoDecline(invitation.uid) }],
    });
    const timerId = setTimeout(() => this.sendDecline(invitation.uid), GROUPS_HOME_UNDO_MS);
    this.pendingDeclines.set(invitation.uid, { committeeUid: invitation.committee_uid, timerId, toast });
    this.undoUid = invitation.uid;
    this.undo.set({
      ariaLabel: `Undo declining the invite to ${invitation.committee_name}`,
      run: () => {
        toast.dismiss();
        this.undoDecline(invitation.uid);
      },
    });
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
        if (invitations.length || !previous.length) return;
        const ref = this.drawerRef;
        if (ref) {
          ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.fallbackFocus()?.focus());
          ref.close();
          return;
        }
        // Accepted after the company step, with the drawer already closed: focus was handed back to the removed button.
        afterNextRender(
          () => {
            const active = this.document.activeElement;
            if (!active || active === this.document.body) this.fallbackFocus()?.focus();
          },
          { injector: this.injector }
        );
      });
  }

  /** Measured on render and resize, so the tooltip is ready before the first hover. */
  private initTruncation(): void {
    toObservable(computed(() => this.names().map((ref) => ref.nativeElement)))
      .pipe(
        switchMap(
          (elements) =>
            new Observable<ReadonlySet<HTMLElement>>((subscriber) =>
              this.resize.observe(elements, () => subscriber.next(new Set(elements.filter((element) => element.scrollWidth > element.clientWidth))))
            )
        ),
        takeUntilDestroyed()
      )
      .subscribe((truncated) => this.truncated.set(truncated));
  }

  private runAccept(invitation: PendingInvitation, requiresOrganization: boolean): void {
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
        // The company step belongs to this page; nothing is hidden yet, so leaving the page can drop it.
        requiresOrganization ? takeUntilDestroyed(this.destroyRef) : identity,
        finalize(() => this.setAccepting(invitation.uid, false))
      )
      .subscribe({
        next: () => {
          if (requiresOrganization) this.removeRow(invitation.uid);
          this.invitationService.forgetResolved(invitation.uid);
          this.toast.show({ message: `You've joined ${invitation.committee_name}` });
          this.refreshGroupsWith(invitation.committee_uid);
        },
        error: () => {
          if (!requiresOrganization) this.invitationService.unmarkResolved(invitation.uid);
          this.toast.show({ variant: 'error', message: "Couldn't accept the invitation", description: 'Try again.' });
        },
      });
  }

  private undoDecline(uid: string): void {
    const pending = this.pendingDeclines.get(uid);
    if (!pending) return;
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(uid);
    this.clearUndo(uid);
    this.invitationService.unmarkResolved(uid);
    this.focusRow(this.invitations().findIndex((invitation) => invitation.uid === uid));
  }

  private sendDecline(uid: string): void {
    const pending = this.pendingDeclines.get(uid);
    if (!pending) return;
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(uid);
    this.clearUndo(uid);
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
    this.focusRow(index);
  }

  /** Focuses the first button of the row now at `index`, once rendered, while the drawer is open. */
  private focusRow(index: number): void {
    if (!this.drawerRef || index < 0) return;
    afterNextRender(
      () => {
        const rows = this.rowElements();
        rows[Math.min(index, rows.length - 1)]?.nativeElement.querySelector('button')?.focus();
      },
      { injector: this.injector }
    );
  }

  /** Removes the drawer's Undo when it belongs to `uid`; focus on it moves to the first row. */
  private clearUndo(uid: string): void {
    if (this.undoUid !== uid) return;
    this.undoUid = null;
    if (this.undoButton()?.nativeElement.contains(this.document.activeElement)) this.focusRow(0);
    this.undo.set(null);
  }

  /** The membership index lags the accept, so poll until the group is listed, then refresh the page's groups in place. */
  private refreshGroupsWith(committeeUid: string): void {
    timer(400, 400)
      .pipe(
        take(6),
        exhaustMap(() => this.committeeService.getMyCommittees()),
        filter((groups) => groups.some((group) => group.uid === committeeUid)),
        take(1),
        defaultIfEmpty(null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.store.refresh());
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
