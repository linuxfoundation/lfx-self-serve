// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';

import { AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS, AUDIENCE_SIGNAL_INFO, AUDIENCE_SPEAKER_SCOPES } from '@lfx-one/shared/constants';
import type { AudienceListSearchResult, AudienceSignal } from '@lfx-one/shared/interfaces';

/**
 * "Qualifying lists not found" — the signals discovery could not fill, and a manual escape hatch.
 *
 * Auto-creating a list for a missing signal is deliberately absent: correct filters need
 * portal-specific facts (the per-project subscription property, the `hosted_events` property, the
 * page-view filter shape) that are not knowable from here, and a guess would create a real,
 * wrongly-filtered contact list in the production portal. Search-and-add covers the same need
 * with the operator supplying the judgement.
 */
@Component({
  selector: 'lfx-audience-missing-signals',
  imports: [ReactiveFormsModule],
  templateUrl: './audience-missing-signals.component.html',
  styleUrl: './audience-missing-signals.component.scss',
})
export class AudienceMissingSignalsComponent {
  // === Services ===
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly missingSignals = input<readonly AudienceSignal[]>([]);
  public readonly searchResults = input<readonly AudienceListSearchResult[]>([]);
  public readonly searching = input(false);
  public readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  public readonly disabled = input(false);

  // === Outputs ===
  /** A debounced, de-duplicated typeahead query. The container owns the request. */
  public readonly search = output<string>();
  public readonly addList = output<AudienceListSearchResult>();

  // === Forms ===
  protected readonly searchControl = new FormControl('', { nonNullable: true });

  // === Constants ===
  protected readonly speakerScopes = AUDIENCE_SPEAKER_SCOPES;

  // === Computed Signals ===
  /** Each missing signal with the same label and guidance the review grid uses for its buckets. */
  protected readonly missing = computed(() =>
    this.missingSignals().map((signal) => ({ signal, label: AUDIENCE_SIGNAL_INFO[signal].label, description: AUDIENCE_SIGNAL_INFO[signal].description }))
  );

  public constructor() {
    // Debounced in the child that owns the input, so a keystroke is not a HubSpot search. The
    // request itself stays in the container: the results feed a selection the container owns, and
    // a second caller of the search endpoint would be a second place to keep that in step.
    this.searchControl.valueChanges
      .pipe(
        map((value) => value.trim()),
        debounceTime(AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((query) => this.search.emit(query));

    // Disabling a reactive control goes through the CONTROL, not a `[disabled]` binding on the
    // element: the binding fights the ReactiveForms directive and Angular warns it can produce a
    // changed-after-checked error. The container documents the same rule for its own url control.
    toObservable(this.disabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((disabled) => {
        if (disabled) {
          this.searchControl.disable({ emitEvent: false });
        } else {
          this.searchControl.enable({ emitEvent: false });
        }
      });
  }

  // === Protected Methods ===
  protected isSelected(listId: string): boolean {
    return this.selectedIds().has(listId);
  }

  protected sizeLabel(size?: number): string {
    return size === undefined ? 'size unknown' : `${size.toLocaleString('en-US')} contacts`;
  }

  protected onAdd(list: AudienceListSearchResult): void {
    if (!this.disabled()) {
      this.addList.emit(list);
    }
  }
}
