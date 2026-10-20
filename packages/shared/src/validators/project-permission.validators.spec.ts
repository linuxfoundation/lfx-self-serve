// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { roleRequiresCoordinatorValidator } from './project-permission.validators';

describe('roleRequiresCoordinatorValidator', () => {
  // ValidatorFn only reads group.get(name).value, so a bare object stands in for a FormGroup.
  const validate = (role: string, meetingCoordinator: boolean) => {
    const values: Record<string, unknown> = { role, meetingCoordinator };
    return roleRequiresCoordinatorValidator()({ get: (name: string) => ({ value: values[name] }) } as unknown as AbstractControl);
  };

  it("refuses role 'none' without the meeting coordinator grant", () => {
    expect(validate('none', false)).toEqual({ roleRequiresCoordinator: true });
  });

  it("accepts role 'none' together with the meeting coordinator grant", () => {
    expect(validate('none', true)).toBeNull();
  });

  it.each(['view', 'manage'])('accepts %s with or without the meeting coordinator grant', (role) => {
    expect(validate(role, false)).toBeNull();
    expect(validate(role, true)).toBeNull();
  });
});
