// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingAgendaComponent } from './agenda.component';

describe('MeetingAgendaComponent', () => {
  let fixture: ComponentFixture<MeetingAgendaComponent>;
  let meeting: WritableSignal<Meeting | undefined>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;

  const build = (overrides: Partial<Meeting> = {}): Meeting =>
    ({
      id: 'meeting-1',
      description: 'Review the roadmap. Notes: https://docs.acme-motors.example/roadmap',
      ...overrides,
    }) as Meeting;

  beforeEach(async () => {
    meeting = signal<Meeting | undefined>(build());
    selectedOccurrence = signal<MeetingOccurrence | null>(null);

    await TestBed.configureTestingModule({
      imports: [MeetingAgendaComponent],
      providers: [{ provide: MeetingDetailsStateService, useValue: { meeting, selectedOccurrence } }],
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

  it("prefers the selected occurrence's own description over the series'", () => {
    selectedOccurrence.set({ occurrence_id: 'occ-1', description: 'Occurrence-only agenda' } as MeetingOccurrence);
    fixture.detectChanges();

    expect(query('agenda-section-description')?.textContent).toContain('Occurrence-only agenda');
    expect(query('agenda-section-description')?.textContent).not.toContain('Review the roadmap.');
  });

  it("falls back to the series' description when the occurrence's is blank", () => {
    selectedOccurrence.set({ occurrence_id: 'occ-1', description: '   ' } as MeetingOccurrence);
    fixture.detectChanges();

    expect(query('agenda-section-description')?.textContent).toContain('Review the roadmap.');
  });

  it('remounts the expandable text when the description changes, so it is measured afresh', () => {
    const before = fixture.nativeElement.querySelector('lfx-meeting-v2-expandable-text');

    selectedOccurrence.set({ occurrence_id: 'occ-2', description: 'A short agenda' } as MeetingOccurrence);
    fixture.detectChanges();

    const after = fixture.nativeElement.querySelector('lfx-meeting-v2-expandable-text');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after.textContent).toContain('A short agenda');
  });

  it('says so when there is no description', () => {
    meeting.set(build({ description: '   ' }));
    fixture.detectChanges();

    expect(query('agenda-section-description')).toBeNull();
    expect(query('agenda-section-empty')?.textContent?.trim()).toBe('No agenda has been added for this meeting yet.');
  });
});
