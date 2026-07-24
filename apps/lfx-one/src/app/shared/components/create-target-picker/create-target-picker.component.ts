// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { COMMITTEE_WRITE_ARTIFACT_TYPES, EMPTY_CREATE_PICKER_RESULT } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatePickerNode, CreatePickerResultSet } from '@lfx-one/shared/interfaces';
import { CreateTargetPickerService } from '@services/create-target-picker.service';
import { debounceTime, distinctUntilChanged, of, startWith, switchMap, tap } from 'rxjs';

import { CreateTargetTreeNodeComponent } from './create-target-tree-node.component';

const MIN_SEARCH_LENGTH = 2;

/**
 * Create-flow target picker (LFXV2-2838): a lazy direct-grant tree by default, switching to
 * type-ahead search (≥2 chars) whose results are batch-access-checked per page. Replaces the
 * writer-scoped `project-selector` embed the create dialog used previously — this component
 * never pulls the full project list, and it renders committee rows too where the artifact type
 * allows a committee-scoped writer to create against them.
 */
@Component({
  selector: 'lfx-create-target-picker',
  imports: [ReactiveFormsModule, CreateTargetTreeNodeComponent],
  templateUrl: './create-target-picker.component.html',
})
export class CreateTargetPickerComponent {
  private readonly pickerService = inject(CreateTargetPickerService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly artifactType = input.required<CreatableArtifactType>();
  public readonly selectedTarget = input<CreatePickerNode | null>(null);

  public readonly targetSelected = output<CreatePickerNode>();
  // Emitted whenever the search term changes — the caller's `selectedTarget` may no longer be part
  // of the view this produces (tree vs. search, or a different search term entirely), so a stale
  // pick must not stay selectable/continuable. See create-artifact-dialog's canContinue.
  public readonly selectionCleared = output<void>();

  protected readonly searchControl = new FormControl<string>('');

  /** Whether this artifact type allows a committee-scoped writer to create against it — drives the search placeholder and empty-state copy. */
  protected readonly supportsCommitteeTarget: Signal<boolean> = computed(() => COMMITTEE_WRITE_ARTIFACT_TYPES.includes(this.artifactType()));
  protected readonly searchPlaceholder: Signal<string> = computed(() =>
    this.supportsCommitteeTarget() ? 'Search projects and groups...' : 'Search projects...'
  );

  protected readonly searchTerm = this.initSearchTerm();
  protected readonly isSearching: Signal<boolean> = computed(() => (this.searchTerm() ?? '').trim().length >= MIN_SEARCH_LENGTH);

  private readonly treeLoadedSignal: WritableSignal<boolean> = signal(false);
  private readonly searchLoadedSignal: WritableSignal<boolean> = signal(false);

  protected readonly treeResult: Signal<CreatePickerResultSet> = this.initTreeResult();
  protected readonly searchResult: Signal<CreatePickerResultSet> = this.initSearchResult();
  protected readonly treeLoaded: Signal<boolean> = this.treeLoadedSignal.asReadonly();
  protected readonly searchLoaded: Signal<boolean> = this.searchLoadedSignal.asReadonly();

  protected readonly selectedKey: Signal<string | null> = computed(() => {
    const target = this.selectedTarget();
    return target ? `${target.kind}:${target.uid}` : null;
  });

  protected readonly activeResult: Signal<CreatePickerResultSet> = computed(() => (this.isSearching() ? this.searchResult() : this.treeResult()));
  protected readonly loaded: Signal<boolean> = computed(() => (this.isSearching() ? this.searchLoaded() : this.treeLoaded()));
  protected readonly isEmpty: Signal<boolean> = computed(() => {
    const result = this.activeResult();
    return this.loaded() && result.projects.length === 0 && result.committees.length === 0;
  });

  public constructor() {
    this.searchControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.selectionCleared.emit());
  }

  protected onNodeSelected(node: CreatePickerNode): void {
    this.targetSelected.emit(node);
  }

  private initSearchTerm() {
    return toSignal(this.searchControl.valueChanges.pipe(startWith(''), distinctUntilChanged()), { initialValue: '' });
  }

  private initTreeResult(): Signal<CreatePickerResultSet> {
    return toSignal(
      toObservable(this.artifactType).pipe(
        switchMap((artifactType) => this.pickerService.getTree(artifactType)),
        tap(() => this.treeLoadedSignal.set(true))
      ),
      { initialValue: EMPTY_CREATE_PICKER_RESULT }
    );
  }

  private initSearchResult(): Signal<CreatePickerResultSet> {
    return toSignal(
      this.searchControl.valueChanges.pipe(
        startWith(''),
        distinctUntilChanged(),
        tap(() => this.searchLoadedSignal.set(false)),
        debounceTime(300),
        switchMap((term) => {
          const trimmed = (term ?? '').trim();
          if (trimmed.length < MIN_SEARCH_LENGTH) {
            return of(EMPTY_CREATE_PICKER_RESULT);
          }
          // No catchError here — CreateTargetPickerService.search() already fails closed to EMPTY_CREATE_PICKER_RESULT.
          return this.pickerService.search(trimmed, this.artifactType());
        }),
        tap(() => this.searchLoadedSignal.set(true))
      ),
      { initialValue: EMPTY_CREATE_PICKER_RESULT }
    );
  }
}
