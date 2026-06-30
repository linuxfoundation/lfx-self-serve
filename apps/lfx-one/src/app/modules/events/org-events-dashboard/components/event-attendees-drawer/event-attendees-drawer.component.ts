// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, combineLatest, finalize, of, skip, switchMap } from 'rxjs';

import type { OrgEventAttendeesDrawerResponse, OrgEventAttendeeVm } from '@lfx-one/shared/interfaces';
import { avatarColorClass } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

@Component({
  selector: 'lfx-event-attendees-drawer',
  imports: [FormsModule, DrawerModule, InputTextModule],
  templateUrl: './event-attendees-drawer.component.html',
})
export class EventAttendeesDrawerComponent {
  private readonly eventsService = inject(EventsService);
  private readonly accountContext = inject(AccountContextService);

  public readonly visible = model<boolean>(false);
  public readonly eventId = input<string>('');
  public readonly eventName = input<string>('');
  public readonly attendeeCount = input<number>(0);

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);
  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName ?? '');

  private readonly attendeesData = this.initAttendeesData();

  protected readonly filteredAttendees = computed<OrgEventAttendeeVm[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const data = this.attendeesData()?.data ?? [];
    const matched = !term ? data : data.filter((a) => a.name.toLowerCase().includes(term) || (a.jobTitle ?? '').toLowerCase().includes(term));
    return matched.map((a) => ({ ...a, initials: computePersonInitials(a.name), avatarColorClass: avatarColorClass(a.contactId) }));
  });

  private initAttendeesData() {
    return toSignal(
      combineLatest([toObservable(this.visible), toObservable(this.eventId)]).pipe(
        skip(1),
        switchMap(([isVisible, currentEventId]) => {
          if (!isVisible || !currentEventId) return of(null);
          const accountId = this.accountContext.selectedAccount().accountId;
          if (!accountId) return of(null);
          this.searchTerm.set('');
          this.loading.set(true);
          return this.eventsService.getEventAttendees(accountId, currentEventId).pipe(
            catchError(() => of({ eventId: currentEventId, eventName: this.eventName(), total: 0, data: [] } as OrgEventAttendeesDrawerResponse)),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
