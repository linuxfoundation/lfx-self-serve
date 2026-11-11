// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import { MeetingVisibilityInfo } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MeetingDateTileComponent } from './meeting-date-tile.component';

const START = new Date(2026, 9, 1, 9, 0).toISOString();

describe('MeetingDateTileComponent', () => {
  const render = async (inputs: Record<string, unknown>): Promise<ComponentFixture<MeetingDateTileComponent>> => {
    const fixture = TestBed.createComponent(MeetingDateTileComponent);
    fixture.componentRef.setInput('date', START);
    fixture.componentRef.setInput('testIdPrefix', 'tile');
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    await fixture.whenStable();
    return fixture;
  };
  const part = (fixture: ComponentFixture<MeetingDateTileComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('shows the month over the day in a fixed 46×48 tile with an azure band', async () => {
    const fixture = await render({});

    expect(fixture.nativeElement.getAttribute('data-testid')).toBe('tile-date');
    expect(Array.from(fixture.nativeElement.classList)).toEqual(expect.arrayContaining(['w-[46px]', 'h-[48px]', 'rounded-[9px]']));
    expect(part(fixture, 'tile-date-month')?.textContent?.trim()).toBe('Oct');
    expect(part(fixture, 'tile-date-month')?.className).toContain('bg-blue-500');
    expect(part(fixture, 'tile-date-day')?.textContent?.trim()).toBe('1');
  });

  it('greys the band of a past date', async () => {
    const fixture = await render({ past: true });

    expect(part(fixture, 'tile-date-month')?.className).toContain('bg-gray-200');
  });

  it('puts each visibility badge on the corner, named for screen readers', async () => {
    const badge: MeetingVisibilityInfo = {
      kind: MeetingVisibilityKind.PRIVATE,
      title: 'Private',
      description: 'Only invitees can join.',
      icon: 'fa-solid fa-lock',
    };
    const fixture = await render({ badges: [badge] });

    expect(part(fixture, 'tile-visibility-private')?.getAttribute('aria-label')).toBe('Private');
  });

  it('stacks Restricted over Private as two 8px dots with no icons', async () => {
    const restricted: MeetingVisibilityInfo = { kind: MeetingVisibilityKind.RESTRICTED, title: 'Restricted', description: null, icon: 'fa-solid fa-lock' };
    const privateBadge: MeetingVisibilityInfo = { kind: MeetingVisibilityKind.PRIVATE, title: 'Private', description: null, icon: 'fa-solid fa-shield-halved' };
    const fixture = await render({ badges: [restricted, privateBadge] });

    const dots = [part(fixture, 'tile-visibility-restricted'), part(fixture, 'tile-visibility-private')];
    expect(dots[0]?.parentElement?.className).toContain('flex-col');
    for (const dot of dots) {
      expect(dot?.className).toContain('h-[8px]');
      expect(dot?.querySelector('i')).toBeNull();
    }
    expect(dots.map((dot) => dot?.getAttribute('aria-label'))).toEqual(['Restricted', 'Private']);
  });
});
