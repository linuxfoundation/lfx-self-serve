// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Meeting, MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingRegistrantsDisplayComponent } from '../../../components/meeting-registrants-display/meeting-registrants-display.component';
import { MeetingV2RegistrantsDisplayComponent } from './v2-registrants-display.component';

const MEETING = { id: 'meeting-1', timezone: 'UTC' } as Meeting;

const registrant = (overrides: Partial<MeetingRegistrant> = {}): MeetingRegistrant =>
  ({
    uid: 'reg-1',
    meeting_id: 'meeting-1',
    email: 'ada@acme-motors.example',
    first_name: 'Ada',
    last_name: 'Byron',
    host: false,
    linkedin_profile: 'https://www.linkedin.com/in/ada-example',
    ...overrides,
  }) as MeetingRegistrant;

/** #3260: V2's guest list names each LinkedIn link after its person; the rest is the shared list, inherited. */
describe('MeetingV2RegistrantsDisplayComponent LinkedIn links', () => {
  async function mount(registrants: MeetingRegistrant[]) {
    await TestBed.configureTestingModule({
      imports: [MeetingV2RegistrantsDisplayComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({}),
            getPastMeetingParticipants: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MeetingV2RegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', MEETING);
    fixture.componentRef.setInput('myMeetingRegistrants', true);
    fixture.componentRef.setInput('initialRegistrants', registrants);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('gives the link a name saying whose profile opens, in a new tab, and hides the icon', async () => {
    const fixture = await mount([registrant()]);

    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('[data-testid="registrant-display-linkedin-reg-1"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('aria-label')).toBe('LinkedIn profile of Ada Byron (opens in a new tab)');
    expect(link?.getAttribute('href')).toBe('https://www.linkedin.com/in/ada-example');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no link for a guest without a LinkedIn profile', async () => {
    const fixture = await mount([registrant({ linkedin_profile: undefined })]);

    expect(fixture.nativeElement.querySelector('[data-testid="registrant-display-linkedin-reg-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="registrant-reg-1"]')).not.toBeNull();
  });

  it("is the shared list underneath, so V1's behaviour carries over", async () => {
    const fixture = await mount([registrant()]);

    expect(fixture.componentInstance).toBeInstanceOf(MeetingRegistrantsDisplayComponent);
    expect(fixture.componentInstance.registrants().map((r) => r.uid)).toEqual(['reg-1']);
  });
});
