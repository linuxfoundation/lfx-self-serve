// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, EMPTY, merge, of, startWith, switchMap } from 'rxjs';

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

  public form = input.required<FormGroup>();
  /** Name of the parent-form control holding the selected project's uid (null = "let LF decide"). */
  public uidControl = input.required<string>();

  public readonly onProjectSelect = output<Project>();

  protected readonly searchForm = new FormGroup({ query: new FormControl('', { nonNullable: true }) });

  /** The selected project's display name, shown in place of the search box once a pick is made. */
  protected readonly selectedName = signal<string | null>(null);

  private readonly query: Signal<string> = toSignal(this.searchForm.controls.query.valueChanges, { initialValue: '' });

  protected readonly hasSelection = signal(false);

  protected readonly results: Signal<Project[]> = toSignal(
    this.searchForm.controls.query.valueChanges.pipe(
      startWith(''),
      distinctUntilChanged(),
      debounceTime(300),
      switchMap((term) => {
        const trimmed = term.trim();
        if (trimmed.length < 2) return of([]);
        return this.projectService.searchProjects(trimmed).pipe(catchError(() => of([])));
      })
    ),
    { initialValue: [] }
  );

  public constructor() {
    // Sync selection state with the parent form (e.g. a ?parent= prefill patched in after load).
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
  }

  protected select(project: Project): void {
    this.form().get(this.uidControl())?.setValue(project.uid);
    this.selectedName.set(project.name);
    this.hasSelection.set(true);
    this.searchForm.controls.query.setValue('');
    this.onProjectSelect.emit(project);
  }

  protected clear(): void {
    this.form().get(this.uidControl())?.setValue(null);
    this.selectedName.set(null);
    this.hasSelection.set(false);
  }

  protected hasQuery(): boolean {
    return this.query().trim().length >= 2;
  }
}
