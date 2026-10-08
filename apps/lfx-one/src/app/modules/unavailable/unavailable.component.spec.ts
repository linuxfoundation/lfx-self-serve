// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location, PathLocationStrategy } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { provideLocationMocks } from '@angular/common/testing';
import { PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationSkipped, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { projectQueryParamGuard } from '@shared/guards/project-query-param.guard';
import { newsletterAccessGuard } from '@shared/guards/newsletter-access.guard';
import { formationProjectEnabledGuard } from '@shared/guards/formation-project-enabled.guard';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { PersonaService } from '@shared/services/persona.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectRecoveryService } from '@shared/services/project-recovery.service';
import { ProjectService } from '@shared/services/project.service';
import { defer, filter, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundComponent } from '../not-found/not-found.component';
import { UnavailableComponent } from './unavailable.component';

describe('UnavailableComponent', () => {
  function create(platform: 'server' | 'browser', reqContext: ServerRequestContext | null) {
    TestBed.configureTestingModule({
      imports: [UnavailableComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: REQUEST_CONTEXT, useValue: reqContext },
        { provide: ProjectService, useValue: {} },
        provideRouter([]),
        provideLocationMocks(),
      ],
    });
    return TestBed.createComponent(UnavailableComponent);
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('flags unavailable only during SSR', () => {
    const reqContext: ServerRequestContext = { unavailable: false };
    create('server', reqContext);
    expect(reqContext.unavailable).toBe(true);
  });

  it('leaves the request context untouched in the browser', () => {
    const reqContext: ServerRequestContext = { unavailable: false };
    create('browser', reqContext);
    expect(reqContext.unavailable).toBe(false);
  });

  it('does not throw without a request context', () => {
    expect(() => create('server', null)).not.toThrow();
  });

  it('retries the original path and query string from the rendered button', () => {
    const fixture = create('browser', null);
    vi.spyOn(TestBed.inject(Location), 'path').mockReturnValue('/foundation/groups?project=test-foundation');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="unavailable-retry-button"] button').click();

    expect(navigate).toHaveBeenCalledWith('/foundation/groups?project=test-foundation');
  });

  it('preserves the fragment with production Location semantics when navigation state is absent', () => {
    const fixture = create('browser', null);
    const platformLocation = {
      pathname: '/foundation/groups',
      search: '?project=test-foundation',
      hash: '#section',
      getBaseHrefFromDOM: () => '/',
      onPopState: () => () => undefined,
      onHashChange: () => () => undefined,
    };
    const location = new Location(new PathLocationStrategy(platformLocation as never, '/'));
    vi.spyOn(TestBed.inject(Location), 'path').mockImplementation((includeHash) => location.path(includeHash));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.retry();

    expect(navigate).toHaveBeenCalledWith('/foundation/groups?project=test-foundation#section');
  });

  it('recovers the failed destination from a different page through the actual guard, router and retry button', async () => {
    let unavailable = true;
    const setProject = vi.fn();
    const lookup = vi.fn(() =>
      defer(() =>
        unavailable ? throwError(() => new HttpErrorResponse({ status: 503 })) : of({ uid: 'test-project-uid', name: 'Test project', slug: 'test-project' })
      )
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProjectStrict: lookup } },
        { provide: ProjectContextService, useValue: { setRouteLensKind: vi.fn(), setProject, setFoundation: vi.fn() } },
        provideLocationMocks(),
        provideRouter([
          { path: '', component: NotFoundComponent },
          { path: 'project/groups', data: { lens: 'project' }, canActivate: [projectQueryParamGuard], component: NotFoundComponent },
          { path: 'unavailable', component: UnavailableComponent },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create('/');
    const router = TestBed.inject(Router);
    const target = '/project/groups?project=test-project#section';
    await harness.navigateByUrl(target, UnavailableComponent);
    expect(router.url).toBe('/unavailable');
    expect(TestBed.inject(Location).path()).toBe('/');
    expect(setProject).not.toHaveBeenCalled();

    unavailable = false;
    const recovered = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('[data-testid="unavailable-retry-button"] button')!.click();
    await recovered;

    expect(router.url).toBe(target);
    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ uid: 'test-project-uid' }));
  });

  it.each(['groups', 'newsletters', 'formation'])('retries the latest destination after repeated failures through %s guards', async (page) => {
    let unavailable = true;
    const lookup = vi.fn(() =>
      defer(() =>
        unavailable
          ? throwError(() => new HttpErrorResponse({ status: 503 }))
          : of({ uid: 'test-project-uid', name: 'Test project', slug: 'test-project', writer: true, stage: 'Formation - Exploratory' })
      )
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProjectStrict: lookup } },
        { provide: ProjectContextService, useValue: { setRouteLensKind: vi.fn(), setProject: vi.fn(), setFoundation: vi.fn(), activeContext: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => 'maintainer' } },
        { provide: FeatureFlagService, useValue: { getFlagOverride: () => true } },
        provideLocationMocks(),
        provideRouter([
          { path: '', component: NotFoundComponent },
          {
            path: 'project/groups',
            data: { lens: 'project' },
            component: NotFoundComponent,
            canActivate: [projectQueryParamGuard],
          },
          {
            path: 'project/newsletters',
            data: { lens: 'project' },
            component: NotFoundComponent,
            canActivate: [newsletterAccessGuard, projectQueryParamGuard],
          },
          {
            path: 'project/formation',
            data: { lens: 'project' },
            component: NotFoundComponent,
            canMatch: [formationProjectEnabledGuard],
            canActivate: [projectQueryParamGuard],
          },
          { path: 'unavailable', component: UnavailableComponent },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create('/');
    const router = TestBed.inject(Router);
    const first = `/project/${page}?project=first-project#first`;
    const second = `/project/${page}?project=second-project#second`;
    const component = await harness.navigateByUrl(first, UnavailableComponent);
    const skipped = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationSkipped)));

    await router.navigateByUrl(second);
    await skipped;
    expect(harness.routeDebugElement!.componentInstance).toBe(component);
    expect(router.url).toBe('/unavailable');
    expect(TestBed.inject(ProjectRecoveryService).retryUrl).toBe(second);

    unavailable = false;
    const recovered = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('[data-testid="unavailable-retry-button"] button')!.click();
    await recovered;

    expect(router.url).toBe(second);
    expect(TestBed.inject(ProjectRecoveryService).retryUrl).toBeUndefined();
  });

  it.each(['', '/unavailable', '/unavailable?project=test-foundation'])('falls back to the dashboard for path %j', (path) => {
    const fixture = create('browser', null);
    vi.spyOn(TestBed.inject(Location), 'path').mockReturnValue(path);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.retry();

    expect(navigate).toHaveBeenCalledWith('/');
  });
});
