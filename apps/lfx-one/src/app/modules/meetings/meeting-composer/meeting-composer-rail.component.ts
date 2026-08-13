// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, type Signal } from '@angular/core';
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

  protected readonly rows: Signal<MeetingComposerRailRow[]> = this.initRows();

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

      const sections = MEETING_COMPOSER_SECTIONS as readonly MeetingComposerSection[];
      const activeSection = this.composer.activeSection();
      const visited = this.composer.visitedSections();
      const isEditMode = this.composer.isEditMode();
      const completeById = new Map<MeetingComposerSectionId, boolean>(
        sections.map((section) => [section.id, section.required ? this.formService.isSectionValid(section.id) : visited.has(section.id)])
      );

      return sections.map((section, index) => {
        const active = section.id === activeSection;
        const valid = this.formService.isSectionValid(section.id);
        const locked = !isEditMode && sections.slice(0, index).some((earlier) => earlier.required && !this.formService.isSectionValid(earlier.id));
        const previous = sections[index - 1];

        return {
          section,
          active,
          complete: (completeById.get(section.id) ?? false) && !active,
          locked,
          needsAttention: !isEditMode && section.required && active && !valid,
          lineAboveComplete: index > 0 && (completeById.get(previous.id) ?? false),
          lineBelowComplete: completeById.get(section.id) ?? false,
          isFirst: index === 0,
          isLast: index === sections.length - 1,
        };
      });
    });
  }
}
