// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventSpeakersDrawerComponent } from './event-speakers-drawer.component';

async function open(failing = false, { company = '', companyLabel = '' }: { company?: string; companyLabel?: string } = {}) {
  const getEventSpeakers = vi.fn(() =>
    failing
      ? throwError(() => new Error('boom'))
      : of({
          eventId: 'event-1',
          eventName: 'Event One',
          acceptedCount: 1,
          submittedCount: 2,
          data: [
            {
              contactId: '0',
              name: 'Jane Doe',
              jobTitle: null,
              status: 'ACCEPTED' as const,
            },
            {
              contactId: '1',
              name: 'Sam Lee',
              jobTitle: null,
              status: 'SUBMITTED' as const,
            },
          ],
        })
  );
  await TestBed.configureTestingModule({
    imports: [EventSpeakersDrawerComponent],
    providers: [
      provideNoopAnimations(),
      { provide: EventsService, useValue: { getEventSpeakers } },
      { provide: AccountContextService, useValue: { selectedAccount: signal({ accountId: 'acc-1', accountName: 'Acme Motors' }) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(EventSpeakersDrawerComponent);
  fixture.componentRef.setInput('eventId', 'event-1');
  fixture.componentRef.setInput('eventName', 'Event One');
  fixture.componentRef.setInput('acceptedCount', 3);
  fixture.componentRef.setInput('submittedCount', 5);
  fixture.componentRef.setInput('company', company);
  fixture.componentRef.setInput('companyLabel', companyLabel);
  fixture.detectChanges();
  fixture.componentRef.setInput('visible', true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, getEventSpeakers };
}

describe('EventSpeakersDrawerComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the speakers the read returns', async () => {
    await open();

    expect(document.body.querySelector('[data-testid="event-speakers-list"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="event-speakers-error"]')).toBeNull();
  });

  it('says the speakers could not load, rather than that there are none, when the read fails', async () => {
    await open(true);

    expect(document.body.querySelector('[data-testid="event-speakers-error"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="event-speakers-list"]')).toBeNull();
    expect(document.body.textContent).not.toContain('No speakers found for this event.');
    expect(document.body.querySelector('[data-testid="event-speakers-drawer-subtitle"]')?.textContent).toContain('3 accepted of 5 submitted');
  });

  it("titles the drawer with the row's company in a roll-up, and lists no per-person company line", async () => {
    await open(false, { company: 'acc-b', companyLabel: 'Acme Robotics' });

    expect(document.body.querySelector('[data-testid="event-speakers-drawer-title"]')?.textContent?.trim()).toBe('Acme Robotics Speakers');
    expect(document.body.querySelector('[data-testid^="event-speaker-companies-"]')).toBeNull();
  });

  it('titles the drawer with the selected organization on a single organization', async () => {
    await open();

    expect(document.body.querySelector('[data-testid="event-speakers-drawer-title"]')?.textContent?.trim()).toBe('Acme Motors Speakers');
  });

  it("asks for the row's company only", async () => {
    const { getEventSpeakers } = await open(false, { company: 'acc-b' });

    expect(getEventSpeakers).toHaveBeenCalledWith('acc-1', 'event-1', { company: 'acc-b' });
  });
});
