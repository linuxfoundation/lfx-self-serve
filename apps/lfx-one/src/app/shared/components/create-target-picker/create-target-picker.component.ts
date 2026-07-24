// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal, WritableSignal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { COMMITTEE_WRITE_ARTIFACT_TYPES, CREATE_PICKER_MIN_SEARCH_LENGTH, EMPTY_CREATE_PICKER_RESULT } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatePickerNode, CreatePickerResultSet } from '@lfx-one/shared/interfaces';
import { CreateTargetPickerService } from '@services/create-target-picker.service';
import { distinctUntilChanged, filter, map, of, pairwise, startWith, switchMap, tap, timer } from 'rxjs';

import { CreateTargetTreeNodeComponent } from './create-target-tree-node.component';

const SEARCH_DEBOUNCE_MS = 300;

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
  // Emitted whenever the active view changes in a way that can invalidate the caller's
  // `selectedTarget` — entering search, changing the search term while already searching, or
  // leaving search back to the tree. NOT emitted for a keystroke that stays under
  // CREATE_PICKER_MIN_SEARCH_LENGTH while already under it — the tree view (and whatever was selected in it)
  // hasn't changed, so clearing there would drop a still-valid, still-visible tree selection.
  // See create-artifact-dialog's canContinue.
  public readonly selectionCleared = output<void>();

  protected readonly searchControl = new FormControl<string>('');

  /** Whether this artifact type allows a committee-scoped writer to create against it — drives the search placeholder and empty-state copy. */
  protected readonly supportsCommitteeTarget: Signal<boolean> = computed(() => COMMITTEE_WRITE_ARTIFACT_TYPES.includes(this.artifactType()));
  protected readonly searchPlaceholder: Signal<string> = computed(() =>
    this.supportsCommitteeTarget() ? 'Search projects and groups...' : 'Search projects...'
  );

  protected readonly searchTerm = this.initSearchTerm();
  protected readonly isSearching: Signal<boolean> = computed(() => (this.searchTerm() ?? '').trim().length >= CREATE_PICKER_MIN_SEARCH_LENGTH);

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
    this.searchControl.valueChanges
      .pipe(
        startWith(''),
        map((term) => (term ?? '').trim().length >= CREATE_PICKER_MIN_SEARCH_LENGTH),
        pairwise(),
        filter(([wasSearching, isSearchingNow]) => wasSearching || isSearchingNow),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.selectionCleared.emit());
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
        // The debounce lives INSIDE switchMap's inner observable (not as its own operator before
        // it) so a new keystroke cancels it immediately, whether the prior term is still waiting
        // out its debounce window or already has a request in flight — otherwise a slow request
        // for a stale term could resolve after the user has moved on to a new term but before the
        // new term's own debounce fires, briefly showing/selecting results for a query that's no
        // longer on screen.
        switchMap((term) =>
          timer(SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() => {
              const trimmed = (term ?? '').trim();
              if (trimmed.length < CREATE_PICKER_MIN_SEARCH_LENGTH) {
                return of(EMPTY_CREATE_PICKER_RESULT);
              }
              // No catchError here — CreateTargetPickerService.search() already fails closed to EMPTY_CREATE_PICKER_RESULT.
              return this.pickerService.search(trimmed, this.artifactType());
            })
          )
        ),
        tap(() => this.searchLoadedSignal.set(true))
      ),
      { initialValue: EMPTY_CREATE_PICKER_RESULT }
    );
  }
}
