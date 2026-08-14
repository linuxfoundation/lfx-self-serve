// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerContext, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';

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
   * refresh off this rather than off `isOpen`, which also fires on a cancelled open.
   */
  private readonly _saveCount = signal(0);
  public readonly saveCount = this._saveCount.asReadonly();

  public readonly isOpen = computed(() => this._context() !== null);
  public readonly isQuickCreate = computed(() => this._context()?.variant === 'quick');

  public open(context: MeetingComposerContext): void {
    const section = context.section ?? FIRST_SECTION;
    this._activeSection.set(section);
    this._visitedSections.set(new Set([section]));
    this._context.set(context);
  }

  public close(): void {
    this._context.set(null);
    this._activeSection.set(FIRST_SECTION);
    this._visitedSections.set(new Set([FIRST_SECTION]));
  }

  public notifySaved(): void {
    this._saveCount.update((count) => count + 1);
  }

  public setSection(section: MeetingComposerSectionId): void {
    this._activeSection.set(section);
    this._visitedSections.update((visited) => new Set(visited).add(section));
  }
}
