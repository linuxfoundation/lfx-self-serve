// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
// The no-access branch renders a `lfxOpenIntercom` support button, which injects MessageService.
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgEasyclaComponent } from './org-easycla.component';

describe('OrgEasyclaComponent', () => {
  const selectedAccount = signal<{ accountName: string } | null>(null);
  const hasOrgSelectorAccess = signal(true);
  const grantsLoaded = signal(true);
  const personaLoaded = signal(true);

  async function render(): Promise<ComponentFixture<OrgEasyclaComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
        { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
        { provide: PersonaService, useValue: { personaLoaded } },
        MessageService,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    selectedAccount.set(null);
    hasOrgSelectorAccess.set(true);
    grantsLoaded.set(true);
    personaLoaded.set(true);
  });

  it('renders the empty-state scaffold', async () => {
    const fixture = await render();
    const page = fixture.nativeElement.querySelector('[data-testid="org-easycla-page"]');
    const empty = fixture.nativeElement.querySelector('[data-testid="org-easycla-empty-state"]');

    expect(page).toBeTruthy();
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No CLAs signed yet');
  });

  // Matches the sibling org-lens pages (memberships, projects) and the approved M3 design,
  // which titles the page "EasyCLA — {Company}".
  it('titles the page with the selected company', async () => {
    selectedAccount.set({ accountName: 'Acme Motors, Inc.' });

    const fixture = await render();
    const title = fixture.nativeElement.querySelector('[data-testid="org-easycla-title"]');

    expect(title.textContent).toContain('EasyCLA');
    expect(title.textContent).toContain('Acme Motors, Inc.');
  });

  it('falls back to the bare title before an account resolves', async () => {
    const fixture = await render();
    const title = fixture.nativeElement.querySelector('[data-testid="org-easycla-title"]');

    expect(title.textContent).toContain('EasyCLA');
    expect(title.textContent).not.toContain('—');
  });

  // The route guard only checks the dark-launch flag, so the component owns the access answer.
  // Telling an unauthorized caller "No CLAs signed yet" would describe their CLAs rather than
  // their access, and imply the org has none.
  it('says the lens is unavailable, not that no CLAs exist, when the caller holds no org access', async () => {
    hasOrgSelectorAccess.set(false);

    const fixture = await render();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-no-access-state"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-empty-state"]')).toBeNull();
  });

  it('withholds both answers until the grant and persona fetches have returned', async () => {
    hasOrgSelectorAccess.set(false);
    grantsLoaded.set(false);

    const fixture = await render();

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-loading"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-no-access-state"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-empty-state"]')).toBeNull();
  });
});
