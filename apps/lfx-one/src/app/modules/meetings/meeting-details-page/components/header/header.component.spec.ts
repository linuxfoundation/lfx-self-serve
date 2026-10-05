// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingHeaderComponent } from './header.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

describe('MeetingHeaderComponent', () => {
  let fixture: ComponentFixture<MeetingHeaderComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let setFoundation: ReturnType<typeof vi.fn>;

  const project: PublicMeetingProject = {
    uid: 'project-1',
    name: 'Acme Project',
    slug: 'acme-project',
    logo_url: 'https://acme-motors.example/logo.svg',
    parent_uid: 'foundation-1',
    parent: { uid: 'foundation-1', name: 'Acme Foundation', slug: 'acme-foundation' },
  };

  const build = (overrides: Partial<Meeting> = {}): LoadedMeeting =>
    ({
      id: 'meeting-1',
      title: 'Acme Weekly Sync',
      meeting_type: 'Technical',
      recurrence: null,
      committees: [],
      recording_enabled: false,
      transcript_enabled: false,
      youtube_upload_enabled: false,
      ai_summary_enabled: false,
      project_uid: 'project-1',
      ...overrides,
      project,
    }) as unknown as LoadedMeeting;

  beforeEach(async () => {
    meeting = signal<LoadedMeeting | undefined>(build());
    setFoundation = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MeetingHeaderComponent],
      providers: [
        { provide: MeetingDetailsStateService, useValue: { meeting } },
        { provide: ProjectContextService, useValue: { setFoundation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingHeaderComponent);
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function show(overrides: Partial<Meeting>): void {
    meeting.set(build(overrides));
    fixture.detectChanges();
  }

  it('renders the project with its foundation, and the title as the page heading', () => {
    expect(query('meeting-header-project')?.textContent).toContain('Acme Project');
    expect(query('meeting-header-foundation')?.textContent?.trim()).toBe('Acme Foundation');
    expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Acme Weekly Sync');
  });

  it('opens the foundation overview in a new tab after setting the foundation context', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    query('meeting-header-project')?.click();

    expect(setFoundation).toHaveBeenCalledWith({ uid: 'foundation-1', name: 'Acme Foundation', slug: 'acme-foundation' });
    expect(open).toHaveBeenCalledWith('/foundation/overview', '_blank', 'noopener,noreferrer');
  });

  it('shows the meeting type with its configured label', () => {
    expect(query('meeting-header-badge-type')?.textContent).toContain('Technical');
  });

  it('shows Recurring only for a recurring meeting', () => {
    expect(query('meeting-header-badge-recurring')).toBeNull();

    show({ recurrence: { type: 2 } as Meeting['recurrence'] });

    expect(query('meeting-header-badge-recurring')).not.toBeNull();
  });

  it('links each committee to its group page in a new tab, skipping ones without a name or uid', () => {
    show({
      committees: [{ uid: 'c-1', name: 'Steering Committee' }, { uid: 'c-2' }, { uid: '', name: 'Unlinked' }] as Meeting['committees'],
    });

    const link = query('meeting-header-badge-committee-c-1') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/groups/c-1');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.textContent).toContain('Steering Committee');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="meeting-header-badge-committee-"]').length).toBe(1);
  });

  // The `*_enabled` flags survive on the reduced past payload, so these show even without artifact access.
  it('shows each feature badge from its flag alone', () => {
    for (const id of ['recording', 'transcripts', 'youtube', 'ai-summary']) {
      expect(query(`meeting-header-badge-${id}`)).toBeNull();
    }

    show({ recording_enabled: true, transcript_enabled: true, youtube_upload_enabled: true, ai_summary_enabled: true });

    for (const id of ['recording', 'transcripts', 'youtube', 'ai-summary']) {
      expect(query(`meeting-header-badge-${id}`)).not.toBeNull();
    }
  });

  it('falls back to an icon when the project has no logo', () => {
    meeting.set({ ...build(), project: { ...project, logo_url: '' } });
    fixture.detectChanges();

    expect(query('meeting-header-project')?.querySelector('img')).toBeNull();
    expect(query('meeting-header-project')?.querySelector('.fa-cube')).not.toBeNull();
  });

  it('renders nothing before the meeting has loaded', () => {
    meeting.set(undefined);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });
});
