// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { parseFormationIntakeBody } from './formation-validation.helper';

import type { Request } from 'express';

function reqWithBody(body: Record<string, unknown>): Request {
  return { body, path: '/api/formations' } as unknown as Request;
}

const validContact = { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' };

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_name: 'Example Project',
    trademark_status: 'not_filed',
    contributing_org_name: 'Example Org',
    license: 'MIT',
    chat_platform: 'slack',
    mission_statement: 'Our mission.',
    agreement_type: 'dco',
    description: 'A description.',
    legal_contact: validContact,
    ...overrides,
  };
}

describe('parseFormationIntakeBody', () => {
  it('parses a fully valid body into a normalized FormationIntake', () => {
    const intake = parseFormationIntakeBody(reqWithBody(validBody()), 'create_formation');

    expect(intake.project_name).toBe('Example Project');
    expect(intake.legal_contact).toEqual(validContact);
    expect(intake.additional_contacts).toEqual([]);
    expect(intake.parent_project_uid).toBeNull();
    expect(intake.is_spec_project).toBe(false);
  });

  it.each(['project_name', 'trademark_status', 'contributing_org_name', 'license', 'chat_platform', 'mission_statement', 'agreement_type', 'description'])(
    'throws when the required field %s is missing',
    (field) => {
      const body = validBody();
      delete body[field];

      expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
    }
  );

  it('throws when the legal contact is missing required fields', () => {
    const body = validBody({ legal_contact: { first_name: 'Jane' } });

    expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
  });

  it('rejects a legal contact with an invalid email', () => {
    const body = validBody({ legal_contact: { ...validContact, email: 'not-an-email' } });

    expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
  });

  it('parses additional_contacts and validates each entry', () => {
    const body = validBody({ additional_contacts: [validContact, { ...validContact, email: 'second@example.test' }] });

    const intake = parseFormationIntakeBody(reqWithBody(body), 'create_formation');

    expect(intake.additional_contacts).toHaveLength(2);
  });

  it('rejects an invalid entry inside additional_contacts', () => {
    const body = validBody({ additional_contacts: [{ first_name: 'No', last_name: 'Email' }] });

    expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
  });

  it('accepts an optional https repository/website URL', () => {
    const body = validBody({ project_repository_url: 'https://github.com/example/example', website_url: 'https://example.test' });

    const intake = parseFormationIntakeBody(reqWithBody(body), 'create_formation');

    expect(intake.project_repository_url).toBe('https://github.com/example/example');
    expect(intake.website_url).toBe('https://example.test');
  });

  it('rejects a non-https repository URL', () => {
    const body = validBody({ project_repository_url: 'http://github.com/example/example' });

    expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
  });

  it('rejects a mission statement over the code-point cap', () => {
    const body = validBody({ mission_statement: 'a'.repeat(601) });

    expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
  });

  it('rejects a description over the code-point cap', () => {
    const body = validBody({ description: 'a'.repeat(1201) });

    expect(() => parseFormationIntakeBody(reqWithBody(body), 'create_formation')).toThrow();
  });
});
