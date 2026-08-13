// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerContext, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';

const FIRST_SECTION: MeetingComposerSectionId = MEETING_COMPOSER_SECTIONS[0].id;

/**
 * Cross-page open state for the meeting composer (LFXV2-3234).
 * @description Any entry point can call `open()`; the globally mounted
 * `MeetingComposerHostComponent` renders the drawer, so the composer survives navigation.
 */
@Injectable({
  providedIn: 'root',
})
export class MeetingComposerService {
  private readonly _context = signal<MeetingComposerContext | null>(null);
  public readonly context = this._context.asReadonly();

  private readonly _activeSection = signal<MeetingComposerSectionId>(FIRST_SECTION);
  public readonly activeSection = this._activeSection.asReadonly();

  public readonly isOpen = computed(() => this._context() !== null);
  public readonly isEditMode = computed(() => this._context()?.mode === 'edit');

  public open(context: MeetingComposerContext): void {
    this._activeSection.set(context.section ?? FIRST_SECTION);
    this._context.set(context);
  }

  public close(): void {
    this._context.set(null);
    this._activeSection.set(FIRST_SECTION);
  }

  public setSection(section: MeetingComposerSectionId): void {
    this._activeSection.set(section);
  }
}
