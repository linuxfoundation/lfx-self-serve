// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  MEETING_MATERIALS_PENDING_MAX_MS,
  MEETING_MATERIALS_PREVIEW_LIMIT,
  MEETING_MATERIALS_REFETCH_DELAYS_MS,
  MEETING_MATERIALS_UPDATED_WINDOW_MS,
} from '@lfx-one/shared/constants';
import {
  MaterialsChangedEvent,
  MeetingMaterialLink,
  MeetingMaterialsRequest,
  MeetingMaterialsState,
  PublicMeetingAttachment,
} from '@lfx-one/shared/interfaces';
import { getPastMeetingResourceId, getUrlHostname, toSafeExternalHref } from '@lfx-one/shared/utils';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { FileTypeDisplayPipe } from '@pipes/file-type-display.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { ButtonComponent } from '@components/button/button.component';
import { catchError, map, Observable, of, startWith, Subject, switchMap, take, takeUntil, timer } from 'rxjs';

import { MeetingMaterialsDrawerComponent } from '../../../components/meeting-materials-drawer/meeting-materials-drawer.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 materials section, in the content column after the people section (E3-02, #3251, FR-031).
 * @description Files ("Primary materials") and links ("Supporting materials"): the split is the
 * attachment's `type`, as on V1, so the subtitles say what each group holds and claim no editorial
 * intent the data cannot back (real primary/supporting semantics waits on U-06). Each group shows
 * five items, then "Show N more"; "Updated" marks a change in the last seven days.
 *
 * The page renders it where `visibleSections().materials` allows. An upcoming or live meeting's
 * list comes from the public route (E3-03), which gates it as the meeting is gated, and only a
 * viewer it refuses is asked to sign in. The V2 page serves signed-in viewers only until rollout
 * stage 5 (`rollout.md`); the public route is what lets this section serve anonymous visitors to a
 * public meeting from then on, unchanged. A page loaded by a past occurrence's id reads that
 * occurrence's own list, which needs a session.
 *
 * Files download through a presigned URL (V1's "Download Failed" toast on failure); links open in a
 * new tab. An organizer gets Add material, V1's materials drawer, while the meeting is upcoming or
 * the page is a past occurrence's.
 */
@Component({
  selector: 'lfx-meeting-materials',
  imports: [NgTemplateOutlet, SkeletonModule, ButtonComponent, FileSizePipe, FileTypeDisplayPipe, MeetingMaterialsDrawerComponent],
  templateUrl: './materials.component.html',
})
export class MeetingMaterialsComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly previewLimit = MEETING_MATERIALS_PREVIEW_LIMIT;
  /** `lfx-button` in the prototype's 30px pill (Add material, Try again), as the action slot styles its buttons. */
  protected readonly pillButtonClass =
    '!h-[30px] !gap-[6px] !rounded-full !border-[var(--md-border-strong)] !bg-[var(--md-surface-card)] !px-[12px] !py-0 !text-[12.5px] !font-semibold !text-[var(--md-text-heading)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';
  /** `lfx-button` as the prototype's inline text toggle (Show N more / Show less). */
  protected readonly toggleButtonClass =
    '!h-auto !border-0 !bg-transparent !p-0 !text-[13px] !font-semibold !text-[var(--md-accent-ink)] hover:!underline focus-visible:!shadow-[var(--md-shadow-focus)]';
  protected readonly drawerVisible = signal(false);
  protected readonly showAllFiles = signal(false);
  protected readonly showAllLinks = signal(false);
  /** Bumped to refetch the list, e.g. after the drawer changes it. */
  private readonly refreshCount = signal(0);
  /** Removals the drawer reported, hidden until the list stops returning them (index lag). */
  private readonly removedUids = signal<ReadonlySet<string>>(new Set());
  /** Emits when the section moves to another meeting (or none), cancelling the last change's follow-up timers. */
  private readonly viewChanged$ = new Subject<void>();
  /** Additions that have waited `MEETING_MATERIALS_PENDING_MAX_MS` and are no longer held as pending. */
  private readonly expiredPendingUids = signal<ReadonlySet<string>>(new Set());
  /** Additions the drawer reported, shown until the list returns them. */
  private readonly addedAttachments = signal<PublicMeetingAttachment[]>([]);

  protected readonly request: Signal<MeetingMaterialsRequest | null> = this.initRequest();
  protected readonly materials: Signal<MeetingMaterialsState> = this.initMaterials();
  protected readonly attachments: Signal<PublicMeetingAttachment[]> = this.initAttachments();
  protected readonly files = computed(() => this.attachments().filter((attachment) => attachment.type === 'file'));
  /**
   * Files the drawer just added that no fetched list has returned yet: the download route checks
   * a file against that list, so until it does, a download would fail. Their rows wait, for at most
   * `MEETING_MATERIALS_PENDING_MAX_MS`, so a refetch that keeps failing cannot leave one stuck.
   */
  protected readonly pendingUids = computed(() => {
    const expired = this.expiredPendingUids();
    return new Set(
      this.addedAttachments()
        .filter((attachment) => !expired.has(attachment.uid))
        .map((attachment) => attachment.uid)
    );
  });
  protected readonly links: Signal<MeetingMaterialLink[]> = this.initLinks();
  protected readonly visibleFiles = computed(() => (this.showAllFiles() ? this.files() : this.files().slice(0, MEETING_MATERIALS_PREVIEW_LIMIT)));
  protected readonly visibleLinks = computed(() => (this.showAllLinks() ? this.links() : this.links().slice(0, MEETING_MATERIALS_PREVIEW_LIMIT)));
  /** Whether anything was added or changed in the last seven days, on the page's clock. */
  protected readonly recentlyUpdated = computed(() => {
    const now = this.state.now().getTime();
    return this.attachments().some((attachment) => {
      const changed = Date.parse(attachment.updated_at || attachment.created_at);
      return Number.isFinite(changed) && now - changed <= MEETING_MATERIALS_UPDATED_WINDOW_MS && changed <= now;
    });
  });
  /**
   * V1's gate: organizers, while the meeting is upcoming, or on a past occurrence's own page. Never
   * while the route has moved on to another meeting the state has not loaded yet: the held meeting
   * is the previous one, and Add material (with the drawer it opens) must not write to it.
   */
  protected readonly canManage = computed(
    () =>
      this.state.matchesRoute() &&
      // An expired session reads as signed in until a request says otherwise: once one has, the
      // drawer's writes would fail too, so only Sign in is offered.
      this.materials().status !== 'sign-in' &&
      this.state.viewerRole() === 'organizer' &&
      (this.state.timeState() !== 'ended' || this.state.loadedViaPastMeetingId())
  );
  protected readonly drawerMeetingId = computed(() => (this.state.loadedViaPastMeetingId() ? undefined : this.state.meeting()?.id));
  protected readonly drawerPastMeetingId = computed(() => {
    const meeting = this.state.meeting();
    return this.state.loadedViaPastMeetingId() && meeting ? getPastMeetingResourceId(meeting) : undefined;
  });
  protected readonly signInHref = this.state.signInHref;

  public openDrawer(): void {
    this.drawerVisible.set(true);
  }

  public retry(): void {
    this.refreshCount.update((count) => count + 1);
  }

  public download(attachment: PublicMeetingAttachment): void {
    const request = this.request();
    if (!request || !isPlatformBrowser(this.platformId) || this.pendingUids().has(attachment.uid)) {
      return;
    }
    const download$ =
      request.mode === 'past'
        ? this.meetingService.getPastMeetingAttachmentDownloadUrl(request.id, attachment.uid)
        : this.meetingService.getPublicMeetingAttachmentDownloadUrl(request.id, attachment.uid, request.password);

    download$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const opened = window.open(response.download_url, '_blank', 'noopener,noreferrer');
        if (opened) {
          opened.opener = null;
        }
      },
      error: (error: unknown) => {
        console.error('Failed to download the meeting material', error);
        this.messageService.add({ severity: 'error', summary: 'Download Failed', detail: 'Unable to download the attachment. Please try again.' });
      },
    });
  }

  /**
   * The drawer changed the list: apply its report at once, then refetch now and again after each
   * of `MEETING_MATERIALS_REFETCH_DELAYS_MS` (V1 retries once, after a second), because the query
   * service indexes the change some time after the write returns.
   */
  public onMaterialsChanged(event: MaterialsChangedEvent): void {
    if (event.deletedUids.length) {
      this.removedUids.update((removed) => new Set([...removed, ...event.deletedUids]));
      this.addedAttachments.update((added) => added.filter((attachment) => !event.deletedUids.includes(attachment.uid)));
    }
    // Past mode reports `addedAttachments`, meeting mode `addedMeetingAttachments`.
    const reported: PublicMeetingAttachment[] = [...event.addedAttachments, ...(event.addedMeetingAttachments ?? [])];
    if (reported.length) {
      this.addedAttachments.update((added) => [...reported, ...added]);
      const uids = reported.map((attachment) => attachment.uid);
      timer(MEETING_MATERIALS_PENDING_MAX_MS)
        .pipe(takeUntil(this.viewChanged$), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.expiredPendingUids.update((expired) => new Set([...expired, ...uids])));
    }
    this.retry();
    for (const delay of MEETING_MATERIALS_REFETCH_DELAYS_MS) {
      timer(delay)
        .pipe(takeUntil(this.viewChanged$), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.retry());
    }
  }

  private initRequest(): Signal<MeetingMaterialsRequest | null> {
    return computed(
      () => {
        const meeting = this.state.meeting();
        if (!meeting || !this.state.matchesRoute()) {
          return null;
        }
        if (this.state.loadedViaPastMeetingId()) {
          return { mode: 'past', id: getPastMeetingResourceId(meeting), password: null };
        }
        return { mode: 'upcoming', id: meeting.id, password: this.state.password() };
      },
      { equal: (a, b) => a?.mode === b?.mode && a?.id === b?.id && a?.password === b?.password }
    );
  }

  private initMaterials(): Signal<MeetingMaterialsState> {
    const trigger = computed(() => ({ request: this.request(), refresh: this.refreshCount(), signedIn: this.userService.authenticated() }));
    // The last list fetched and what for: a refetch of the same one keeps showing it, and a failed
    // refetch keeps it rather than replacing the rows with an error.
    let last: { key: string; attachments: PublicMeetingAttachment[] } | null = null;
    // Which meeting (mode and id) the section is on; `undefined` before the first request. The reset
    // below runs only when this changes, not on a retry of the same meeting before its first success.
    let viewKey: string | null | undefined;

    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ request, signedIn }): Observable<MeetingMaterialsState> => {
          const key = request ? `${request.mode}:${request.id}` : null;
          if (key !== viewKey) {
            viewKey = key;
            last = null;
            // The last change's follow-up belongs to the previous meeting: cancel its refetches
            // and pending expiry, which would otherwise act on this one.
            this.viewChanged$.next();
            this.expiredPendingUids.set(new Set());
            // Another meeting (or none yet): a drawer opened for the previous one closes.
            this.drawerVisible.set(false);
            this.removedUids.set(new Set());
            this.addedAttachments.set([]);
            this.showAllFiles.set(false);
            this.showAllLinks.set(false);
          }
          const kept = key && last?.key === key ? last.attachments : null;
          if (!request || !key) {
            return of({ status: 'loading', attachments: [] });
          }
          // A past occurrence's list is behind a session; there is no public route for it.
          if (request.mode === 'past' && !signedIn) {
            return of({ status: 'sign-in', attachments: [] });
          }
          const list$: Observable<PublicMeetingAttachment[]> =
            request.mode === 'past'
              ? this.meetingService.getPastMeetingAttachments(request.id)
              : this.meetingService.getPublicMeetingAttachments(request.id, request.password);
          return list$.pipe(
            map((attachments): MeetingMaterialsState => {
              last = { key, attachments };
              this.settleOptimistic(attachments);
              return { status: 'ready', attachments };
            }),
            catchError((error: unknown) => {
              const status = error instanceof HttpErrorResponse ? error.status : 0;
              // Not a failure, so not logged: signing in is the way forward, and Try again would loop.
              // - Upcoming: the optional-auth public route refuses as the meeting route does (400 /
              //   403), including a viewer whose session expired while the page still reads signed in.
              //   Its 401 is its own upstream call failing, which signing in cannot fix: an error.
              // - Past: the session-gated route answers 401 for an expired session.
              const signInNeeded = request.mode === 'upcoming' ? status === 400 || status === 403 : status === 401;
              if (signInNeeded) {
                return of<MeetingMaterialsState>({ status: 'sign-in', attachments: [] });
              }
              console.error('Failed to load the meeting materials', error);
              return of<MeetingMaterialsState>(kept ? { status: 'ready', attachments: kept } : { status: 'error', attachments: [] });
            }),
            startWith<MeetingMaterialsState>(kept ? { status: 'ready', attachments: kept } : { status: 'loading', attachments: [] })
          );
        })
      ),
      { initialValue: { status: 'loading', attachments: [] } }
    );
  }

  /** Links as rows: an `href` only when the link is safe to open, and its caption. */
  private initLinks(): Signal<MeetingMaterialLink[]> {
    return computed(() =>
      this.attachments()
        .filter((attachment) => attachment.type === 'link')
        .map((attachment): MeetingMaterialLink => {
          const href = toSafeExternalHref(attachment.link);
          const host = getUrlHostname(href);
          return { attachment, href, caption: host ? `Link · ${host}` : 'Link' };
        })
    );
  }

  private initAttachments(): Signal<PublicMeetingAttachment[]> {
    return computed(() => {
      const removed = this.removedUids();
      const fetched = this.materials().attachments.filter((attachment) => !removed.has(attachment.uid));
      const fetchedUids = new Set(fetched.map((attachment) => attachment.uid));
      return [...this.addedAttachments().filter((attachment) => !fetchedUids.has(attachment.uid)), ...fetched];
    });
  }

  /** Drops the drawer's reports once the fetched list reflects them. */
  private settleOptimistic(attachments: PublicMeetingAttachment[]): void {
    const uids = new Set(attachments.map((attachment) => attachment.uid));
    this.removedUids.update((removed) => new Set([...removed].filter((uid) => uids.has(uid))));
    this.addedAttachments.update((added) => added.filter((attachment) => !uids.has(attachment.uid)));
  }
}
