// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Meeting, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingAgendaComponent } from './agenda.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

describe('MeetingAgendaComponent', () => {
  let fixture: ComponentFixture<MeetingAgendaComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;

  const build = (overrides: Partial<Meeting> = {}): LoadedMeeting =>
    ({
      id: 'meeting-1',
      description: 'Review the roadmap. Notes: https://docs.acme-motors.example/roadmap',
      organizer: false,
      ...overrides,
      project: { uid: 'p1', name: 'Acme Project', slug: 'acme-project' },
    }) as unknown as LoadedMeeting;

  beforeEach(async () => {
    meeting = signal<LoadedMeeting | undefined>(build());

    await TestBed.configureTestingModule({
      imports: [MeetingAgendaComponent],
      providers: [provideRouter([]), { provide: MeetingDetailsStateService, useValue: { meeting } }],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingAgendaComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('shows the description under an Agenda heading, with its links made clickable', () => {
    expect(query('agenda-section')?.querySelector('h2')?.textContent?.trim()).toBe('Agenda');
    expect(query('agenda-section-description')?.textContent).toContain('Review the roadmap.');

    const link = query('agenda-section-description')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://docs.acme-motors.example/roadmap');
  });

  it('renders markup in the description as text, not HTML', () => {
    meeting.set(build({ description: '<img src=x onerror="alert(1)"> Agenda' }));
    fixture.detectChanges();

    expect(query('agenda-section-description')?.querySelector('img')).toBeNull();
    expect(query('agenda-section-description')?.textContent).toContain('<img');
  });

  it('says so when there is no description', () => {
    meeting.set(build({ description: '   ' }));
    fixture.detectChanges();

    expect(query('agenda-section-description')).toBeNull();
    expect(query('agenda-section-empty')?.textContent?.trim()).toBe('No agenda has been added for this meeting yet.');
  });

  it('offers Edit agenda to organizers only', () => {
    expect(query('agenda-section-edit')).toBeNull();

    meeting.set(build({ organizer: true }));
    fixture.detectChanges();

    expect(query('agenda-section-edit')?.textContent?.trim()).toBe('Edit agenda');
  });

  // Built as the meeting cards build it: under the foundation or project when known, with the project.
  it.each([
    [true, '/foundation/meetings/meeting-1/edit?project=acme-project'],
    [false, '/project/meetings/meeting-1/edit?project=acme-project'],
    [undefined, '/meetings/meeting-1/edit?project=acme-project'],
  ] as [boolean | undefined, string][])('links Edit agenda to the edit page (is_foundation %s)', (isFoundation, href) => {
    meeting.set(build({ organizer: true, is_foundation: isFoundation } as Partial<Meeting>));
    fixture.detectChanges();

    expect(query('agenda-section-edit')?.getAttribute('href')).toBe(href);
  });
});
