// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { ApplicationRef, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NAV_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { LensItemsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FavoriteProjectsService } from './favorite-projects.service';
import { LensService } from './lens.service';
import { NavigationService } from './navigation.service';
import { PersonaService } from './persona.service';
import { ProjectContextService } from './project-context.service';

function emptyPage(): LensItemsResponse {
  return { items: [], next_page_token: null, upstream_failed: false, lens: 'project' };
}

describe('NavigationService — favoritedUids threading (GH-3453)', () => {
  let http: { get: ReturnType<typeof vi.fn> };
  let favoriteState: ReturnType<typeof signal<{ data: Set<string>; loading: boolean; error: boolean }>>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    http = { get: vi.fn().mockReturnValue(of(emptyPage())) };
    favoriteState = signal({ data: new Set<string>(), loading: false, error: false });

    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        {
          provide: LensService,
          useValue: {
            activeLens: signal('project'),
            menuLens: signal('project'),
            previewingMenuLens: signal(false),
            availableLenses: signal([]),
            isHybridPersona: signal(false),
            setLens: vi.fn(),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal(null),
            selectedProject: signal(null),
            clearFoundation: vi.fn(),
            clearProject: vi.fn(),
            setFoundation: vi.fn(),
            setProject: vi.fn(),
          },
        },
        { provide: PersonaService, useValue: { personaProjects: signal({}) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: FavoriteProjectsService, useValue: { state: favoriteState } },
      ],
    });

    // Constructing the service triggers an immediate browse-mode reload (activeLens === 'project').
    TestBed.inject(NavigationService);
    TestBed.inject(ApplicationRef).tick();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function lastParams(): HttpParams {
    return http.get.mock.calls[http.get.mock.calls.length - 1][1].params;
  }

  async function waitForDebounce(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await vi.advanceTimersByTimeAsync(NAV_SEARCH_DEBOUNCE_MS);
    TestBed.inject(ApplicationRef).tick();
  }

  it('re-injects favorites when the search box is cleared back to browsing', async () => {
    favoriteState.set({ data: new Set(['fav-1']), loading: false, error: false });
    http.get.mockClear();

    const service = TestBed.inject(NavigationService);
    service.setSearchTerm('project', 'acme');
    await waitForDebounce();

    expect(lastParams().has('favorited_uids')).toBe(false);

    http.get.mockClear();
    service.setSearchTerm('project', '');
    await waitForDebounce();

    expect(lastParams().get('favorited_uids')).toBe('fav-1');
  }, 10000);

  it('re-fires the browse fetch once favorites finish loading after the initial page landed', async () => {
    http.get.mockClear();
    favoriteState.set({ data: new Set<string>(), loading: true, error: false });
    TestBed.inject(ApplicationRef).tick();
    expect(http.get).not.toHaveBeenCalled();

    favoriteState.set({ data: new Set(['fav-1']), loading: false, error: false });
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();

    expect(http.get).toHaveBeenCalled();
    expect(lastParams().get('favorited_uids')).toBe('fav-1');
  });

  it('cancels and restarts an in-flight browse fetch once favorites finish loading mid-flight', async () => {
    const inFlight = new Subject<LensItemsResponse>();
    http.get.mockReturnValueOnce(inFlight).mockReturnValue(of(emptyPage()));
    favoriteState.set({ data: new Set<string>(), loading: true, error: false });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        {
          provide: LensService,
          useValue: {
            activeLens: signal('project'),
            menuLens: signal('project'),
            previewingMenuLens: signal(false),
            availableLenses: signal([]),
            isHybridPersona: signal(false),
            setLens: vi.fn(),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal(null),
            selectedProject: signal(null),
            clearFoundation: vi.fn(),
            clearProject: vi.fn(),
            setFoundation: vi.fn(),
            setProject: vi.fn(),
          },
        },
        { provide: PersonaService, useValue: { personaProjects: signal({}) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: FavoriteProjectsService, useValue: { state: favoriteState } },
      ],
    });
    http.get.mockClear();
    TestBed.inject(NavigationService);
    TestBed.inject(ApplicationRef).tick();

    // The initial browse request is still in flight (never resolved via `inFlight`) when favorites finish loading.
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(lastParams().has('favorited_uids')).toBe(false);

    favoriteState.set({ data: new Set(['fav-1']), loading: false, error: false });
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(lastParams().get('favorited_uids')).toBe('fav-1');
  });
});

/**
 * A lens the mobile drawer previews (#4208) loads its list for the selector, but never picks a default context or writes
 * the URL: the page underneath keeps its own lens and context until a pick commits the preview.
 */
describe('NavigationService — menu lens preview', () => {
  it('loads a previewed lens list without default-selecting a context', async () => {
    const http = { get: vi.fn().mockReturnValue(of({ ...emptyPage(), lens: 'foundation', items: [{ uid: 'f1', slug: 'f1', name: 'F1' }] })) };
    const activeLens = signal('me');
    const menuLens = signal('me');
    const setFoundation = vi.fn();
    const setLens = vi.fn();
    const isHybridPersona = signal(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        {
          provide: LensService,
          useValue: {
            activeLens,
            menuLens,
            previewingMenuLens: computed(() => menuLens() !== activeLens()),
            availableLenses: signal([]),
            isHybridPersona,
            setLens,
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal(null),
            selectedProject: signal(null),
            clearFoundation: vi.fn(),
            clearProject: vi.fn(),
            setFoundation,
            setProject: vi.fn(),
          },
        },
        { provide: PersonaService, useValue: { personaProjects: signal({}) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: FavoriteProjectsService, useValue: { state: signal({ data: new Set<string>(), loading: false, error: false }) } },
      ],
    });
    const service = TestBed.inject(NavigationService);
    TestBed.inject(ApplicationRef).tick();
    expect(http.get).not.toHaveBeenCalled();

    menuLens.set('foundation');
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(service.loaded('foundation')()).toBe(true);
    expect(setFoundation).not.toHaveBeenCalled();
    expect(setLens).not.toHaveBeenCalled();

    // Promoted to hybrid (a late grant) while still previewing the same lens: the merged selector's sibling loads too,
    // still without a default.
    isHybridPersona.set(true);
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();
    expect(service.loaded('project')()).toBe(true);
    expect(setFoundation).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
  });

  it("preloads the page's sibling list on a hybrid promotion while the drawer previews Me", async () => {
    const http = { get: vi.fn().mockReturnValue(of({ ...emptyPage(), items: [{ uid: 'p1', slug: 'p1', name: 'P1' }] })) };
    const activeLens = signal('foundation');
    const menuLens = signal('me');
    const isHybridPersona = signal(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        {
          provide: LensService,
          useValue: {
            activeLens,
            menuLens,
            previewingMenuLens: computed(() => menuLens() !== activeLens()),
            availableLenses: signal([]),
            isHybridPersona,
            setLens: vi.fn(),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal({ uid: 'f1', slug: 'f1', name: 'F1' }),
            selectedProject: signal(null),
            clearFoundation: vi.fn(),
            clearProject: vi.fn(),
            setFoundation: vi.fn(),
            setProject: vi.fn(),
          },
        },
        { provide: PersonaService, useValue: { personaProjects: signal({}) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: FavoriteProjectsService, useValue: { state: signal({ data: new Set<string>(), loading: false, error: false }) } },
      ],
    });
    const service = TestBed.inject(NavigationService);
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();
    expect(service.loaded('project')()).toBe(false);

    isHybridPersona.set(true);
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();

    expect(service.loaded('project')()).toBe(true);
    TestBed.resetTestingModule();
  });
});
