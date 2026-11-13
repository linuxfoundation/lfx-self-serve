// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MeetingService } from '@services/meeting.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRollupPreferenceService } from './meeting-rollup-preference.service';

describe('MeetingRollupPreferenceService', () => {
  let saves: { rootUid: string; projectUids: string[]; done: Subject<void> }[];
  let service: MeetingRollupPreferenceService;

  beforeEach(() => {
    vi.useFakeTimers();
    saves = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingService,
          useValue: {
            saveRollupProjectsPreference: vi.fn((rootUid: string, projectUids: string[]) => {
              const done = new Subject<void>();
              saves.push({ rootUid, projectUids, done });
              return done;
            }),
          },
        },
      ],
    });
    service = TestBed.inject(MeetingRollupPreferenceService);
  });

  afterEach(() => vi.useRealTimers());

  it('saves only the latest choice per root after its pause', () => {
    service.save('a', ['1']);
    service.save('a', ['2']);
    vi.advanceTimersByTime(600);

    expect(saves.map((s) => [s.rootUid, s.projectUids])).toEqual([['a', ['2']]]);
  });

  it('keeps a pending choice for one root when another root changes', () => {
    service.save('a', ['1']);
    vi.advanceTimersByTime(300);
    service.save('b', ['2']);
    vi.advanceTimersByTime(600);

    expect(saves.map((s) => s.rootUid)).toEqual(['a']);
    saves[0].done.complete();
    expect(saves.map((s) => s.rootUid)).toEqual(['a', 'b']);
  });

  it('sends saves one at a time, in order', () => {
    service.save('a', ['1']);
    vi.advanceTimersByTime(600);
    service.save('a', ['2']);
    vi.advanceTimersByTime(600);

    expect(saves).toHaveLength(1);
    saves[0].done.complete();
    expect(saves.map((s) => s.projectUids)).toEqual([['1'], ['2']]);
  });

  it('remembers the latest choice per root for the session, before and after it is saved', () => {
    expect(service.latestChoice('a')).toBeUndefined();

    service.save('a', ['1']);
    expect(service.latestChoice('a')).toEqual(['1']);

    vi.advanceTimersByTime(600);
    saves[0].done.complete();
    expect(service.latestChoice('a')).toEqual(['1']);
  });
});
