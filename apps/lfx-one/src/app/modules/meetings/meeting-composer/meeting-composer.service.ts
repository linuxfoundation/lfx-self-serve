// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import { MEETING_COMPOSER_SECTIONS, MEETING_QUICK_CREATE_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerContext, MeetingComposerSectionId, MeetingComposerVariant } from '@lfx-one/shared/interfaces';

const FIRST_SECTION: MeetingComposerSectionId = MEETING_COMPOSER_SECTIONS[0].id;

/**
 * Cross-page open state for the meeting composer (GH-1452).
 * @description Any entry point can call `open()`; `MeetingComposerHostComponent` — deferred in
 * `app.component.html` until the first open — renders the drawer, so the composer survives navigation.
 */
@Injectable({
  providedIn: 'root',
})
export class MeetingComposerService {
  private readonly _context = signal<MeetingComposerContext | null>(null);
  public readonly context = this._context.asReadonly();

  private readonly _activeSection = signal<MeetingComposerSectionId>(FIRST_SECTION);
  public readonly activeSection = this._activeSection.asReadonly();

  /**
   * Sections the organizer has landed on during this open.
   * @description The rail's only completion signal for optional sections, which are always valid and so
   * can't be told apart from untouched ones by validity alone.
   */
  private readonly _visitedSections = signal<ReadonlySet<MeetingComposerSectionId>>(new Set([FIRST_SECTION]));
  public readonly visitedSections = this._visitedSections.asReadonly();

  /**
   * Increments once per successful save.
   * @description Saving no longer navigates, so the page underneath the composer would otherwise keep
   * showing a list that predates the meeting the toast just announced. Surfaces that render meetings
   * refresh off this rather than off `isOpen`, which also fires on a cancelled open. Both surfaces the
   * composer opens over read it: the meetings dashboard and the committee Meetings tab (through
   * `CommitteeViewComponent`, which owns that tab's fetch).
   */
  private readonly _saveCount = signal(0);
  public readonly saveCount = this._saveCount.asReadonly();

  /**
   * Surface currently showing — held apart from the context, which only the entry point writes.
   * @description Seeded from `context.variant` on every open, then owned here, because
   * {@link switchToAdvanced} has to move the organizer from the dialog to the drawer *mid-fill*: the
   * host re-initializes the form on any write to `context`, so deriving the surface from it would
   * make the switch throw away everything the quick dialog was opened to collect.
   */
  private readonly _variant = signal<MeetingComposerVariant>('drawer');

  public readonly isOpen = computed(() => this._context() !== null);
  public readonly isQuickCreate = computed(() => this._variant() === 'quick');

  public open(context: MeetingComposerContext): void {
    const section = context.section ?? FIRST_SECTION;
    this._activeSection.set(section);
    this._visitedSections.set(new Set([section]));
    this._variant.set(context.variant ?? 'drawer');
    this._context.set(context);
  }

  public close(): void {
    this._context.set(null);
    this._activeSection.set(FIRST_SECTION);
    this._visitedSections.set(new Set([FIRST_SECTION]));
    this._variant.set('drawer');
  }

  /**
   * Moves an open quick create dialog into the full drawer, keeping the form exactly as it stands.
   * @description The two surfaces are fed by one `MeetingComposerFormService` instance, so the values
   * already entered need no copying — what they need is for nothing to reset them, which is why this
   * writes the surface alone and leaves `context` untouched. The form needs nothing done to it either:
   * the meeting type's access defaults belong to create mode rather than to the dialog, so the drawer
   * carries on with the same subscriptions.
   *
   * The dialog's sections carry over as visited. `visitedSections` means "the organizer has seen this",
   * and they have — the drawer is only a second view of a fill already in progress. Left unset, the rail
   * shows four sections they have already been through as untouched, and the preview withholds the rows
   * it gates on visitation rather than on a value — the recurrence card would stop reading "Does not
   * repeat" for a dialog the organizer had just declined to make recurring.
   */
  public switchToAdvanced(): void {
    this._variant.set('drawer');
    this._visitedSections.update((visited) => new Set([...visited, ...MEETING_QUICK_CREATE_SECTIONS]));
  }

  public notifySaved(): void {
    this._saveCount.update((count) => count + 1);
  }

  public setSection(section: MeetingComposerSectionId): void {
    this._activeSection.set(section);
    this._visitedSections.update((visited) => new Set(visited).add(section));
  }
}
