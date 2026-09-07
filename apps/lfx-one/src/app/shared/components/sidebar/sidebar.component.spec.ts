// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { IdMigrationModalComponent } from '@components/id-migration-modal/id-migration-modal.component';
import { ID_MIGRATION_EVENTS, ID_MIGRATION_FUNNEL, ID_MIGRATION_RETURN_LINK_ENABLED, ID_MIGRATION_SOURCE_APP } from '@lfx-one/shared/constants';
import { User } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { DataDogRumService } from '@services/datadog-rum.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarComponent } from './sidebar.component';

/**
 * Pins the migration funnel's FIRST event (LFXV2-3336). LINK_CLICK is emitted only here, so
 * without this spec a rename, a dropped context payload, or a link that stops firing would break
 * the join with the ID-side events silently — the CONTINUE half is covered in
 * id-migration-modal.component.spec.ts. The template is overridden empty so the class logic runs
 * without instantiating the selector/lens-tab children and their service graph.
 */
describe('SidebarComponent — Individual Dashboard return link (LFXV2-3336)', () => {
  const addAction = vi.fn();
  const open = vi.fn();
  let fixture: ComponentFixture<SidebarComponent>;

  // `openIdDashboardReturn` is protected; reach it through a narrow cast rather than clicking
  // through the overridden (empty) template.
  const openReturn = (c: SidebarComponent): void => (c as unknown as { openIdDashboardReturn: () => void }).openIdDashboardReturn();

  beforeEach(async () => {
    addAction.mockClear();
    open.mockClear();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        { provide: Router, useValue: { url: '/', navigate: vi.fn() } },
        { provide: DataDogRumService, useValue: { addAction } },
        { provide: DialogService, useValue: { open } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        {
          provide: LensService,
          useValue: { activeLens: signal('me'), isHybridPersona: signal(false), availableLenses: signal([]), setLens: vi.fn() },
        },
        {
          provide: UserService,
          useValue: { user: signal({ user_id: 'u1' } as unknown as User), userInitials: computed(() => 'AL'), effectiveAvatarUrl: computed(() => '') },
        },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal(null), activeRouteLensKind: signal('me'), setFoundation: vi.fn(), setProject: vi.fn() },
        },
        {
          provide: PersonaService,
          useValue: { isRootWriter: signal(false), personaProjects: signal({}), allPersonas: signal([]), currentPersona: signal('contributor') },
        },
        { provide: NavigationService, useValue: { loaded: vi.fn(() => signal(true)) } },
        { provide: AccountContextService, useValue: { hasOrgSelectorAccess: vi.fn(() => false) } },
      ],
    });
    // Empty template + no component providers: exercises the class without rendering the child
    // components, and lets the mocked DialogService above replace the component-level provider.
    TestBed.overrideComponent(SidebarComponent, { set: { template: '', imports: [], providers: [] } });

    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('items', []);
    await fixture.whenStable();
  });

  it('emits LINK_CLICK with the shared funnel tag and source_app', () => {
    openReturn(fixture.componentInstance);

    // Exact payload, not objectContaining: the ID-side query joins on `funnel` + `source_app`, so a
    // dropped or renamed key here is the failure this pins. No reason yet — the modal captures it.
    expect(addAction).toHaveBeenCalledWith(ID_MIGRATION_EVENTS.LINK_CLICK, {
      funnel: ID_MIGRATION_FUNNEL,
      source_app: ID_MIGRATION_SOURCE_APP,
    });
  });

  it('opens the reason-capture modal, headless and dismissable', () => {
    openReturn(fixture.componentInstance);

    expect(open).toHaveBeenCalledWith(
      IdMigrationModalComponent,
      expect.objectContaining({
        // The modal body renders its own headline, so a PrimeNG header would double it up; the
        // heading id is what ariaLabelledBy points at.
        showHeader: false,
        ariaLabelledBy: 'id-migration-heading',
        modal: true,
        dismissableMask: true,
      })
    );
  });

  it('emits LINK_CLICK before the modal opens, so an open failure cannot swallow the event', () => {
    const callOrder: string[] = [];
    addAction.mockImplementation(() => callOrder.push('addAction'));
    open.mockImplementation(() => callOrder.push('open'));

    openReturn(fixture.componentInstance);

    expect(callOrder).toEqual(['addAction', 'open']);
  });

  it('keeps the return link gated on the shared in-code flag', () => {
    // The link is retired by flipping this constant, so the component must read it rather than
    // hard-coding `true` — otherwise the sunset switch silently stops working.
    expect((fixture.componentInstance as unknown as { idReturnLinkEnabled: boolean }).idReturnLinkEnabled).toBe(ID_MIGRATION_RETURN_LINK_ENABLED);
  });
});
