// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Committee, Project } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterAudienceStepComponent } from './newsletter-audience-step.component';

// Foundation/Project contexts with no Newsletter-category group must offer a way to set one up
// instead of asking the user to pick from a picker that isn't rendered.
describe('NewsletterAudienceStepComponent group setup', () => {
  const OWNER_UID = 'owner-uid';
  const project = (uid: string, writer: boolean): Project => ({
    uid,
    slug: 'example-foundation',
    name: 'Example Foundation',
    description: '',
    writer,
    public: true,
    parent_uid: '',
    stage: '',
    category: '',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: '',
    mailing_list_count: 0,
  });
  const activeContext = signal<Project | null>(null);
  const isFoundationContext = signal(false);
  const activeProject = signal<Project | null>(null);
  const canWrite = computed(() => activeProject()?.writer === true);

  const group = (category: string): Committee => ({ uid: `group-${category}`, name: `${category} group`, project_uid: OWNER_UID, category }) as Committee;

  const render = async (committees: Committee[] = []): Promise<ComponentFixture<NewsletterAudienceStepComponent>> => {
    const fixture = TestBed.createComponent(NewsletterAudienceStepComponent);
    fixture.componentRef.setInput('form', new FormGroup({ committeeUids: new FormControl<string[]>([], { nonNullable: true }) }));
    fixture.componentRef.setInput('projectUid', OWNER_UID);
    fixture.componentRef.setInput('committees', committees);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };

  const query = (fixture: ComponentFixture<NewsletterAudienceStepComponent>, selector: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);

  const text = (fixture: ComponentFixture<NewsletterAudienceStepComponent>): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    activeContext.set(project(OWNER_UID, true));
    isFoundationContext.set(true);
    activeProject.set(project(OWNER_UID, true));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: NewsletterService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContext, isFoundationContext, activeProject, canWrite } },
      ],
    });
  });

  it.each([
    { foundation: true, prefix: '/foundation' },
    { foundation: false, prefix: '/project' },
  ])('links writers to Newsletter group setup in the $prefix context, in a new tab', async ({ foundation, prefix }) => {
    isFoundationContext.set(foundation);
    const fixture = await render();

    const create = query(fixture, '[data-testid="newsletter-audience-create-group"] a') as HTMLAnchorElement;
    const view = query(fixture, '[data-testid="newsletter-audience-view-groups"] a') as HTMLAnchorElement;
    expect(create.getAttribute('href')).toBe(`${prefix}/groups/create?project=example-foundation&category=Newsletter`);
    expect(view.getAttribute('href')).toBe(`${prefix}/groups?project=example-foundation`);
    expect(create.target).toBe('_blank');
    expect(create.rel).toContain('noopener');

    expect(text(fixture)).toContain('There are no groups in Example Foundation yet');
    expect(text(fixture)).toContain('refresh groups');
    expect(text(fixture)).not.toContain('Pick the group');
  });

  it('refreshes groups through the retry output', async () => {
    const fixture = await render();
    const refresh = vi.fn();
    fixture.componentInstance.retryCommittees.subscribe(refresh);

    (query(fixture, '[data-testid="newsletter-audience-refresh-groups"] button') as HTMLButtonElement).click();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('explains when groups exist but none are newsletter groups, then shows the picker once one arrives', async () => {
    const fixture = await render([group('Working Group')]);

    expect(text(fixture)).toContain('None of the groups in Example Foundation are newsletter groups');
    expect(query(fixture, '[data-testid="newsletter-audience-committees"]')).toBeNull();

    fixture.componentRef.setInput('committees', [group('Working Group'), group('Newsletter')]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(query(fixture, '[data-testid="newsletter-audience-no-committees"]')).toBeNull();
    expect(query(fixture, '[data-testid="newsletter-audience-committees"]')).not.toBeNull();
    expect(text(fixture)).toContain('Pick the group');
  });

  it('gives non-writers manager guidance without a create action', async () => {
    activeProject.set(project(OWNER_UID, false));
    const fixture = await render();

    expect(query(fixture, '[data-testid="newsletter-audience-create-group"]')).toBeNull();
    expect(query(fixture, '[data-testid="newsletter-audience-view-groups"]')).not.toBeNull();
    expect(text(fixture)).toContain('Ask a manager of Example Foundation');
  });

  it.each([
    { previousWriter: true, nextWriter: false },
    { previousWriter: false, nextWriter: true },
  ])('waits for owner-scoped write access when switching from writer=$previousWriter to writer=$nextWriter', async ({ previousWriter, nextWriter }) => {
    activeProject.set(project(OWNER_UID, previousWriter));
    const fixture = await render();
    expect(!!query(fixture, '[data-testid="newsletter-audience-create-group"]')).toBe(previousWriter);

    // Create-mode owner follows the context immediately; project details still describe the old owner.
    activeContext.set({ ...project('next-owner-uid', nextWriter), slug: 'next-project', name: 'Next Project' });
    fixture.componentRef.setInput('projectUid', 'next-owner-uid');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(query(fixture, '[data-testid="newsletter-audience-create-group"]')).toBeNull();
    expect(query(fixture, '[data-testid="newsletter-audience-view-groups"] a')?.getAttribute('href')).toBe('/foundation/groups?project=next-project');

    activeProject.set(project('next-owner-uid', nextWriter));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(!!query(fixture, '[data-testid="newsletter-audience-create-group"]')).toBe(nextWriter);
    if (nextWriter) {
      expect(query(fixture, '[data-testid="newsletter-audience-create-group"] a')?.getAttribute('href')).toBe(
        '/foundation/groups/create?project=next-project&category=Newsletter'
      );
    }
  });

  it('withholds group creation until the owner project resolves', async () => {
    activeProject.set(null);
    const fixture = await render();
    expect(query(fixture, '[data-testid="newsletter-audience-create-group"]')).toBeNull();

    activeProject.set(project(OWNER_UID, true));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(query(fixture, '[data-testid="newsletter-audience-create-group"]')).not.toBeNull();
  });

  it('withholds setup links when the active context does not own the newsletter', async () => {
    activeContext.set({ ...project('other-uid', true), slug: 'other-project', name: 'Other Project' });
    const fixture = await render();

    expect(query(fixture, '[data-testid="newsletter-audience-create-group"]')).toBeNull();
    expect(query(fixture, '[data-testid="newsletter-audience-view-groups"]')).toBeNull();
    expect(query(fixture, '[data-testid="newsletter-audience-refresh-groups"]')).not.toBeNull();
    expect(text(fixture)).not.toContain('Other Project');
  });

  it('shows loading and error states instead of setup guidance', async () => {
    const fixture = await render();

    fixture.componentRef.setInput('committeesLoading', true);
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="newsletter-audience-no-committees"]')).toBeNull();
    expect(text(fixture)).toContain('Loading groups');

    fixture.componentRef.setInput('committeesLoading', false);
    fixture.componentRef.setInput('committeesError', 'Could not load groups. Please try again.');
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="newsletter-audience-no-committees"]')).toBeNull();
    expect(query(fixture, '[data-testid="newsletter-audience-committees-retry-btn"]')).not.toBeNull();
  });
});
