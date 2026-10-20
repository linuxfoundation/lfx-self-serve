// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PROJECT_PERMISSION_ROLE_COLOR, PROJECT_PERMISSION_ROLE_OPTIONS } from '@lfx-one/shared/constants';
import { ProjectPermissionRole, ProjectPermissionUser } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UserPermissionsTableComponent } from './user-permissions-table.component';

const buildUser = (username: string, role: ProjectPermissionRole): ProjectPermissionUser => ({
  username,
  name: username,
  email: `${username}@acme-motors.example`,
  role,
});

const MANAGER = buildUser('manager', 'manage');
const VIEWER = buildUser('viewer', 'view');
const COORDINATOR = buildUser('coordinator', 'meeting_coordinator');

describe('UserPermissionsTableComponent role filter', () => {
  let fixture: ComponentFixture<UserPermissionsTableComponent>;
  let component: UserPermissionsTableComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UserPermissionsTableComponent],
      providers: [
        { provide: PermissionsService, useValue: {} },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: {} },
        { provide: DialogService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContext: () => null } },
      ],
    });
    TestBed.overrideComponent(UserPermissionsTableComponent, { set: { template: '', imports: [] } });
    fixture = TestBed.createComponent(UserPermissionsTableComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('users', [MANAGER, VIEWER, COORDINATOR]);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('offers one pill per role, colored by the shared role color map', () => {
    expect(component.roleFilterOptions.map((option) => option.id)).toEqual(PROJECT_PERMISSION_ROLE_OPTIONS.map((option) => option.value));
    expect(component.roleFilterOptions.find((option) => option.id === 'manage')?.color).toBe('green');
    expect(component.roleFilterOptions.find((option) => option.id === 'view')?.color).toBe('red');
    expect(component.roleFilterOptions.find((option) => option.id === 'meeting_coordinator')?.color).toBe('purple');
    for (const option of component.roleFilterOptions) {
      expect(option.color).toBe(PROJECT_PERMISSION_ROLE_COLOR[option.id as ProjectPermissionRole]);
    }
  });

  it('shows every user while no role is selected', () => {
    expect(component.selectedRole()).toBeNull();
    expect(component.filteredUsers()).toEqual([MANAGER, VIEWER, COORDINATOR]);
  });

  it.each([
    ['manage', [MANAGER]],
    ['view', [VIEWER]],
    ['meeting_coordinator', [COORDINATOR]],
  ] as const)('shows only %s users once that role pill is picked', (role, expected) => {
    component['onRoleFilterToggle'](role);

    expect(component.selectedRole()).toBe(role);
    expect(component.filteredUsers()).toEqual(expected);
  });

  it('clears the filter when the active pill is clicked again', () => {
    component['onRoleFilterToggle']('view');
    component['onRoleFilterToggle']('view');

    expect(component.selectedRole()).toBeNull();
    expect(component.filteredUsers()).toEqual([MANAGER, VIEWER, COORDINATOR]);
  });

  it('switches straight to another role when a different pill is clicked', () => {
    component['onRoleFilterToggle']('view');
    component['onRoleFilterToggle']('manage');

    expect(component.selectedRole()).toBe('manage');
    expect(component.filteredUsers()).toEqual([MANAGER]);
  });

  it('returns no rows when nobody holds the selected role', () => {
    fixture.componentRef.setInput('users', [MANAGER, VIEWER]);
    component['onRoleFilterToggle']('meeting_coordinator');

    expect(component.filteredUsers()).toEqual([]);
  });

  it('re-filters when the users input changes', () => {
    component['onRoleFilterToggle']('view');
    expect(component.filteredUsers()).toEqual([VIEWER]);

    const another = buildUser('another-viewer', 'view');
    fixture.componentRef.setInput('users', [MANAGER, VIEWER, another]);

    expect(component.filteredUsers()).toEqual([VIEWER, another]);
  });
});
