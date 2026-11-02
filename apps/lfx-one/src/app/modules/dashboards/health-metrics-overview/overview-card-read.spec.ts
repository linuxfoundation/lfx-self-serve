// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { injectOverviewCardRead } from './overview-card-read';

import type { HealthMetricsOverviewCardRead } from '@lfx-one/shared/interfaces';

describe('injectOverviewCardRead', () => {
  let foundation: WritableSignal<{ slug: string } | null>;
  let responses: Record<string, Subject<string>>;
  let read: Mock;

  function setup(platform = 'browser'): HealthMetricsOverviewCardRead<string> {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: ProjectContextService, useValue: { selectedFoundation: foundation } },
      ],
    });
    return TestBed.runInInjectionContext(() => injectOverviewCardRead<string>(read));
  }

  function select(slug: string | null): void {
    foundation.set(slug ? { slug } : null);
    TestBed.tick();
  }

  beforeEach(() => {
    foundation = signal(null);
    responses = {};
    read = vi.fn((slug: string) => (responses[slug] ??= new Subject<string>()));
  });

  it('stays loading until a foundation is selected, then reads it', () => {
    const card = setup();
    TestBed.tick();
    expect(card.status()).toBe('loading');
    expect(read).not.toHaveBeenCalled();

    select('acme');
    responses['acme'].next('acme data');

    expect(read).toHaveBeenCalledWith('acme');
    expect(card.status()).toBe('ready');
    expect(card.data()).toBe('acme data');
  });

  it('clears the old data on a switch and drops the old foundation’s late response', () => {
    const card = setup();
    select('acme');
    responses['acme'].next('acme data');

    select('beta');
    expect(card.status()).toBe('loading');
    expect(card.data()).toBeNull();

    responses['acme'].next('stale acme data');
    expect(card.data()).toBeNull();

    responses['beta'].next('beta data');
    expect(card.status()).toBe('ready');
    expect(card.data()).toBe('beta data');
  });

  it('marks a failed read', () => {
    const card = setup();
    select('acme');
    responses['acme'].error(new Error('warehouse down'));

    expect(card.status()).toBe('failed');
    expect(card.data()).toBeNull();
  });

  it('settles with no data when the foundation is cleared after one was selected', () => {
    const card = setup();
    select('acme');
    responses['acme'].next('acme data');

    select(null);

    expect(card.status()).toBe('ready');
    expect(card.data()).toBeNull();
  });

  it('stays loading on the server without reading', () => {
    foundation.set({ slug: 'acme' });
    const card = setup('server');

    expect(card.status()).toBe('loading');
    expect(read).not.toHaveBeenCalled();
  });
});
