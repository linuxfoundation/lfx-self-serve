// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, type Signal } from '@angular/core';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerRailRow, MeetingComposerSection, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Left-rail section navigation for the meeting composer (LFXV2-3240).
 * @description Create mode is a progress stepper: later sections stay locked until every earlier
 * required section is valid, so the organizer can't skip past a section that would block submit.
 * Edit mode is a flat menu — the meeting already exists, so every section is reachable.
 */
@Component({
  selector: 'lfx-meeting-composer-rail',
  imports: [NgClass],
  templateUrl: './meeting-composer-rail.component.html',
})
export class MeetingComposerRailComponent {
  protected readonly composer = inject(MeetingComposerService);
  private readonly formService = inject(MeetingComposerFormService);

  /**
   * Renders as a horizontal chip row instead of a vertical stepper.
   * @description What the composer shows below `lg`, where the rail column is hidden: the same rows and
   * the same locking, laid out to fit above the section content.
   */
  public readonly compact = input(false);

  private readonly sections: readonly MeetingComposerSection[] = MEETING_COMPOSER_SECTIONS;

  protected readonly rows: Signal<MeetingComposerRailRow[]> = this.initRows();
  // Both layouts can be in the DOM at once, so their test ids have to differ.
  protected readonly testIdPrefix: Signal<string> = computed(() => (this.compact() ? 'meeting-composer-rail-compact' : 'meeting-composer-rail'));

  protected onSelect(row: MeetingComposerRailRow): void {
    if (row.locked || row.active) {
      return;
    }

    this.composer.setSection(row.section.id);
  }

  private initRows(): Signal<MeetingComposerRailRow[]> {
    return computed(() => {
      // FormGroup validity isn't reactive on its own — the revision signal is what makes it one.
      this.formService.revision();

      const sections = this.sections;
      const activeSection = this.composer.activeSection();
      const visited = this.composer.visitedSections();
      const isEditMode = this.composer.isEditMode();
      const validById = new Map<MeetingComposerSectionId, boolean>(sections.map((section) => [section.id, this.formService.isSectionValid(section.id)]));
      const isComplete = (section: MeetingComposerSection): boolean => (section.required ? (validById.get(section.id) ?? false) : visited.has(section.id));

      return sections.map((section, index) => {
        const active = section.id === activeSection;
        const valid = validById.get(section.id) ?? false;
        const blockedByEarlier = sections.slice(0, index).some((earlier) => earlier.required && !validById.get(earlier.id));

        return {
          section,
          active,
          complete: isComplete(section) && !active,
          // The organizer can be standing on a section an out-of-section validator has just invalidated
          // (enabling YouTube upload tightens the title's max length), so never lock the row they're on.
          locked: !isEditMode && blockedByEarlier && !active,
          needsAttention: !isEditMode && section.required && visited.has(section.id) && !valid,
          lineBelowComplete: isComplete(section),
          isLast: index === sections.length - 1,
        };
      });
    });
  }
}
