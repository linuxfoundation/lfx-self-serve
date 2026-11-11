// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, ReplaySubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailingListViewComponent } from './mailing-list-view.component';

describe('MailingListViewComponent indexed address', () => {
  const setLens = vi.fn();

  function createComponent(list: GroupsIOMailingList, navState?: Record<string, unknown>): MailingListViewComponent {
    setLens.mockClear();
    const getMailingList = vi.fn(() => of(list));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MailingListService, useValue: { getMailingList } },
        { provide: ProjectContextService, useValue: {} },
        { provide: LensService, useValue: { setLens } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    // The route param is supplied independently of the list's project or parent service.
    TestBed.overrideProvider(ActivatedRoute, { useValue: { paramMap: of(convertToParamMap({ id: 'ml-1' })) } });
    if (navState) {
      vi.spyOn(TestBed.inject(Router), 'getCurrentNavigation').mockReturnValue({ extras: { state: navState } } as never);
    }
    const component = TestBed.runInInjectionContext(() => new MailingListViewComponent());

    expect(getMailingList).toHaveBeenCalledWith('ml-1');
    return component;
  }

  it('derives the detail address from the list even without a parent service', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main', domain: 'lists.example.org' } as GroupsIOMailingList);
    expect(component.emailAddress()).toBe('main@lists.example.org');
  });

  it('does not display a bare group name as an email when the domain is missing', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList);
    expect(component.emailAddress()).toBe('');
  });

  it('builds the Groups.io link from the list domain and group name', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main', domain: 'lists.example.org' } as GroupsIOMailingList);
    expect(component.groupsIoUrl()).toBe('https://lists.example.org/g/main');
  });

  it('falls back to the parent service URL when the domain is missing', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main', service: { url: 'https://groups.io/g/parent' } } as GroupsIOMailingList);
    expect(component.groupsIoUrl()).toBe('https://groups.io/g/parent');
  });

  it('has no Groups.io link when nothing can be derived', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList);
    expect(component.groupsIoUrl()).toBeNull();
  });

  it('rejects a non-http(s) parent service URL', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main', service: { url: 'javascript:alert(1)' } } as GroupsIOMailingList);
    expect(component.groupsIoUrl()).toBeNull();
  });

  it('restores the Me lens and returns to mailing lists when opened from My Mailing Lists', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList, { fromMeLens: true });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component.goBack();
    expect(setLens).toHaveBeenCalledWith('me');
    expect(navigate).toHaveBeenCalledWith(['/', 'mailing-lists']);
  });

  it("links each linked group to its group details page from the list's own tier", () => {
    const component = createComponent({
      uid: 'ml-1',
      group_name: 'main',
      is_foundation: false,
      committees: [
        { uid: 'group-1', name: 'Technical Steering Committee' },
        { uid: 'group-2', name: 'Security Working Group' },
      ],
    } as GroupsIOMailingList);

    const links = component.groupLinks();
    expect(links.map((link) => link.name)).toEqual(['Technical Steering Committee', 'Security Working Group']);
    expect(links[0].commands?.at(-1)).toBe('group-1');
    expect(links[1].commands?.at(-1)).toBe('group-2');
  });

  it('keeps a linked group with no uid as plain text instead of dropping it', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main', committees: [{ uid: '', name: 'Orphan Group' }] } as GroupsIOMailingList);

    expect(component.groupLinks()).toEqual([{ uid: '', name: 'Orphan Group', commands: null }]);
  });

  it('sends back state so the group page returns to Mailing Lists, restoring Me only when opened from there', () => {
    const fromMe = createComponent({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList, { fromMeLens: true });
    expect(fromMe['groupLinkState']).toEqual({ backLabel: 'Mailing Lists', backPath: '/mailing-lists', fromMeLens: true });

    TestBed.resetTestingModule();
    const other = createComponent({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList);
    expect(other['groupLinkState']).toEqual({ backLabel: 'Mailing Lists', backPath: '/mailing-lists', fromMeLens: false });
  });

  it('leaves the lens alone when not opened from My Mailing Lists', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component.goBack();
    expect(setLens).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/', 'mailing-lists']);
  });

  it('applies a sync-settings save result matching the currently displayed list', () => {
    const component = createComponent({ uid: 'ml-1', group_name: 'main', writer: false } as GroupsIOMailingList);
    component.applySyncSettingsUpdate({ uid: 'ml-1', group_name: 'main', writer: true } as GroupsIOMailingList);
    expect(component.mailingList()?.writer).toBe(true);
  });

  it('ignores a late sync-settings save result for a list other than the one currently displayed', () => {
    // Simulates a save started on a previous list resolving after the `:id` route has moved on to
    // ml-1 — the component instance is reused across navigation, so this result must not override
    // the newly displayed list (#4880 review).
    const component = createComponent({ uid: 'ml-1', group_name: 'main', writer: true } as GroupsIOMailingList);
    component.applySyncSettingsUpdate({ uid: 'ml-stale', group_name: 'stale', writer: true, sync_mode: 'manual' } as unknown as GroupsIOMailingList);
    expect(component.mailingList()?.uid).toBe('ml-1');
  });

  it('does not let a late save-result override mask a newly-navigated list once its fetch lands (Cursor Bugbot)', () => {
    // Reproduces the race: the route moves from ml-1 to ml-2 (its fetch still in flight, so
    // `fetchedMailingList()` still holds ml-1's data), and ml-1's save resolves in that window —
    // after the start-of-navigation override reset, but before ml-2's GET completes. Without
    // clearing the override again when ml-2's data actually lands, ml-2's page would keep showing
    // ml-1's (overridden) data forever.
    const paramMap$ = new ReplaySubject<ReturnType<typeof convertToParamMap>>(1);
    paramMap$.next(convertToParamMap({ id: 'ml-1' }));
    const ml2Response$ = new Subject<GroupsIOMailingList>();
    const getMailingList = vi.fn((id: string) => (id === 'ml-1' ? of({ uid: 'ml-1', group_name: 'main' } as GroupsIOMailingList) : ml2Response$));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MailingListService, useValue: { getMailingList } },
        { provide: ProjectContextService, useValue: {} },
        { provide: LensService, useValue: { setLens: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    TestBed.overrideProvider(ActivatedRoute, { useValue: { paramMap: paramMap$ } });
    const component = TestBed.runInInjectionContext(() => new MailingListViewComponent());
    expect(component.mailingList()?.uid).toBe('ml-1');

    // Navigate to ml-2 (fetch kicked off but not yet resolved), then let ml-1's save resolve.
    paramMap$.next(convertToParamMap({ id: 'ml-2' }));
    component.applySyncSettingsUpdate({ uid: 'ml-1', group_name: 'main', writer: true } as GroupsIOMailingList);
    expect(component.mailingList()?.uid).toBe('ml-1');

    // ml-2's fetch now lands — it must win, not the stale ml-1 override.
    ml2Response$.next({ uid: 'ml-2', group_name: 'other' } as GroupsIOMailingList);
    expect(component.mailingList()?.uid).toBe('ml-2');
  });
});
