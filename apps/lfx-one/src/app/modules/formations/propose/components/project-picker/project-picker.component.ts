// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { combineLatest, debounceTime, distinctUntilChanged, EMPTY, merge, of, startWith, switchMap } from 'rxjs';

/**
 * Parent-project picker for the intake form's Parent section. Deliberately not
 * `lfx-create-target-picker` — that component's batch-access-check and `artifactType` concept
 * are tailored to write-permission-gated artifact creation, which doesn't apply here (any
 * logged-in user can propose, per the 30 Aug Epic 1 decision). Reuses the plain
 * `ProjectService.searchProjects` typeahead instead, matching `org-roi-project-picker`'s
 * debounce shape.
 */
@Component({
  selector: 'lfx-project-picker',
  imports: [InputTextComponent, ReactiveFormsModule],
  templateUrl: './project-picker.component.html',
})
export class ProjectPickerComponent {
  private readonly projectService = inject(ProjectService);

  public readonly form = input.required<FormGroup>();
  /** Name of the parent-form control holding the selected project's uid (null = "let LF decide"). */
  public readonly uidControl = input.required<string>();
  /** A project resolved asynchronously by the parent (e.g. a `?parent=` slug lookup) whose uid
   *  was already patched into `uidControl` before this component could reflect it in its own
   *  display — pass it through here so the picker shows the pick instead of an empty search box. */
  public readonly initialSelection = input<Project | null>(null);

  protected readonly searchForm = new FormGroup({ query: new FormControl('', { nonNullable: true }) });

  /** The selected project's display name, shown in place of the search box once a pick is made. */
  protected readonly selectedName = signal<string | null>(null);
  protected readonly hasSelection = signal(false);

  private readonly query: Signal<string> = toSignal(this.searchForm.controls.query.valueChanges, { initialValue: '' });
  protected readonly hasQuery: Signal<boolean> = computed(() => this.query().trim().length >= 2);
  protected readonly results: Signal<Project[]> = this.initResults();

  public constructor() {
    // Sync selection state with the parent form (e.g. a manual external reset of the uid control).
    combineLatest([toObservable(this.form), toObservable(this.uidControl)])
      .pipe(
        switchMap(([parentForm, controlName]) => {
          const ctrl = parentForm.get(controlName);
          if (!ctrl) return EMPTY;
          return merge(of(ctrl.value as string | null), ctrl.valueChanges);
        }),
        takeUntilDestroyed()
      )
      .subscribe((uid) => {
        if (!uid) {
          this.hasSelection.set(false);
          this.selectedName.set(null);
        }
      });

    // Reflect a parent-resolved prefill (see `initialSelection`'s doc) once it arrives — its uid
    // is already on the form, so this only needs to update this component's own display state,
    // not re-run `select()`: that would also wipe an in-progress search query. Skipped entirely
    // once the user has made their own pick (`hasSelection()`), so a slow prefill resolving after
    // a manual selection can't silently overwrite it.
    toObservable(this.initialSelection)
      .pipe(takeUntilDestroyed())
      .subscribe((project) => {
        if (project && !this.hasSelection()) {
          this.selectedName.set(project.name);
          this.hasSelection.set(true);
        }
      });
  }

  protected select(project: Project): void {
    // markAsDirty (not just setValue) so a real user pick is distinguishable from the
    // `?parent=` prefill's own patchValue — see `ProposeComponent.prefillParentFromQueryParam`,
    // which checks this control's `dirty` flag before applying a slow-resolving prefill.
    const control = this.form().get(this.uidControl());
    control?.setValue(project.uid);
    control?.markAsDirty();
    this.selectedName.set(project.name);
    this.hasSelection.set(true);
    this.searchForm.controls.query.setValue('');
  }

  protected clear(): void {
    const control = this.form().get(this.uidControl());
    control?.setValue(null);
    control?.markAsDirty();
    this.selectedName.set(null);
    this.hasSelection.set(false);
  }

  private initResults(): Signal<Project[]> {
    return toSignal(
      this.searchForm.controls.query.valueChanges.pipe(
        startWith(''),
        distinctUntilChanged(),
        debounceTime(300),
        switchMap((term) => {
          const trimmed = term.trim();
          if (trimmed.length < 2) return of([]);
          // No catchError here: ProjectService.searchProjects already logs (console.error) and
          // degrades to of([]) internally, and frontend-checklist.md §14.6 ("Handle errors in one
          // place") is explicit that a component-level catchError over an already-handled stream
          // is dead code to be removed, not kept defensively. Final call — see propose.component.ts's
          // initDuplicateNameMatch for the same resolution on the same upstream call.
          return this.projectService.searchProjects(trimmed);
        })
      ),
      { initialValue: [] }
    );
  }
}
