// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

import type { AudienceLastSentEmail, AudienceListBrief, AudienceMasterListBrief } from '@lfx-one/shared/interfaces';

/**
 * What one prior send's included lists REPORT, or '' when nothing can be said.
 *
 * Deliberately not called reach, and deliberately not "contacts". A sum of list sizes is neither
 * an exact contact count nor a reliable bound in EITHER direction:
 *
 *   - It over-counts whenever lists overlap, which `docs/api-catalog.md` records as the normal
 *     case ("summing list sizes over-counts, because registrant/speaker overlap is the normal
 *     case"). Two lists holding the same 5,000 contacts sum to 10,000.
 *   - So "at least N" is a FALSE floor, not a cautious one: the union can be smaller than the
 *     sum, and an earlier version of this label said exactly that.
 *   - And a list whose size HubSpot withheld contributes nothing, so the sum can understate too.
 *
 * Both error directions at once means no honest inequality exists, and the only honest statement
 * is what the number IS: the memberships the portal reported, across the lists that reported one.
 * An operator who needs the real reach has `preview-count`, which unions rather than sums.
 */
function reportedMembershipsLabel(sizedCount: number, includedCount: number, total: number): string {
  if (sizedCount === 0) {
    return '';
  }
  const figure = total.toLocaleString('en-US');
  const scope = sizedCount === includedCount ? '' : ` across ${sizedCount} of ${includedCount} lists`;
  return `${figure} list memberships${scope} — lists may overlap`;
}

/**
 * "Who did we send this to last time" — past sends for this event, plus master lists already built.
 *
 * The fastest correct answer to the question the legacy tool was built around, and the reason a
 * rebuild is often unnecessary: an existing master list, or an earlier send's exact list selection,
 * can be attached to this email outright with no new list created in HubSpot.
 */
@Component({
  selector: 'lfx-audience-last-sent',
  imports: [DatePipe],
  templateUrl: './audience-last-sent.component.html',
  styleUrl: './audience-last-sent.component.scss',
})
export class AudienceLastSentComponent {
  // === Inputs ===
  public readonly emails = input<readonly AudienceLastSentEmail[]>([]);
  public readonly masterLists = input<readonly AudienceMasterListBrief[]>([]);
  public readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  public readonly loading = input(false);
  public readonly disabled = input(false);
  /**
   * Fetch failures, kept separate per section because the two load independently.
   *
   * Without these, an outage and a portal that genuinely holds nothing render the identical empty
   * arm — so "No past marketing email for this event was found in HubSpot" asserts a verified
   * absence on a branch that also runs when the request failed. Same contract as the suppression
   * grid's `failed`; the consequence here is a wasted rebuild rather than a compliance gap, which
   * is why it is a distinct message and not a blocker.
   */
  /** Owned by the existing-masters request, which runs independently of `loading` (last-sent). */
  public readonly mastersLoading = input(false);
  public readonly mastersFailed = input(false);
  public readonly emailsFailed = input(false);
  /**
   * Whether lists can be attached to the current email directly. False with no saved plan (there
   * is no brief to attach to) or while HubSpot is unusable; the attach buttons then explain why.
   */
  public readonly canAttach = input(false);
  /**
   * Whether an EXISTING master list may be reused, which needs more than `canAttach`.
   *
   * That path submits the operator's ticked suppressions, and while the suppression lookup is
   * pending or failed the ticked set is empty for a reason unrelated to their intent -- so it
   * would record a send audience with NO exclusions before anyone could review them.
   *
   * Prior-send reuse (`onUseSendLists`) stays on `canAttach`: it carries the earlier send's OWN
   * exclusions rather than the ticked ones, so a pending lookup cannot empty it.
   */
  public readonly canUseExistingMaster = input(false);
  /** The id of the send or master list an attach is in flight for, so only its button spins. */
  public readonly attachingId = input<string | null>(null);
  /** The master list id currently recorded as this email's send list, if any. */
  public readonly attachedListId = input<string | null>(null);
  /**
   * The master id to mark as attached in the master-list grid: `attachedListId`, but only while the
   * recorded exclusions still match the ones now ticked.
   *
   * Separate because a master row's reuse button submits the CURRENT ticks. Matched on the id
   * alone, it stayed disabled after the ticks changed, so the new exclusions could not be recorded.
   */
  public readonly attachedMasterId = input<string | null>(null);
  /**
   * The exclusions behind the current attachment.
   *
   * Matching a prior send on its include list ALONE treated two sends that share a master but
   * suppress differently as the same audience: attaching either marked both "Same lists used for
   * this email" and disabled both reuse buttons, so the operator could not then pick the other
   * send's exclusions. The full selection is what identifies a send.
   */
  public readonly attachedExclusionIds = input<readonly string[]>([]);

  // === Outputs ===
  /** Add one of a past send's lists to the inclusion set. */
  public readonly addList = output<AudienceListBrief>();
  /** Add an already-built master list to the inclusion set. */
  public readonly addMasterList = output<AudienceMasterListBrief>();
  /** Copy a past send's whole selection — its inclusions AND suppressions — into steps 2-3. */
  public readonly copySelection = output<AudienceLastSentEmail>();
  /** Attach a past send's include list and suppressions to this email, composing nothing. */
  public readonly useSendLists = output<AudienceLastSentEmail>();
  /** Attach an already-built master list to this email as its send list, composing nothing. */
  public readonly useMasterList = output<AudienceMasterListBrief>();

