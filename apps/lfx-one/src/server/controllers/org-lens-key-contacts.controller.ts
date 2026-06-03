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

// HTTP boundary for spec-024 key-contact employee search + write proxy endpoints.
export class OrgLensKeyContactsController {
  private readonly validContactTypes = new Set<string>(KEY_CONTACT_ROLE_CATALOG.map((c) => c.contactType));
  private readonly service: OrgLensKeyContactsService;
  private readonly membershipsService: OrgLensMembershipsService;

  public constructor() {
    this.service = new OrgLensKeyContactsService();
    this.membershipsService = new OrgLensMembershipsService();
  }

  // GET /api/orgs/:orgUid/lens/key-contacts/employees
  public async getEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_key_contact_employees', { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, 'get_org_key_contact_employees');
      // Employee search keys the indexer off the org account id (SFID) directly.
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

  // LFXV2-2067 — slug-keyed proxies skip the sfid→foundation_id bridge that the membership-detail page needs.

  // GET /api/orgs/:orgUid/lens/key-contacts/membership/:foundationSlug
  public async getKeyContactCatalogBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationSlug = req.params['foundationSlug'];
    const startTime = logger.startOperation(req, 'get_org_key_contact_catalog_by_slug', { org_uid: orgUid, foundation_slug: foundationSlug });
    try {
      assertOrgUid(orgUid, 'get_org_key_contact_catalog_by_slug');
      this.assertFoundationSlug(foundationSlug, 'get_org_key_contact_catalog_by_slug');

      const contacts = await this.service.getKeyContacts(req, orgUid, foundationSlug);

      logger.success(req, 'get_org_key_contact_catalog_by_slug', startTime, {
        org_uid: orgUid,
        foundation_slug: foundationSlug,
        row_count: contacts.length,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contacts });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/key-contacts/membership/:foundationSlug
  public async addKeyContactBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationSlug = req.params['foundationSlug'];
    const startTime = logger.startOperation(req, 'add_org_key_contact_by_slug', { org_uid: orgUid, foundation_slug: foundationSlug });
    try {
      assertOrgUid(orgUid, 'add_org_key_contact_by_slug');
      this.assertFoundationSlug(foundationSlug, 'add_org_key_contact_by_slug');
      const body = this.parseContactBody(req, 'add_org_key_contact_by_slug');

      const contact = await this.service.addKeyContact(req, orgUid, foundationSlug, body);

      logger.success(req, 'add_org_key_contact_by_slug', startTime, { org_uid: orgUid, foundation_slug: foundationSlug, contact_type: body.contactType });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contact });
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'add_org_key_contact_by_slug');
    }
  }

  // PUT /api/orgs/:orgUid/lens/key-contacts/membership/:foundationSlug/:contactUid
  public async replaceKeyContactBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationSlug = req.params['foundationSlug'];
    const contactUid = req.params['contactUid'];
    const startTime = logger.startOperation(req, 'replace_org_key_contact_by_slug', { org_uid: orgUid, foundation_slug: foundationSlug });
    try {
      assertOrgUid(orgUid, 'replace_org_key_contact_by_slug');
      this.assertFoundationSlug(foundationSlug, 'replace_org_key_contact_by_slug');
      this.assertContactUid(contactUid, 'replace_org_key_contact_by_slug');
      const body = this.parseContactBody(req, 'replace_org_key_contact_by_slug') as ReplaceKeyContactRequest;

      const contact = await this.service.replaceKeyContact(req, orgUid, foundationSlug, contactUid, body);

      logger.success(req, 'replace_org_key_contact_by_slug', startTime, {
        org_uid: orgUid,
        foundation_slug: foundationSlug,
        contact_type: body.contactType,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contact });
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'replace_org_key_contact_by_slug');
    }
  }

  // DELETE /api/orgs/:orgUid/lens/key-contacts/membership/:foundationSlug/:contactUid
  public async removeKeyContactBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationSlug = req.params['foundationSlug'];
    const contactUid = req.params['contactUid'];
    const startTime = logger.startOperation(req, 'remove_org_key_contact_by_slug', { org_uid: orgUid, foundation_slug: foundationSlug });
    try {
      assertOrgUid(orgUid, 'remove_org_key_contact_by_slug');
      this.assertFoundationSlug(foundationSlug, 'remove_org_key_contact_by_slug');
      this.assertContactUid(contactUid, 'remove_org_key_contact_by_slug');

      const contact = await this.service.removeKeyContact(req, orgUid, foundationSlug, contactUid);

      logger.success(req, 'remove_org_key_contact_by_slug', startTime, { org_uid: orgUid, foundation_slug: foundationSlug });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contact });
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'remove_org_key_contact_by_slug');
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  // Resolves the foundation slug from the Snowflake-backed summaries. Spec 002: orgUid is the SFID.
  private async resolveSlugOrThrow(req: Request, orgUid: string, foundationId: string, operation: string): Promise<string> {
    const slug = await this.membershipsService.getFoundationSlug(orgUid, foundationId);
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

  private assertFoundationSlug(foundationSlug: string | undefined, operation: string): asserts foundationSlug is string {
    // Reuse FOUNDATION_ID_PATTERN — it permits the alphanumeric+hyphen surface that foundation slugs
    // share with the legacy id strings (matches the precedent in `getMembershipDetail`).
    if (!foundationSlug || !FOUNDATION_ID_PATTERN.test(foundationSlug)) {
      throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', { operation });
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
