// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, model, output, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MaterialsChangedEvent, Meeting, MeetingAttachment, MeetingTimeState, MeetingViewerRole, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingMaterialsDrawerComponent } from '../../../components/meeting-materials-drawer/meeting-materials-drawer.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingMaterialsComponent } from './materials.component';

@Component({ selector: 'lfx-meeting-materials-drawer', template: '' })
class MaterialsDrawerStubComponent {
  public readonly meetingId = input<string>();
  public readonly pastMeetingId = input<string>();
  public readonly visible = model<boolean>(false);
  public readonly materialsChanged = output<MaterialsChangedEvent>();
}

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const NOW = new Date('2026-10-12T12:00:00Z');

const file = (uid: string, overrides: Partial<MeetingAttachment> = {}): MeetingAttachment => ({
  uid,
  meeting_id: 'meeting-1',
  type: 'file',
  name: `${uid}.pdf`,
  file_name: `${uid}.pdf`,
  file_size: 2048,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const link = (uid: string, url = 'https://www.github.example/org/repo'): MeetingAttachment => ({
  uid,
  meeting_id: 'meeting-1',
  type: 'link',
  name: `Link ${uid}`,
  link: url,
  created_at: '2026-01-01T00:00:00Z',
});

describe('MeetingMaterialsComponent', () => {
  let fixture: ComponentFixture<MeetingMaterialsComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let viewerRole: WritableSignal<MeetingViewerRole | null>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let authenticated: WritableSignal<boolean>;
  let matchesRoute: WritableSignal<boolean>;
  let meetingService: {
    getMeetingAttachments: ReturnType<typeof vi.fn>;
    getPastMeetingAttachments: ReturnType<typeof vi.fn>;
    getMeetingAttachmentDownloadUrl: ReturnType<typeof vi.fn>;
    getPastMeetingAttachmentDownloadUrl: ReturnType<typeof vi.fn>;
  };
  let messageService: { add: ReturnType<typeof vi.fn> };

  const setup = async (list: () => Observable<MeetingAttachment[]>): Promise<void> => {
    meetingService.getMeetingAttachments.mockImplementation(list);
    meetingService.getPastMeetingAttachments.mockImplementation(list);
    await TestBed.configureTestingModule({
      imports: [MeetingMaterialsComponent],
      providers: [
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting,
            matchesRoute,
            loadedViaPastMeetingId,
            viewerRole,
            timeState,
            now: signal(NOW),
            signInHref: signal('/login?returnTo=x'),
          },
        },
        { provide: MeetingService, useValue: meetingService },
        { provide: UserService, useValue: { authenticated } },
        { provide: MessageService, useValue: messageService },
      ],
    })
      .overrideComponent(MeetingMaterialsComponent, { remove: { imports: [MeetingMaterialsDrawerComponent] } })
      .overrideComponent(MeetingMaterialsComponent, { add: { imports: [MaterialsDrawerStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingMaterialsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    meeting = signal<LoadedMeeting | undefined>({ id: 'meeting-1', project: {} } as unknown as LoadedMeeting);
    loadedViaPastMeetingId = signal(false);
    viewerRole = signal<MeetingViewerRole | null>('visitor');
    timeState = signal<MeetingTimeState | null>('before');
    authenticated = signal(true);
    matchesRoute = signal(true);
    meetingService = {
      getMeetingAttachments: vi.fn(),
      getPastMeetingAttachments: vi.fn(),
      getMeetingAttachmentDownloadUrl: vi.fn(),
      getPastMeetingAttachmentDownloadUrl: vi.fn(),
    };
    messageService = { add: vi.fn() };
  });

  afterEach(() => vi.restoreAllMocks());

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const drawer = (): MaterialsDrawerStubComponent | undefined =>
    fixture.debugElement.query((el) => el.componentInstance instanceof MaterialsDrawerStubComponent)?.componentInstance;

  // V1 parity: `initializeAttachments` reads `/api/meetings/:id/attachments` for a signed-in viewer.
  it('lists files as primary and links as supporting, from the signed-in route', async () => {
    await setup(() => of([file('f1', { category: 'Presentation' }), link('l1')]));

    expect(meetingService.getMeetingAttachments).toHaveBeenCalledWith('meeting-1');
    expect(text('materials-file-f1')).toContain('f1.pdf');
    expect(text('materials-file-f1')).toContain('Presentation · PDF · 2 KB');
    const anchor = query('materials-link-l1') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://www.github.example/org/repo');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.textContent).toContain('Link · github.example');
  });

  // Organizer-entered links: one without a scheme opens over https, and an unsafe one is never a link.
  it('opens a bare host/path link over https, and shows an unsafe link as text', async () => {
    await setup(() => of([link('bare', 'docs.vendor-corp.example/document/d/abc'), link('unsafe', 'javascript:alert(1)')]));

    const bare = query('materials-link-bare') as HTMLAnchorElement;
    expect(bare.tagName).toBe('A');
    expect(bare.getAttribute('href')).toBe('https://docs.vendor-corp.example/document/d/abc');
    expect(bare.textContent).toContain('Link · docs.vendor-corp.example');

    const unsafe = query('materials-link-unsafe');
    expect(unsafe?.tagName).toBe('DIV');
    expect(unsafe?.querySelector('a')).toBeNull();
    expect(unsafe?.textContent).toContain('Link unsafe');
  });

  it('shows the size of an empty file too', async () => {
    await setup(() => of([file('empty', { file_size: 0 })]));

    expect(text('materials-file-empty')).toContain('PDF · 0 B');
  });

  it('shows five of a group, then Show N more', async () => {
    await setup(() => of(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((uid) => file(uid))));

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="materials-file-"]').length).toBe(5);
    expect(text('materials-section-files-toggle')).toBe('Show 2 more');

    query('materials-section-files-toggle')?.querySelector('button')?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="materials-file-"]').length).toBe(7);
    expect(text('materials-section-files-toggle')).toBe('Show less');
  });

  it('marks the section Updated for a change in the last seven days only', async () => {
    await setup(() => of([file('recent', { updated_at: '2026-10-08T00:00:00Z' })]));
    expect(query('materials-section-updated')).not.toBeNull();
  });

  it('is not Updated for older changes', async () => {
    await setup(() => of([file('old', { updated_at: '2026-09-01T00:00:00Z' })]));
    expect(query('materials-section-updated')).toBeNull();
  });

  it('says so when no materials are attached', async () => {
    await setup(() => of([]));
    expect(text('materials-section-empty')).toBe('No materials have been added to this meeting yet.');
  });

  // V1 parity: an anonymous viewer is never read for, and is asked to sign in (V1 HTML "Sign in to view materials").
  it('asks an anonymous viewer to sign in, without fetching', async () => {
    authenticated.set(false);
    await setup(() => of([file('f1')]));

    expect(meetingService.getMeetingAttachments).not.toHaveBeenCalled();
    expect(query('materials-section-sign-in')?.querySelector('a')?.getAttribute('href')).toBe('/login?returnTo=x');
    // returnTo can carry the meeting password: masked in Session Replay, as the action slot's is.
    expect(query('materials-section-sign-in-link')?.getAttribute('data-dd-privacy')).toBe('mask');
    expect(query('materials-section-empty')).toBeNull();
  });

  it('reads the list once the viewer signs in', async () => {
    authenticated.set(false);
    await setup(() => of([file('f1')]));

    authenticated.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(meetingService.getMeetingAttachments).toHaveBeenCalledWith('meeting-1');
    expect(query('materials-file-f1')).not.toBeNull();
  });

  it("shows an error with a retry that refetches when a past occurrence's read fails", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    let calls = 0;
    await setup(() => (++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of([file('f1')])));
    expect(query('materials-section-error')).not.toBeNull();

    query('materials-section-retry')?.querySelector('button')?.click();
    fixture.detectChanges();

    expect(query('materials-section-error')).toBeNull();
    expect(query('materials-file-f1')).not.toBeNull();
  });

  // An expired session still reads as signed in: the session-gated past route answers 401.
  it('asks for sign-in on a past occurrence whose session-gated route answers 401', async () => {
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    await setup(() => throwError(() => new HttpErrorResponse({ status: 401 })));

    expect(query('materials-section-sign-in-link')).not.toBeNull();
    expect(query('materials-section-error')).toBeNull();
  });

  it('offers an organizer whose session has expired Sign in, not Add material', async () => {
    viewerRole.set('organizer');
    loadedViaPastMeetingId.set(true);
    timeState.set('ended');
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    await setup(() => throwError(() => new HttpErrorResponse({ status: 401 })));

    expect(query('materials-section-sign-in-link')).not.toBeNull();
    expect(query('materials-section-add')).toBeNull();
    expect(drawer()).toBeUndefined();
  });

  it('keeps the rows it has when a refetch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    let calls = 0;
    await setup(() => (++calls === 1 ? of([file('f1')]) : throwError(() => new HttpErrorResponse({ status: 500 }))));

    fixture.componentInstance.retry();
    fixture.detectChanges();

    expect(query('materials-section-error')).toBeNull();
    expect(query('materials-file-f1')).not.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("reads a past occurrence's own list, and asks an anonymous viewer to sign in without fetching", async () => {
    authenticated.set(false);
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    await setup(() => of([file('f1')]));

    expect(query('materials-section-sign-in')).not.toBeNull();
    expect(meetingService.getPastMeetingAttachments).not.toHaveBeenCalled();

    authenticated.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(meetingService.getPastMeetingAttachments).toHaveBeenCalledWith('meeting-1-1700000000000');
    expect(query('materials-file-f1')).not.toBeNull();
  });

  // V1's downloadAttachment: the meeting's presign, opened in a new tab.
  it("downloads a file through the meeting's presign, in a new tab", async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    meetingService.getMeetingAttachmentDownloadUrl.mockReturnValue(of({ download_url: 'https://storage.example/presigned' }));
    await setup(() => of([file('f1')]));

    query('materials-file-f1')?.click();

    expect(meetingService.getMeetingAttachmentDownloadUrl).toHaveBeenCalledWith('meeting-1', 'f1');
    expect(open).toHaveBeenCalledWith('https://storage.example/presigned', '_blank', 'noopener,noreferrer');
  });

  it("keeps V1's toast when a download fails", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    meetingService.getMeetingAttachmentDownloadUrl.mockReturnValue(throwError(() => new Error('boom')));
    await setup(() => of([file('f1')]));

    query('materials-file-f1')?.click();

    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Download Failed' }));
  });

  it('offers Add material to organizers of an upcoming meeting, with the drawer on the meeting', async () => {
    viewerRole.set('organizer');
    await setup(() => of([]));

    expect(query('materials-section-add')).not.toBeNull();
    expect(drawer()?.meetingId()).toBe('meeting-1');
    expect(drawer()?.pastMeetingId()).toBeUndefined();
  });

  it('offers no Add material on an ended meeting opened by its series id, nor to non-organizers', async () => {
    viewerRole.set('organizer');
    timeState.set('ended');
    await setup(() => of([]));
    expect(query('materials-section-add')).toBeNull();

    timeState.set('before');
    viewerRole.set('registrant');
    fixture.detectChanges();
    expect(query('materials-section-add')).toBeNull();
  });

  // An in-app navigation holds the previous meeting until the next one loads: nothing may write to it.
  it('withdraws Add material and its drawer while the route has moved to another meeting', async () => {
    viewerRole.set('organizer');
    await setup(() => of([]));
    query('materials-section-add')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(drawer()?.visible()).toBe(true);

    matchesRoute.set(false);
    fixture.detectChanges();

    expect(query('materials-section-add')).toBeNull();
    expect(drawer()).toBeUndefined();
  });

  it("offers Add material on a past occurrence's own page, with the drawer on that occurrence", async () => {
    viewerRole.set('organizer');
    timeState.set('ended');
    authenticated.set(true);
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    await setup(() => of([]));

    expect(query('materials-section-add')).not.toBeNull();
    expect(drawer()?.meetingId()).toBeUndefined();
    expect(drawer()?.pastMeetingId()).toBe('meeting-1-1700000000000');
  });

  it("downloads a past occurrence's file through that occurrence's presign", async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    meetingService.getPastMeetingAttachmentDownloadUrl.mockReturnValue(of({ download_url: 'https://storage.example/presigned' }));
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    await setup(() => of([file('f1')]));

    query('materials-file-f1')?.click();

    expect(meetingService.getPastMeetingAttachmentDownloadUrl).toHaveBeenCalledWith('meeting-1-1700000000000', 'f1');
    expect(meetingService.getMeetingAttachmentDownloadUrl).not.toHaveBeenCalled();
  });

  // The section stays mounted across in-app meeting changes: a change's follow-up must not act on the next meeting.
  // A retry of the same meeting before its first success is not a meeting change: the drawer's
  // follow-up and optimistic rows survive it.
  it("keeps a change's follow-up when the meeting has not loaded yet", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    viewerRole.set('organizer');
    loadedViaPastMeetingId.set(true);
    meeting.set({ id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-1700000000000', project: {} } as unknown as LoadedMeeting);
    let calls = 0;
    await setup(() => (++calls <= 2 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of([file('new')])));
    expect(query('materials-section-error')).not.toBeNull();

    fixture.componentInstance.onMaterialsChanged({
      deletedUids: [],
      addedAttachments: [{ ...file('new'), meeting_and_occurrence_id: 'meeting-1-1700000000000' }],
    });
    fixture.detectChanges();

    // The immediate retry fails too; the 1s follow-up must still run, not be cancelled by it.
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    expect(meetingService.getPastMeetingAttachments).toHaveBeenCalledTimes(3);
    expect(query('materials-file-new')).not.toBeNull();
    vi.useRealTimers();
  });

  it("cancels a change's follow-up refetches when the section moves to another meeting", async () => {
    vi.useFakeTimers();
    await setup(() => of([file('keep')]));
    fixture.componentInstance.onMaterialsChanged({ deletedUids: [], addedAttachments: [] });
    fixture.detectChanges();

    meeting.set({ id: 'meeting-2', project: {} } as unknown as LoadedMeeting);
    fixture.detectChanges();
    meetingService.getMeetingAttachments.mockClear();

    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();

    expect(meetingService.getMeetingAttachments).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("applies the drawer's changes at once, then refetches", async () => {
    vi.useFakeTimers();
    await setup(() => of([file('keep'), file('gone')]));
    meetingService.getMeetingAttachments.mockClear();

    fixture.componentInstance.onMaterialsChanged({ deletedUids: ['gone'], addedAttachments: [{ ...file('new'), meeting_and_occurrence_id: 'x' }] });
    fixture.detectChanges();

    expect(query('materials-file-gone')).toBeNull();
    expect(query('materials-file-new')).not.toBeNull();
    expect(meetingService.getMeetingAttachments).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(meetingService.getMeetingAttachments).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(14000);
    fixture.detectChanges();
    expect(meetingService.getMeetingAttachments).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
