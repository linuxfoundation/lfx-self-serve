// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingOrganizerComponent } from './organizer.component';

describe('MeetingOrganizerComponent', () => {
  let fixture: ComponentFixture<MeetingOrganizerComponent>;
  let meeting: WritableSignal<Meeting | undefined>;
  let authenticated: WritableSignal<boolean>;

  const owner = { username: 'ada', email: 'ada@acme-motors.example', name: 'Ada Example' };

  beforeEach(async () => {
    meeting = signal<Meeting | undefined>({ id: 'meeting-1', owner } as Meeting);
    authenticated = signal(true);

    await TestBed.configureTestingModule({
      imports: [MeetingOrganizerComponent],
      providers: [
        { provide: MeetingDetailsStateService, useValue: { meeting } },
        { provide: UserService, useValue: { authenticated } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingOrganizerComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it("names the meeting's owner", () => {
    expect(query('meeting-organizer')?.querySelector('h3')?.textContent?.trim()).toBe('Organized by');
    expect(query('meeting-organizer-name')?.textContent?.trim()).toBe('Ada Example');
  });

  it('falls back to the creator when there is no owner', () => {
    meeting.set({ id: 'meeting-1', created_by: { username: 'grace', email: 'grace@acme-motors.example', name: 'Grace Example' } } as Meeting);
    fixture.detectChanges();

    expect(query('meeting-organizer-name')?.textContent?.trim()).toBe('Grace Example');
  });

  // FR-014: an optional name never renders as "undefined".
  it('falls back to the username when the name is missing', () => {
    meeting.set({ id: 'meeting-1', owner: { username: 'ada', email: 'ada@acme-motors.example' } } as Meeting);
    fixture.detectChanges();

    expect(query('meeting-organizer-name')?.textContent?.trim()).toBe('ada');
    expect(fixture.nativeElement.textContent).not.toContain('undefined');
  });

  // FR-014: the BFF removes these fields for anonymous viewers; the block does not rely on that alone.
  it('does not render for an anonymous viewer', () => {
    authenticated.set(false);
    fixture.detectChanges();

    expect(query('meeting-organizer')).toBeNull();
  });

  it('does not render when nobody resolves', () => {
    meeting.set({ id: 'meeting-1' } as Meeting);
    fixture.detectChanges();

    expect(query('meeting-organizer')).toBeNull();
  });
});
