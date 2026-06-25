// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { outputFromObservable, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MeetupsService } from '@app/shared/services/meetups.service';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { EMPTY_MEETUP_FILTER_OPTIONS, MEETUP_STATUS_OPTIONS } from '@lfx-one/shared/constants';
import { FilterOption, MeetupFilterOptionsResponse, MeetupStatusFilter } from '@lfx-one/shared/interfaces';
import { catchError, debounceTime, of } from 'rxjs';

@Component({
  selector: 'lfx-meetups-top-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './meetups-top-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetupsTopBarComponent {
  private readonly meetupsService = inject(MeetupsService);

  public readonly showStatusFilter = input<boolean>(true);
  public readonly searchQuery = input<string>('');
  public readonly community = input<string | null>(null);
  public readonly role = input<string | null>(null);
  public readonly status = input<MeetupStatusFilter | null>(null);
  public readonly statusOptions = input<FilterOption<MeetupStatusFilter | null>[]>(MEETUP_STATUS_OPTIONS);
  public readonly searchQueryChange = output<string>();

  public readonly searchForm: FormGroup = new FormGroup({
    search: new FormControl(''),
    community: new FormControl<string | null>(null),
    role: new FormControl<string | null>(null),
    status: new FormControl<MeetupStatusFilter | null>(null),
  });

  public readonly communityChange = outputFromObservable<string | null>(this.searchForm.get('community')!.valueChanges);
  public readonly roleChange = outputFromObservable<string | null>(this.searchForm.get('role')!.valueChanges);
  public readonly statusChange = outputFromObservable<MeetupStatusFilter | null>(this.searchForm.get('status')!.valueChanges);

  protected readonly searchValue = signal('');
  private readonly filterOptions: Signal<MeetupFilterOptionsResponse> = this.initFilterOptions();
  protected readonly communityOptions = computed<FilterOption[]>(() => [
    { label: 'All Communities', value: null },
    ...this.filterOptions().communities.map((community) => ({ label: community, value: community })),
  ]);
  protected readonly roleOptions = computed<FilterOption[]>(() => [
    { label: 'All Roles', value: null },
    ...this.filterOptions().roles.map((role) => ({ label: role, value: role })),
  ]);

  public constructor() {
    const searchControl = this.searchForm.get('search');

    searchControl?.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.searchValue.set(value || '');
    });

    searchControl?.valueChanges.pipe(debounceTime(500), takeUntilDestroyed()).subscribe((value) => {
      this.searchQueryChange.emit(value || '');
    });

    toObservable(this.searchQuery)
      .pipe(takeUntilDestroyed())
      .subscribe((query) => {
        const normalizedQuery = query ?? '';
        if (searchControl?.value !== normalizedQuery) {
          searchControl?.setValue(normalizedQuery, { emitEvent: false });
          this.searchValue.set(normalizedQuery);
        }
      });

    this.syncInputToControl(this.community, 'community');
    this.syncInputToControl(this.role, 'role');
    this.syncInputToControl(this.status, 'status');

    toObservable(this.showStatusFilter)
      .pipe(takeUntilDestroyed())
      .subscribe((show) => {
        if (!show) {
          this.searchForm.get('status')?.setValue(null);
        }
      });
  }

  public clearSearch(): void {
    this.searchForm.get('search')?.setValue('');
  }

  private initFilterOptions(): Signal<MeetupFilterOptionsResponse> {
    return toSignal(this.meetupsService.getMeetupFilters().pipe(catchError(() => of(EMPTY_MEETUP_FILTER_OPTIONS))), {
      initialValue: EMPTY_MEETUP_FILTER_OPTIONS,
    });
  }

  private syncInputToControl<T extends string>(source: Signal<T | null>, controlName: 'community' | 'role' | 'status'): void {
    const control = this.searchForm.get(controlName);
    toObservable(source)
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const normalizedValue = value ?? null;
        if (control?.value !== normalizedValue) {
          control?.setValue(normalizedValue, { emitEvent: false });
        }
      });
  }
}
