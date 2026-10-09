// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailingListViewComponent } from './mailing-list-view.component';

describe('MailingListViewComponent indexed address', () => {
  function createComponent(list: GroupsIOMailingList): MailingListViewComponent {
    const getMailingList = vi.fn(() => of(list));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MailingListService, useValue: { getMailingList } },
        { provide: ProjectContextService, useValue: {} },
        { provide: LensService, useValue: { setLens: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    // The route param is supplied independently of the list's project or parent service.
    TestBed.overrideProvider(ActivatedRoute, { useValue: { paramMap: of(convertToParamMap({ id: 'ml-1' })) } });
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
});
