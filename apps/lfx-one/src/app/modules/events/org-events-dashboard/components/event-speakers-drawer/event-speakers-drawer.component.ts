// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, combineLatest, finalize, of, skip, switchMap } from 'rxjs';

import type { OrgEventSpeakerVm } from '@lfx-one/shared/interfaces';
import { avatarColorClass } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { organizationNames } from '@shared/utils/org-lens-row-organizations.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

@Component({
  selector: 'lfx-event-speakers-drawer',
  imports: [FormsModule, DrawerModule, InputTextModule],
  templateUrl: './event-speakers-drawer.component.html',
})
export class EventSpeakersDrawerComponent {
  private readonly eventsService = inject(EventsService);
  private readonly accountContext = inject(AccountContextService);

  public readonly visible = model<boolean>(false);
  public readonly eventId = input<string>('');
  public readonly eventName = input<string>('');
  public readonly acceptedCount = input<number>(0);
  public readonly submittedCount = input<number>(0);
  // Roll-up only: the Company filter's pick, so the drawer lists the people its row counted.
  public readonly company = input<string>('');

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName ?? '');

  private readonly speakersData = this.initSpeakersData();

  protected readonly filteredSpeakers = computed<OrgEventSpeakerVm[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const data = this.speakersData()?.data ?? [];
    const rows = data.map((s) => ({
      ...s,
      initials: computePersonInitials(s.name),
      avatarColorClass: avatarColorClass(s.contactId),
      organizationNames: organizationNames(s.organizations),
    }));
    return !term ? rows : rows.filter((s) => [s.name, s.jobTitle, s.organizationNames].some((field) => (field ?? '').toLowerCase().includes(term)));
  });

  private initSpeakersData() {
    return toSignal(
      combineLatest([toObservable(this.visible), toObservable(this.eventId), toObservable(this.company)]).pipe(
        skip(1),
        switchMap(([isVisible, currentEventId, company]) => {
          if (!isVisible || !currentEventId) return of(null);
          const accountId = this.accountContext.selectedAccount().accountId;
          if (!accountId) return of(null);
          this.searchTerm.set('');
          this.loadFailed.set(false);
          this.loading.set(true);
          return this.eventsService.getEventSpeakers(accountId, currentEventId, { company }).pipe(
            catchError((error: unknown) => {
              console.error('Failed to load event speakers', error);
              this.loadFailed.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
