// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, combineLatest, finalize, of, skip, switchMap } from 'rxjs';

import type { OrgEventSpeakersResponse, OrgEventSpeakerVm } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { computePersonAvatarColorClass, computePersonInitials } from '@shared/utils/person-avatar.util';

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

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);
  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName ?? '');

  private readonly speakersData = this.initSpeakersData();

  protected readonly filteredSpeakers = computed<OrgEventSpeakerVm[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const data = this.speakersData()?.data ?? [];
    const matched = !term ? data : data.filter((s) => s.name.toLowerCase().includes(term) || (s.jobTitle ?? '').toLowerCase().includes(term));
    return matched.map((s) => ({ ...s, initials: computePersonInitials(s.name), avatarColorClass: computePersonAvatarColorClass(s.contactId) }));
  });

  private initSpeakersData() {
    return toSignal(
      combineLatest([toObservable(this.visible), toObservable(this.eventId)]).pipe(
        skip(1),
        switchMap(([isVisible, currentEventId]) => {
          if (!isVisible || !currentEventId) return of(null);
          const accountId = this.accountContext.selectedAccount().accountId;
          if (!accountId) return of(null);
          this.searchTerm.set('');
          this.loading.set(true);
          return this.eventsService.getEventSpeakers(accountId, currentEventId).pipe(
            catchError(() =>
              of({ eventId: currentEventId, eventName: this.eventName(), acceptedCount: 0, submittedCount: 0, data: [] } as OrgEventSpeakersResponse)
            ),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
