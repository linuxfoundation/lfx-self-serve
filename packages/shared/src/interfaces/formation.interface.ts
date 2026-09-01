// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationState } from '../enums/formation.enum';

/**
 * A named contact captured on the intake form — the legal contact (required) or one of the
 * "who else should we loop in" additions (optional, repeatable).
 */
export interface FormationContact {
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * The "Propose a project" intake payload (GH-1962). Deliberately flat — the field list is
 * explicitly pending Scott's confirmation against the current Google Form/PCC add-project set
 * (see #1962's "Field alignment" note), so adding/renaming a field here is a small, contained
 * diff rather than a change spread across a nested shape.
 */
export interface FormationIntake {
  // Parent — optional; null means "Not sure — let LF decide" (defaults to the Linux Foundation
  // root; staff set the real parent on Accept, not at intake time).
  parent_project_uid: string | null;

  // Project
  project_name: string;
  project_repository_url: string | null;
  /** Fixture-era placeholder — the selected file's name only; no upload backend exists yet. */
  project_logo_filename: string | null;
  trademark_status: string;

  // Contributing organization
  contributing_org_name: string;
  /** CDP-resolved org id, when the org picker resolved a match. */
  contributing_org_id: string | null;
  /** A full normalized URL (via `normalizeToUrl`, the same shape `organization-search.component.ts` writes to `domainControl` elsewhere), not a bare domain — named to match. */
  contributing_org_website_url: string | null;
  legal_contact: FormationContact;
  /** "Who else should we loop in" — optional, repeatable. */
  additional_contacts: FormationContact[];

  // Governance and licensing
  license: string;
  /** Chat platform is the agreement of record here; the checklist (#1958) later verifies it happened. */
  chat_platform: string;
  mission_statement: string;
  agreement_type: string;
  is_spec_project: boolean;

  // About
  description: string;
  website_url: string | null;
}

/**
 * A created formation (Epic 1 fallback path). `project_uid: null` is the "Record not yet
 * created" state — no v1 or v2 project record exists until a formation admin creates one
 * manually in the admin tool and links it. `data_source: 'mock'` marks every response as
 * produced by the fixture-backed `formation.service.ts` (#1957 isn't built yet) — see that
 * file's doc comment for the fixture convention.
 */
export interface Formation {
  uid: string;
  state: FormationState;
  parent_project_uid: string | null;
  /** Null until a formation admin links a manually-created v1/v2 project record. */
  project_uid: string | null;
  template_version: string;
  submitted_by: string;
  submitted_at: string;
  intake: FormationIntake;
  /**
   * Epic 1 scope (#1957): the formation service itself writes the proposer's `participant`
   * tuple on submit, no invite-service involved. The fixture doesn't perform a real FGA write —
   * this flag reflects what the real service will have done, for the client to render the real
   * Epic-1 UX ahead of #1957 landing.
   */
  participant_granted: boolean;
  data_source: 'mock';
}
