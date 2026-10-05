// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MeetupsService } from '@app/shared/services/meetups.service';
import { EMPTY_MEETUP_FILTER_OPTIONS, EMPTY_MY_MEETUPS_RESPONSE } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetupsDashboardComponent } from './meetups-dashboard.component';

describe('MeetupsDashboardComponent registration-delay hint', () => {
  it.each(['focus', 'mouseenter'])('shows the delay explanation on %s', async (event) => {
    await TestBed.configureTestingModule({
      imports: [MeetupsDashboardComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        {
          provide: MeetupsService,
          useValue: {
            getMyMeetups: () => of(EMPTY_MY_MEETUPS_RESPONSE),
            getMeetupFilters: () => of(EMPTY_MEETUP_FILTER_OPTIONS),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MeetupsDashboardComponent);
    await fixture.whenStable();
    const hint = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="meetups-registration-delay-hint"]')!;
    if (event === 'focus') {
      hint.focus();
    } else {
      hint.dispatchEvent(new MouseEvent('mouseenter'));
    }
    await vi.waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('It can take a while to show up here.');
    });
  });
});