  // === Protected Methods ===
  /**
   * Rows pre-decorated with `selected` / `sizeText`, so the template reads properties instead of
   * calling isSelected()/sizeLabel() on every change-detection pass
   * (`docs/reviews/frontend-checklist.md` §4).
   */
  protected readonly masterRows = computed(() => {
    const selected = this.selectedIds();
    const attached = this.attachedMasterId();
    return this.masterLists().map((list) => ({
      ...list,
      selected: selected.has(list.listId),
      attached: attached === list.listId,
      sizeText: this.sizeLabel(list.size),
    }));
  });

  protected readonly emailRows = computed(() => {
    const selected = this.selectedIds();
    const attached = this.attachedListId();
    // Generic so the decorated row keeps every field of the original — narrowing the parameter
    // type here silently drops `name`, `missing` and anything else the template reads.
    const decorate = <T extends { listId: string; size?: number }>(list: T) => ({
      ...list,
      selected: selected.has(list.listId),
      sizeText: this.sizeLabel(list.size),
    });
    return this.emails().map((email) => {
      const usable = email.includedLists.filter((list) => !list.missing);
      // Counted over the lists that REPORTED a size, not over all of them with an absent size
      // read as zero. HubSpot omits the size property on some list shapes, so summing those as
      // zero leaves the total short by that entire list -- and the label below then presents a
      // partial sum as the reach, understating how many people a send actually touched.
      const sized = usable.filter((list) => list.size !== undefined);
      const knownMemberships = sized.reduce((sum, list) => sum + (list.size ?? 0), 0);
      // Counted against EVERY included list, not just the resolvable ones. `usable` drops the
      // missing ones, so a send whose third list was deleted reported "across 2 of 2" and read
      // as complete -- the completeness claim silently excluded the thing that made it
      // incomplete.
      const accountedFor = email.includedLists.length;
      const blocked = this.attachBlockedReason(email);
      // Compared as SETS: order is the portal's, not the operator's, and a different order is
      // the same selection.
      const sameExclusions = (lists: readonly AudienceListBrief[]): boolean => {
        const sent = new Set(this.attachedExclusionIds());
        const theirs = new Set(lists.map((list) => list.listId));
        return sent.size === theirs.size && [...theirs].every((id) => sent.has(id));
      };
      return {
        ...email,
        includedLists: email.includedLists.map(decorate),
        suppressionLists: email.suppressionLists.map(decorate),
        copyable: !email.listsUnavailable && usable.length > 0,
        attachBlocked: blocked,
        attached: blocked === null && attached !== null && usable[0]?.listId === attached && sameExclusions(email.suppressionLists),
        reachText: reportedMembershipsLabel(sized.length, accountedFor, knownMemberships),
      };
    });
  });

  protected isSelected(listId: string): boolean {
    return this.selectedIds().has(listId);
  }

  protected sizeLabel(size?: number): string {
    return size === undefined ? 'size unknown' : `${size.toLocaleString('en-US')} contacts`;
  }

  protected onAddList(list: AudienceListBrief): void {
    // A missing list is unusable, not merely unlabelled: `missing` means the v3 lookup AND the
    // legacy-id recovery both failed, so there is no list behind the id to include.
    if (!this.disabled() && !list.missing) {
      this.addList.emit(list);
    }
  }

  protected onAddMasterList(list: AudienceMasterListBrief): void {
    if (!this.disabled()) {
      this.addMasterList.emit(list);
    }
  }

  protected onCopySelection(email: AudienceLastSentEmail): void {
    if (!this.disabled() && !email.listsUnavailable) {
      this.copySelection.emit(email);
    }
  }

  protected onUseSendLists(email: AudienceLastSentEmail): void {
    if (this.canAttach() && this.attachingId() === null && this.attachBlockedReason(email) === null) {
      this.useSendLists.emit(email);
    }
  }

  protected onUseMasterList(list: AudienceMasterListBrief): void {
    if (this.canUseExistingMaster() && this.attachingId() === null) {
      this.useMasterList.emit(list);
    }
  }

  /**
   * Why a past send's lists cannot be attached as-is, or null when they can.
   *
   * An email sends to ONE include list (dispatch sets a single send list plus suppressions), so a
   * send that included several lists cannot be replayed without combining them — that is what
   * "Copy selection" and a compose are for. A missing suppression is refused rather than skipped:
   * attaching with less suppression than the earlier send used is a compliance regression.
   */
  private attachBlockedReason(email: AudienceLastSentEmail): string | null {
    if (email.listsUnavailable) {
      return 'The list selection of this send could not be read.';
    }
    const usable = email.includedLists.filter((list) => !list.missing);
    if (usable.length === 0) {
      return 'None of the lists this send included still exist.';
    }
    if (email.includedLists.length > 1) {
      return 'This send included several lists. Copy the selection, then compose one master list below.';
    }
    if (email.suppressionLists.some((list) => list.missing)) {
      return 'A suppression list this send used no longer resolves. Copy the selection and review suppression instead.';
    }
    return null;
  }
}
