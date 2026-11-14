// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, inject, input, output, Signal, signal } from '@angular/core';
import { outputFromObservable, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FilterOption } from '@lfx-one/shared/interfaces';
import { debounceTime, distinctUntilChanged, finalize, map, of, shareReplay, skip, switchMap } from 'rxjs';
import { EventsService } from '@app/shared/services/events.service';
import { EVENT_ROLE_OPTIONS, MY_EVENT_STATUS_OPTIONS } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-events-top-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './events-top-bar.component.html',
})
export class EventsTopBarComponent {
  private readonly eventsService = inject(EventsService);

  public readonly isFoundationFilter = input<boolean>(false);
  public readonly showRoleFilter = input<boolean>(true);
  public readonly showStatusFilter = input<boolean>(true);
  public readonly projectName = input<string | undefined>(undefined);
  /** When true, foundation options are scoped to the user's registered past events */
  public readonly isPast = input<boolean>(false);
  public readonly registeredOnly = input<boolean | null>(false);
  public readonly foundation = input<string | null>(null);
  public readonly searchPlaceholder = input<string>('Search events...');
  public readonly searchQuery = input<string>('');
  public readonly searchQueryChange = output<string>();

  public readonly searchForm: FormGroup = new FormGroup({
    search: new FormControl(''),
    foundation: new FormControl<string | null>(null),
    role: new FormControl<string | null>(null),
    status: new FormControl<string | null>(null),
  });

  public readonly foundationChange = outputFromObservable<string | null>(this.searchForm.get('foundation')!.valueChanges);
  public readonly roleChange = outputFromObservable<string | null>(this.searchForm.get('role')!.valueChanges);
  public readonly statusChange = outputFromObservable<string | null>(this.searchForm.get('status')!.valueChanges);

  protected readonly roleOptions = signal<FilterOption[]>(EVENT_ROLE_OPTIONS);

  public readonly statusOptions = input<FilterOption[]>(MY_EVENT_STATUS_OPTIONS);

  protected readonly foundationOptionsLoading = signal(true);
  protected readonly searchValue = signal('');
  protected readonly foundationOptions: Signal<FilterOption[]> = this.initFoundationOptions();

  public constructor() {
    const searchControl = this.searchForm.get('search');

    searchControl?.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.searchValue.set(value || '');
    });

    searchControl?.valueChanges.pipe(debounceTime(500), takeUntilDestroyed()).subscribe((value) => {
      this.searchQueryChange.emit(value || '');
    });

    // The parent owns Foundation resets; syncing silently avoids echoing a second filter change.
    effect(() => {
      const foundation = this.foundation();
      const control = this.searchForm.get('foundation');
      if (control?.value !== foundation) {
        control?.setValue(foundation, { emitEvent: false });
      }
    });

    // Clear status when the available options change (e.g. switching between event tabs
    // and visa/TF tabs which have different status sets).
    toObservable(this.statusOptions)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.searchForm.get('status')?.setValue(null);
      });

    // Clear role when the role filter is hidden so stale values don't persist.
    toObservable(this.showRoleFilter)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe((show) => {
        if (!show) {
          this.searchForm.get('role')?.setValue(null);
        }
      });

    // Clear status when the status filter is hidden so a stale selection
    // doesn't continue to filter the active tab once it's no longer visible.
    toObservable(this.showStatusFilter)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe((show) => {
        if (!show) {
          this.searchForm.get('status')?.setValue(null);
        }
      });

    // Sync the searchQuery input into the form control without triggering valueChanges debounce.
    toObservable(this.searchQuery)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => {
        const normalizedQuery = query ?? '';
        if (searchControl?.value !== normalizedQuery) {
          searchControl?.setValue(normalizedQuery, { emitEvent: false });
          this.searchValue.set(normalizedQuery);
        }
      });
  }

  public clearSearch(): void {
    this.searchForm.get('search')?.setValue('');
  }

  private initFoundationOptions(): Signal<FilterOption[]> {
    const defaultOptions = [{ label: 'All Foundations', value: null }] as FilterOption[];
    const scope = computed(() => ({
      projectName: this.projectName(),
      isPast: this.isPast(),
      isFoundationFilter: this.isFoundationFilter(),
      registeredOnly: this.registeredOnly(),
    }));
    return toSignal(
      toObservable(scope).pipe(
        debounceTime(0),
        distinctUntilChanged(
          (a, b) =>
            a.projectName === b.projectName && a.isPast === b.isPast && a.isFoundationFilter === b.isFoundationFilter && a.registeredOnly === b.registeredOnly
        ),
        switchMap(({ projectName, isPast, isFoundationFilter, registeredOnly }) => {
          if (!isFoundationFilter || registeredOnly === null) {
            // Pending scope also cancels stale options without requesting the wrong default.
            this.foundationOptionsLoading.set(false);
            return of(defaultOptions);
          }
          this.foundationOptionsLoading.set(true);
          return this.eventsService
            .getEventOrganizations({
              projectName,
              isPast,
              registeredOnly,
            })
            .pipe(
              map(({ data }) => [{ label: 'All Foundations', value: null }, ...data.map((name) => ({ label: name, value: name }))]),
              finalize(() => this.foundationOptionsLoading.set(false))
            );
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      ),
      { initialValue: defaultOptions }
    );
  }
}
