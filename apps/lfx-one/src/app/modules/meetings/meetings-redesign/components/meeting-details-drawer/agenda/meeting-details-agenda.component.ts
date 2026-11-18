// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, linkedSignal, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AttachmentScope,
  MeetingAttachment,
  MaterialsChangedEvent,
  MeetingMaterialLink,
  MeetingMaterialsDrawerData,
  PastMeetingAttachment,
} from '@lfx-one/shared/interfaces';
import {
  applyAttachmentScopeOverrides,
  applyMeetingAttachmentChanges,
  applyPastMeetingAttachmentChanges,
  filterAttachmentsForOccurrence,
  getAttachmentScope,
  isPastMeetingCalendarRow,
  isValidUrl,
} from '@lfx-one/shared/utils';
import { MEETING_DETAILS_AGENDA_COLLAPSED_PX, MEETING_DETAILS_VISIBLE_FILES, MEETING_MATERIALS_UPDATED_WINDOW_MS } from '@lfx-one/shared/constants';
import { FileTypeDisplayPipe } from '@pipes/file-type-display.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingService } from '@services/meeting.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiShowMoreComponent } from '@shared/uikit/show-more/show-more.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { catchError, distinctUntilChanged, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsSource } from '../meeting-details.source';
import { MeetingMaterialsDrawerComponent } from './materials-drawer/meeting-materials-drawer.component';

/**
 * Agenda & Materials tab of the meeting details drawer.
 * @description The agenda is the shown date's description, else the meeting's. Files are the primary materials and
 * links the supporting ones. Organizers edit them in the composer, and a past record's materials in Manage Materials.
 */
