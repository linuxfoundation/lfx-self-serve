// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import type { Project, ProjectApplicationAcceptChoice, ProjectApplicationAcceptDialogData } from '@lfx-one/shared/interfaces';
import { projectSlugFromName } from '@lfx-one/shared/utils';
import { projectSlugValidator } from '@lfx-one/shared/validators';
import { ProjectService } from '@services/project.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, switchMap } from 'rxjs';

/**
 * Accept step for a project application (#3037), opened via `DialogService.open()`. Accepting also creates
 * the project (#1995), so the formation team picks the parent project it is created under and its slug
 * (prefilled from the proposed name). The dialog closes with `{ parent, slug }`, or with nothing when cancelled.
 */
@Component({
  selector: 'lfx-project-application-accept-dialog',
  imports: [AutocompleteComponent, ButtonComponent, InputTextComponent, ReactiveFormsModule],
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
    slug: new FormControl<string>(this.data?.projectSlug || projectSlugFromName(this.data?.projectName), {
      nonNullable: true,
      validators: [Validators.required, projectSlugValidator()],
    }),
  });

  // === Writable Signals ===
  protected readonly suggestions = signal<Project[]>([]);
  protected readonly selectedParent = signal<Project | null>(null);
  protected readonly slugValid = signal(this.form.controls.slug.valid);
  /** Shown only once the slug has been edited, so a prefill the team hasn't touched isn't flagged as an error. */
  protected readonly slugError = signal(false);
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

    this.form.controls.slug.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const valid = this.form.controls.slug.valid;
      this.slugValid.set(valid);
      this.slugError.set(!valid);
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
    const slugControl = this.form.controls.slug;
    if (slugControl.invalid) {
      this.slugError.set(true);
    }
    if (!parent || slugControl.invalid) return;
    const choice: ProjectApplicationAcceptChoice = { parent, slug: slugControl.value };
    this.dialogRef.close(choice);
  }

  // === Private Helpers ===
  private asProject(value: Project | string | null): Project | null {
    return value !== null && typeof value === 'object' && !!value.uid ? value : null;
  }
}
