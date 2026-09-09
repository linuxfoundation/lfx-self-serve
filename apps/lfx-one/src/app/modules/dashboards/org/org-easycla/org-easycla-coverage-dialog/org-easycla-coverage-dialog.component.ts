// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import type { OrgClaCoverageDialogData, OrgClaGroup, OrgClaGroupProject } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { scan } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

/**
 * How this dialog is opened, owned here rather than by each caller.
 *
 * Two surfaces open it — a list card and the agreement detail header — and they must present the
 * same agreement identically. Left to the call sites, the header string and the width are two more
 * things that can drift apart, and the drift would only ever be visible to whoever opened both.
 */
export function orgClaCoverageDialogConfig(group: OrgClaGroup): DynamicDialogConfig<OrgClaCoverageDialogData> {
  return {
    header: `Projects covered by ${group.claGroupName}`,
    modal: true,
    // The approved design gives this dialog 560px, and it needs the room: the header carries a CLA
    // Group name, and below 36rem a typical one wraps to two lines and takes the subset caveat with
    // it. 36rem is the nearest width the application already uses, so this asks for no new value.
    width: '36rem',
    // The Aura dialog preset caps nothing, so a fixed width alone runs off a 360–390px phone,
    // taking the list's right edge and the Close control with it.
    style: { maxWidth: '90vw' },
    data: { claGroupName: group.claGroupName, foundationName: group.foundationName, projects: group.projects },
  };
}

@Component({
  selector: 'lfx-org-easycla-coverage-dialog',
  imports: [ButtonComponent, InputTextComponent],
  templateUrl: './org-easycla-coverage-dialog.component.html',
})
export class OrgEasyclaCoverageDialogComponent {
  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaCoverageDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly claGroupName = this.dialogConfig.data?.claGroupName ?? '';
  protected readonly projects: OrgClaGroupProject[] = this.dialogConfig.data?.projects ?? [];

  // Naming the foundation without this caveat invites the reading that the agreement covers
  // everything under it, which is the opposite of what the listed subset means.
  protected readonly coverageHint = this.dialogConfig.data?.foundationName
    ? `Part of ${this.dialogConfig.data.foundationName} — this CLA covers the projects below, not necessarily every project in the foundation.`
    : 'This CLA covers the projects below.';

  // One source for both ends of the no-match state: the visible line and the announcement below
  // have to say the same thing, and holding the sentence twice is how they stop.
  protected readonly noMatchMessage = 'No covered projects match your search.';
  protected readonly restoredMessage = 'Search cleared. Showing all covered projects.';

  protected readonly searchForm = new FormGroup({ search: new FormControl('', { nonNullable: true }) });

  // Undebounced, unlike the org pages' search fields. Those debounce a filter over a roster or a
  // server query; this one filters an array the dialog was handed at construction, so the work per
  // keystroke is a substring test over a handful of names and a delay would only be felt as lag.
  private readonly searchState = toSignal(
    this.searchForm.controls.search.valueChanges.pipe(
      scan(
        (prev: { trimmed: string; justCleared: boolean }, value: string) => {
          const trimmed = value.trim();
          return {
            trimmed,
            // Empty on open and empty after a clear are the same value; `justCleared` is the one
            // event that means the full list came back, not the initial render.
            justCleared: prev.trimmed.length > 0 && trimmed.length === 0,
          };
        },
        { trimmed: '', justCleared: false }
      )
    ),
    { initialValue: { trimmed: '', justCleared: false } }
  );
  protected readonly filteredProjects = this.initFilteredProjects();
  protected readonly filterAnnouncement = this.initFilterAnnouncement();

  protected close(): void {
    this.dialogRef.close();
  }

  private initFilteredProjects(): Signal<OrgClaGroupProject[]> {
    return computed(() => {
      const term = this.searchState().trimmed.toLowerCase();
      return term ? this.projects.filter((project) => project.projectName.toLowerCase().includes(term)) : this.projects;
    });
  }

  /**
   * What the filter did, for assistive tech.
   *
   * Focus stays in the search field while the list behind it changes, so nothing about the result
   * reaches a screen reader otherwise — the rows are not focusable and the no-match line is inserted
   * already populated, which is exactly the case a live region is frequently not announced for.
   *
   * Computed from the filtered set rather than assigned per keystroke, so the narration cannot
   * disagree with the rows on screen. Silent on open and on a whitespace-only field; announces
   * when a clear puts the full list back.
   */
  private initFilterAnnouncement(): Signal<string> {
    return computed(() => {
      const { trimmed, justCleared } = this.searchState();
      if (!trimmed) return justCleared ? this.restoredMessage : '';

      const count = this.filteredProjects().length;
      if (count === 0) return this.noMatchMessage;
      return count === 1 ? '1 project matches your search.' : `${count} projects match your search.`;
    });
  }
}
