// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { OverviewEmptyTrackerService } from './overview-empty-tracker.service';

/** A DestroyRef the test destroys by hand. */
function destroyRef(): { ref: DestroyRef; destroy: () => void } {
  const callbacks: (() => void)[] = [];
  const ref = { onDestroy: (callback: () => void) => callbacks.push(callback) } as unknown as DestroyRef;
  return { ref, destroy: () => callbacks.forEach((callback) => callback()) };
}

describe('OverviewEmptyTrackerService', () => {
  it('is not empty before any card registers', () => {
    expect(new OverviewEmptyTrackerService().allEmpty()).toBe(false);
  });

  it('is empty only while every registered card is', () => {
    const tracker = new OverviewEmptyTrackerService();
    const first = signal(true);
    const second = signal(false);
    tracker.register(first, destroyRef().ref);
    tracker.register(second, destroyRef().ref);

    expect(tracker.allEmpty()).toBe(false);

    second.set(true);

    expect(tracker.allEmpty()).toBe(true);
  });

  it('forgets a card once it is destroyed', () => {
    const tracker = new OverviewEmptyTrackerService();
    const withData = destroyRef();
    tracker.register(signal(true), destroyRef().ref);
    tracker.register(signal(false), withData.ref);

    expect(tracker.allEmpty()).toBe(false);

    withData.destroy();

    expect(tracker.allEmpty()).toBe(true);
  });
});
