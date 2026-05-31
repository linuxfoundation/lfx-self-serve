// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMAIL_REGEX, FOUNDATION_ID_PATTERN, KEY_CONTACT_ROLE_CATALOG } from '@lfx-one/shared/constants';
import { AddKeyContactRequest, OrgMembershipKeyContactType, ReplaceKeyContactRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { mapKeyContactUpstreamError } from '../helpers/key-contact-error.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensKeyContactsService } from '../services/org-lens-key-contacts.service';
import { OrgLensMembershipsService } from '../services/org-lens-memberships.service';
import { OrgSfidResolver } from '../services/org-sfid-resolver.service';

// HTTP boundary for spec-024 key-contact employee search + write proxy endpoints.
export class OrgLensKeyContactsController {
  private readonly validContactTypes = new Set<string>(KEY_CONTACT_ROLE_CATALOG.map((c) => c.contactType));
  private readonly service: OrgLensKeyContactsService;
  private readonly membershipsService: OrgLensMembershipsService;
  private readonly orgSfidResolver: OrgSfidResolver;

  public constructor() {
    this.service = new OrgLensKeyContactsService();
    this.membershipsService = new OrgLensMembershipsService();
    this.orgSfidResolver = new OrgSfidResolver();
  }

  // GET /api/orgs/:orgUid/lens/key-contacts/employees
  public async getEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_key_contact_employees', { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, 'get_org_key_contact_employees');
      // Employee search keys the indexer off the org uuid directly (no sfid needed).
      const employees = await this.service.getEmployees(req, orgUid);
      logger.success(req, 'get_org_key_contact_employees', startTime, { org_uid: orgUid, employee_count: employees.length });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ orgUid, employees });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/memberships/:foundationId/key-contacts
  public async addKeyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'add_org_key_contact', { org_uid: orgUid, foundation_id: foundationId });
    try {
      assertOrgUid(orgUid, 'add_org_key_contact');
      this.assertFoundationId(foundationId, 'add_org_key_contact');
      const body = this.parseContactBody(req, 'add_org_key_contact');

      const slug = await this.resolveSlugOrThrow(req, orgUid, foundationId, 'add_org_key_contact');
      const contact = await this.service.addKeyContact(req, orgUid, slug, body);

      logger.success(req, 'add_org_key_contact', startTime, { org_uid: orgUid, foundation_id: foundationId, contact_type: body.contactType });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contact });
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'add_org_key_contact');
    }
  }

  // PUT /api/orgs/:orgUid/lens/memberships/:foundationId/key-contacts/:contactUid
  public async replaceKeyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const contactUid = req.params['contactUid'];
    const startTime = logger.startOperation(req, 'replace_org_key_contact', { org_uid: orgUid, foundation_id: foundationId });
    try {
      assertOrgUid(orgUid, 'replace_org_key_contact');
      this.assertFoundationId(foundationId, 'replace_org_key_contact');
      this.assertContactUid(contactUid, 'replace_org_key_contact');
      const body = this.parseContactBody(req, 'replace_org_key_contact') as ReplaceKeyContactRequest;

      const slug = await this.resolveSlugOrThrow(req, orgUid, foundationId, 'replace_org_key_contact');
      const contact = await this.service.replaceKeyContact(req, orgUid, slug, contactUid, body);

      logger.success(req, 'replace_org_key_contact', startTime, { org_uid: orgUid, foundation_id: foundationId, contact_type: body.contactType });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contact });
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'replace_org_key_contact');
    }
  }

  // DELETE /api/orgs/:orgUid/lens/memberships/:foundationId/key-contacts/:contactUid
  public async removeKeyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const contactUid = req.params['contactUid'];
    const startTime = logger.startOperation(req, 'remove_org_key_contact', { org_uid: orgUid, foundation_id: foundationId });
    try {
      assertOrgUid(orgUid, 'remove_org_key_contact');
      this.assertFoundationId(foundationId, 'remove_org_key_contact');
      this.assertContactUid(contactUid, 'remove_org_key_contact');

      const slug = await this.resolveSlugOrThrow(req, orgUid, foundationId, 'remove_org_key_contact');
      const contact = await this.service.removeKeyContact(req, orgUid, slug, contactUid);

      logger.success(req, 'remove_org_key_contact', startTime, { org_uid: orgUid, foundation_id: foundationId });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contact });
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'remove_org_key_contact');
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  // Resolves the foundation slug through the org sfid bridge used by Snowflake-backed summaries.
  private async resolveSlugOrThrow(req: Request, orgUid: string, foundationId: string, operation: string): Promise<string> {
    const sfid = (await this.orgSfidResolver.resolveSfid(req, orgUid)) ?? '';
    const slug = await this.membershipsService.getFoundationSlug(sfid, foundationId);
    if (!slug) {
      throw ServiceValidationError.forField('foundationId', 'No membership found for this organization and foundation', { operation });
    }
    return slug;
  }

  // Validates and normalizes add/replace payloads.
  private parseContactBody(req: Request, operation: string): AddKeyContactRequest {
    const raw = (req.body ?? {}) as Partial<AddKeyContactRequest>;
    const contactType = String(raw.contactType ?? '') as OrgMembershipKeyContactType;
    const email = String(raw.email ?? '').trim();
    const firstName = String(raw.firstName ?? '').trim();
    const lastName = String(raw.lastName ?? '').trim();
    const jobTitle = raw.jobTitle != null ? String(raw.jobTitle).trim() : null;

    if (!this.validContactTypes.has(contactType)) {
      throw ServiceValidationError.forField('contactType', 'Unknown key-contact role', { operation });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      throw ServiceValidationError.forField('email', 'A valid email address is required', { operation });
    }
    if (!firstName) {
      throw ServiceValidationError.forField('firstName', 'First name is required', { operation });
    }
    if (!lastName) {
      throw ServiceValidationError.forField('lastName', 'Last name is required', { operation });
    }
    return { contactType, email, firstName, lastName, jobTitle };
  }

  // Maps member-service write failures to clean status/message envelopes.
  private handleWriteError(req: Request, res: Response, next: NextFunction, error: unknown, operation: string): void {
    if (error instanceof ServiceValidationError) {
      next(error);
      return;
    }
    const mapped = mapKeyContactUpstreamError(error);
    logger.warning(req, operation, 'Key-contact write failed', { status: mapped.status, conflict: mapped.conflict });
    res.setHeader('Cache-Control', 'no-store');
    res
      .status(mapped.status)
      .json({ error: { code: mapped.conflict ? 'CONFLICT' : 'KEY_CONTACT_WRITE_FAILED', message: mapped.message, conflict: mapped.conflict } });
  }

  private assertFoundationId(foundationId: string | undefined, operation: string): asserts foundationId is string {
    if (!foundationId || !FOUNDATION_ID_PATTERN.test(foundationId)) {
      throw ServiceValidationError.forField('foundationId', 'Invalid foundationId format', { operation });
    }
  }

  private assertContactUid(contactUid: string | undefined, operation: string): asserts contactUid is string {
    // FOUNDATION_ID_PATTERN is the shared general-purpose SSR path-param validator (covers the
    // member-service UUID v8 shape a key_contact UID uses); reused here to avoid a duplicate regex.
    if (!contactUid || !FOUNDATION_ID_PATTERN.test(contactUid)) {
      throw ServiceValidationError.forField('contactUid', 'Invalid contactUid format', { operation });
    }
  }
}