@Component({
  selector: 'lfx-meeting-details-agenda',
  imports: [
    DatePipe,
    FileTypeDisplayPipe,
    LinkifyPipe,
    NgTemplateOutlet,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiShowMoreComponent,
    UiSkeletonComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-details-agenda.component.html',
  host: { class: 'flex flex-col gap-[24px]' },
})
export class MeetingDetailsAgendaComponent {
  private readonly context = inject(MeetingDetailsContext);
  private readonly meetingService = inject(MeetingService);
  private readonly editService = inject(MeetingsHomeEditService);
  private readonly hostRef = inject(MeetingDetailsSource).hostRef;
  private readonly drawerService = inject(UiDrawerService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly agendaText = viewChild<ElementRef<HTMLElement>>('agendaText');

  // Each shown date opens collapsed.
  protected readonly agendaExpanded = linkedSignal({ source: this.context.occurrence, computation: () => false });
  /** True once the rendered agenda is taller than the collapsed height. */
  protected readonly agendaOverflows = signal(false);
  protected readonly filesExpanded = linkedSignal({ source: this.context.occurrence, computation: () => false });
  /** Changes saved from Manage Materials, shown until the past record's read catches up. */
  private readonly pastChanges = signal<MaterialsChangedEvent>({ deletedUids: [], addedAttachments: [] });
  protected readonly agendaCollapsedHeight: Signal<number | null> = computed(() =>
    this.agendaOverflows() && !this.agendaExpanded() ? MEETING_DETAILS_AGENDA_COLLAPSED_PX : null
  );

  // A past row holds the past record, whose upcoming dates belong to its series.
  private readonly seriesId: Signal<string> = computed(() => {
    const meeting = this.context.meeting();
    return isPastMeetingCalendarRow(meeting) ? meeting.meeting_id : meeting.id;
  });
  protected readonly fullAccess: Signal<boolean> = this.context.fullAccess;
  protected readonly signedIn: Signal<boolean> = this.context.signedIn;
  /** On a page, a viewer without full access gets the private notice here; the drawer keeps it in its side column. */
  protected readonly page = !inject(UiDrawerContext, { optional: true });
  protected readonly privateNotice: Signal<string> = computed(() => {
    const lead = 'Meeting details, recordings, and summaries are only available to meeting participants and committee members.';
    if (this.signedIn()) return `${lead} If you believe you should have access, please contact the meeting organizer.`;
    return this.context.state() === 'ended'
      ? `${lead} Sign in if you believe you should have access.`
      : `${lead} Sign in or join as a guest below if you have the meeting password.`;
  });
  protected readonly agenda: Signal<string> = computed(() => (this.context.occurrence()?.description || this.context.meeting().description || '').trim());
  // Upcoming dates of the series are editable; past materials and rows that hold a past record are not.
  protected readonly canEdit: Signal<boolean> = computed(
    () => this.context.organizer() && this.context.state() !== 'ended' && !isPastMeetingCalendarRow(this.context.meeting())
  );
  // An organizer manages an ended date's materials on its past record, as on the legacy past meeting pages.
  protected readonly canManagePast: Signal<boolean> = computed(() => this.context.organizer() && !!this.context.pastMeetingId());
  protected readonly canEditMaterials: Signal<boolean> = computed(() => this.canEdit() || this.canManagePast());
  /** Null while loading. */
  private readonly attachments: Signal<(MeetingAttachment | PastMeetingAttachment)[] | null> = this.initAttachments();
  protected readonly loading: Signal<boolean> = computed(() => this.attachments() === null);
  protected readonly files: Signal<(MeetingAttachment | PastMeetingAttachment)[]> = computed(() =>
    (this.attachments() ?? []).filter((attachment) => attachment.type === 'file')
  );
  protected readonly links: Signal<MeetingMaterialLink[]> = this.initLinks();
  protected readonly hasMaterials: Signal<boolean> = computed(() => this.files().length > 0 || this.links().length > 0);
  protected readonly visibleFiles: Signal<(MeetingAttachment | PastMeetingAttachment)[]> = computed(() =>
    this.filesExpanded() ? this.files() : this.files().slice(0, MEETING_DETAILS_VISIBLE_FILES)
  );
  protected readonly hiddenFileCount: Signal<number> = computed(() => Math.max(this.files().length - MEETING_DETAILS_VISIBLE_FILES, 0));
  protected readonly recentlyUpdated: Signal<boolean> = this.initRecentlyUpdated();
  // Each date of an upcoming series can have its own materials, so each item says which it applies to.
  protected readonly showScopes: Signal<boolean> = computed(() => !this.context.pastMeetingId() && !!this.context.meeting().recurrence);
  protected readonly scopes: Signal<ReadonlyMap<string, AttachmentScope>> = computed(
    () => new Map((this.attachments() ?? []).map((attachment) => [attachment.uid, getAttachmentScope(attachment as MeetingAttachment)] as const))
  );

  public constructor() {
    // Measured in the browser only; the server renders the agenda uncollapsed.
    afterRenderEffect(() => {
      this.agenda();
      // A hidden tab measures 0, so the agenda is measured again once its tab is shown.
      this.context.tab();
      const element = this.agendaText()?.nativeElement;
      if (element?.scrollHeight === 0) return;
      this.agendaOverflows.set(!!element && element.scrollHeight > MEETING_DETAILS_AGENDA_COLLAPSED_PX);
    });
  }

  protected signIn(): void {
    this.context.signIn();
  }

  protected edit(): void {
    this.editService.edit(this.context.shownRow(), 'agenda-resources', this.hostRef);
  }

  /** Opens the series in the composer, or Manage Materials over this drawer for an ended date's past record. */
  protected editMaterials(): void {
    const pastMeetingId = this.context.pastMeetingId();
    if (pastMeetingId) {
      // A save that finishes after another date is shown belongs to the date it was made on.
      const onChanged = (event: MaterialsChangedEvent): void => {
        if (this.context.pastMeetingId() === pastMeetingId) this.recordPastChanges(event);
      };
      this.openMaterialsDrawer({ pastMeetingId, pastChanges: this.pastChanges(), occurrence: null, canScopeToOccurrence: false, onChanged });
      return;
    }
    this.editService.edit(this.context.shownRow(), 'agenda-resources', this.hostRef, true);
  }

  protected download(attachment: MeetingAttachment | PastMeetingAttachment): void {
    const pastMeetingId = this.context.pastMeetingId();
    const download$ = pastMeetingId
      ? this.meetingService.getPastMeetingAttachmentDownloadUrl(pastMeetingId, attachment.uid)
      : this.meetingService.getMeetingAttachmentDownloadUrl(this.seriesId(), attachment.uid);
    download$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => window.open(response.download_url, '_blank', 'noopener,noreferrer'),
      error: () =>
        this.toast.show({
          variant: 'error',
          position: 'bottom-center',
          message: 'Download Failed',
          description: 'Unable to download the attachment. Please try again.',
        }),
    });
  }

  protected openLink(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private initAttachments(): Signal<(MeetingAttachment | PastMeetingAttachment)[] | null> {
    // Keyed on the resource only, so the fresh detail replacing the row data does not refetch.
    // Without full access, or signed out, no materials show, so nothing is fetched.
    const source = computed(() => (this.context.signedInAccess() ? (this.context.pastMeetingId() ?? `meeting:${this.seriesId()}`) : null));
    const loaded$ = toObservable(source).pipe(
      distinctUntilChanged(),
      tap(() => this.pastChanges.set({ deletedUids: [], addedAttachments: [] })),
      switchMap((key) => (key ? this.loadAttachments().pipe(startWith(null)) : of(null)))
    );
    const loaded = toSignal(loaded$, { initialValue: null });
    return computed(() => {
      const attachments = loaded();
      if (!attachments) return null;
      if (this.context.pastMeetingId()) return applyPastMeetingAttachmentChanges(attachments as PastMeetingAttachment[], this.pastChanges());
      // The read can lag this session's saves, so they are overlaid; reactive, as Manage Materials saves while this stays open.
      const meetingId = this.seriesId();
      const current = applyAttachmentScopeOverrides(
        applyMeetingAttachmentChanges(attachments as MeetingAttachment[], this.meetingService.attachmentChanges().get(meetingId)),
        this.meetingService.attachmentScopeOverrides()
      );
      return filterAttachmentsForOccurrence(current, this.context.occurrence()?.occurrence_id);
    });
  }

  private initRecentlyUpdated(): Signal<boolean> {
    return computed(() => {
      const since = Date.now() - MEETING_MATERIALS_UPDATED_WINDOW_MS;
      return (this.attachments() ?? []).some((attachment) => !!attachment.updated_at && Date.parse(attachment.updated_at) > since);
    });
  }

  private initLinks(): Signal<MeetingMaterialLink[]> {
    return computed(() =>
      (this.attachments() ?? [])
        .filter((attachment) => attachment.type === 'link')
        .map((attachment) => {
          const url = attachment.link && isValidUrl(attachment.link) ? attachment.link : null;
          const name = attachment.name?.trim();
          // A link saved without a title shows its URL as the title, and no host under it.
          if (!name || name === attachment.link) return { uid: attachment.uid, name: attachment.link ?? '', url, host: '' };
          return { uid: attachment.uid, name, url, host: url ? new URL(url).hostname.replace(/^www\./, '') : '' };
        })
    );
  }

  private loadAttachments(): Observable<(MeetingAttachment | PastMeetingAttachment)[]> {
    const pastMeetingId = this.context.pastMeetingId();
    if (pastMeetingId) {
      return this.meetingService.getPastMeetingAttachments(pastMeetingId).pipe(
        catchError((error: unknown) => {
          console.error('Failed to load past meeting attachments:', error);
          return of([] as PastMeetingAttachment[]);
        })
      );
    }
    return this.meetingService.getMeetingAttachments(this.seriesId());
  }

  private openMaterialsDrawer(data: MeetingMaterialsDrawerData): void {
    this.drawerService.open(MeetingMaterialsDrawerComponent, { data });
  }

  private recordPastChanges(event: MaterialsChangedEvent): void {
    this.pastChanges.update((current) => ({
      deletedUids: [...current.deletedUids, ...event.deletedUids],
      addedAttachments: [...current.addedAttachments, ...event.addedAttachments],
    }));
  }
}
