// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import type { Project, ProjectApplicationAcceptDialogData } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, switchMap } from 'rxjs';

/**
 * Accept step for a project application (#3037), opened via `DialogService.open()`. The formation team
 * picks the parent project the new project is created under; the dialog closes with that `Project`, or
 * with nothing when cancelled.
 */
@Component({
  selector: 'lfx-project-application-accept-dialog',
  imports: [AutocompleteComponent, ButtonComponent, ReactiveFormsModule],
  templateUrl: './project-application-accept-dialog.component.html',
})
export class ProjectApplicationAcceptDialogComponent {
  // === Services ===
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<ProjectApplicationAcceptDialogData>);
  private readonly projectService = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs from dialog data ===
  public readonly data = this.dialogConfig.data as ProjectApplicationAcceptDialogData;

  // === Forms ===
  public readonly form = new FormGroup({
    parent: new FormControl<Project | string | null>(null),
  });

  // === Writable Signals ===
  protected readonly suggestions = signal<Project[]>([]);
  protected readonly selectedParent = signal<Project | null>(null);
  private readonly query$ = new Subject<string>();

  // === Constructor ===
  public constructor() {
    // switchMap drops a superseded search, so a slow response for an older query can't replace newer results.
    this.query$
      .pipe(
        switchMap((query) => (query.length < 2 ? of<Project[]>([]) : this.projectService.searchProjects(query))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((projects) => this.suggestions.set(projects.filter((project) => !!project.uid)));

    // The control is the source of truth: only a project with a UID is a selection. With forceSelection,
    // PrimeNG writes `null` (not the typed text) when unmatched input blurs — which a click on Confirm does —
    // so anything that isn't a project clears the choice and Confirm can't send one the field no longer shows.
    this.form.controls.parent.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.selectedParent.set(this.asProject(value));
    });
  }

  // === Protected Methods ===
  protected search(event: AutoCompleteCompleteEvent): void {
    this.query$.next((event.query ?? '').trim());
  }

  protected onSelected(event: AutoCompleteSelectEvent): void {
    this.selectedParent.set((event.value as Project) ?? null);
  }

  protected onCleared(): void {
    this.selectedParent.set(null);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onConfirm(): void {
    // Re-read the control rather than trusting the signal alone: whatever the field holds now is what is sent.
    const parent = this.asProject(this.form.controls.parent.value);
    if (!parent) return;
    this.dialogRef.close(parent);
  }

  // === Private Helpers ===
  private asProject(value: Project | string | null): Project | null {
    return value !== null && typeof value === 'object' && !!value.uid ? value : null;
  }
}
