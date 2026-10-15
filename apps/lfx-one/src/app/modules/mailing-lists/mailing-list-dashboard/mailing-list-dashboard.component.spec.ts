// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GroupsIOMailingList, GroupsIOService } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailingListDashboardComponent } from './mailing-list-dashboard.component';

describe('MailingListDashboardComponent service visibility', () => {
  const lists = [
    { uid: 'ml-1', group_name: 'general', title: 'General', public: true },
    { uid: 'ml-2', group_name: 'tech', title: 'Tech', public: true },
  ] as GroupsIOMailingList[];
  const service = { uid: 'svc-1' } as GroupsIOService;

  function createComponent(options: { services: GroupsIOService[]; lists: GroupsIOMailingList[]; canWrite?: boolean }) {
    const getServicesByProject = vi.fn(() => of(options.services));
    const getMailingListsByProject = vi.fn(() => of(options.lists));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal({ uid: 'p-1', slug: 'osaia' }), canWrite: signal(options.canWrite ?? false) },
        },
        { provide: ProjectService, useValue: { getProject: vi.fn(() => of({ uid: 'p-1', parent_uid: 'parent-1' })) } },
        { provide: MailingListService, useValue: { getServicesByProject, getMailingListsByProject, getMyMailingLists: vi.fn(() => of([])) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true), hasBoardRole: signal(false), hasProjectRole: signal(false) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    const component = TestBed.runInInjectionContext(() => new MailingListDashboardComponent());
    // `toObservable` bridges emit on effect flush.
    TestBed.tick();

    expect(getMailingListsByProject).toHaveBeenCalledWith('p-1');
    expect(getServicesByProject).toHaveBeenCalledWith('p-1');
    return { component, getServicesByProject };
  }

  it('shows readable lists when no service is visible to the caller', () => {
    const { component, getServicesByProject } = createComponent({ services: [], lists });

    expect(getServicesByProject).toHaveBeenCalledWith('parent-1');
    expect(component.hasNoServices()).toBe(true);
    expect(component.totalMailingLists()).toBe(2);
    expect(component.showNoServicesState()).toBe(false);
  });

  it('shows the no-services state when neither a service nor any list is visible', () => {
    // A failed list fetch also resolves to [] and lands here.
    const { component } = createComponent({ services: [], lists: [] });

    expect(component.showNoServicesState()).toBe(true);
  });

  it('keeps the inner empty state path when a service exists but has no lists', () => {
    const { component } = createComponent({ services: [service], lists: [] });

    expect(component.hasNoServices()).toBe(false);
    expect(component.showNoServicesState()).toBe(false);
  });

  it('hides list creation from writers when no service is visible', () => {
    const { component } = createComponent({ services: [], lists, canWrite: true });

    expect(component['canCreateMailingList']()).toBe(false);
  });

  it('allows list creation for writers when a service is visible', () => {
    const { component } = createComponent({ services: [service], lists, canWrite: true });

    expect(component['canCreateMailingList']()).toBe(true);
  });
});
