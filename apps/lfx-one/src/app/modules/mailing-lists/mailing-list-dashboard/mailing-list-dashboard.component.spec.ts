// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
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

  async function createComponent(options: { services: GroupsIOService[]; lists: GroupsIOMailingList[]; canWrite?: boolean }) {
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

    // Keep the real dashboard template while shallow-rendering its child components.
    TestBed.overrideComponent(MailingListDashboardComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(MailingListDashboardComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;

    expect(getMailingListsByProject).toHaveBeenCalledWith('p-1');
    expect(getServicesByProject).toHaveBeenCalledWith('p-1');
    return { component, getServicesByProject, element };
  }

  it('shows readable lists when no service is visible to the caller', async () => {
    const { component, getServicesByProject, element } = await createComponent({ services: [], lists });

    expect(getServicesByProject).toHaveBeenCalledWith('parent-1');
    expect(component.hasNoServices()).toBe(true);
    expect(component.totalMailingLists()).toBe(2);
    expect(component.showNoServicesState()).toBe(false);
    expect(element.querySelector('lfx-mailing-list-table')).not.toBeNull();
    expect(element.querySelector('[data-testid="mailing-lists-foundation-stats"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="mailing-list-no-services-card"]')).toBeNull();
    expect(element.querySelector('[data-testid="mailing-list-new-cta"]')).toBeNull();
  });

  it('shows the no-services state when neither a service nor any list is visible', async () => {
    // A failed list fetch also resolves to [] and lands here.
    const { component, element } = await createComponent({ services: [], lists: [] });

    expect(component.showNoServicesState()).toBe(true);
    expect(element.querySelector('[data-testid="mailing-list-no-services-card"]')).not.toBeNull();
    expect(element.querySelector('lfx-mailing-list-table')).toBeNull();
    expect(element.querySelector('[data-testid="mailing-list-new-cta"]')).toBeNull();
  });

  it('keeps the inner empty state path when a service exists but has no lists', async () => {
    const { component, element } = await createComponent({ services: [service], lists: [] });

    expect(component.hasNoServices()).toBe(false);
    expect(component.showNoServicesState()).toBe(false);
    expect(element.querySelector('[data-testid="mailing-list-project-empty-state"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="mailing-list-no-services-card"]')).toBeNull();
  });

  it('hides list creation from writers when no service is visible', async () => {
    const { component, element } = await createComponent({ services: [], lists, canWrite: true });

    expect(component['canCreateMailingList']()).toBe(false);
    expect(element.querySelector('lfx-mailing-list-table')).not.toBeNull();
    expect(element.querySelector('[data-testid="mailing-list-new-cta"]')).toBeNull();
  });

  it('allows list creation for writers when a service is visible', async () => {
    const { component, element } = await createComponent({ services: [service], lists, canWrite: true });

    expect(component['canCreateMailingList']()).toBe(true);
    expect(element.querySelector('[data-testid="mailing-list-new-cta"]')).not.toBeNull();
  });
});
