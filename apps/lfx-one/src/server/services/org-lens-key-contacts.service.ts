// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CONTACT_TYPE_TO_ROLE, KEY_CONTACT_PRIMARY_CONTACT_TYPE, KEY_CONTACT_ROLE_CATALOG, roleToContactType } from '@lfx-one/shared/constants';
import {
  AddKeyContactRequest,
  KeyContactDoc,
  KeyContactEmployee,
  OrgMembershipKeyContact,
  OrgMembershipKeyContactPerson,
  OrgMembershipKeyContactType,
  QueryServiceResponse,
  ResolvedMembershipContext,
  ReplaceKeyContactRequest,
} from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgMembershipResolverService } from './org-membership-resolver.service';

// Key-contact reads + writes backed by query-service (read) and member-service (write).
export class OrgLensKeyContactsService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly resolver: OrgMembershipResolverService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.resolver = new OrgMembershipResolverService();
  }

  // Returns all 9 key-contact rows for the active membership behind a foundation slug.
  public async getKeyContacts(req: Request, b2bOrgUid: string, foundationSlug: string): Promise<OrgMembershipKeyContact[]> {
    const ctx = await this.resolver.resolveContext(req, b2bOrgUid, foundationSlug);
    if (!ctx) {
      return this.buildCatalogRows([]);
    }
    return this.fetchRowsForContext(req, ctx);
  }

  // Warms membership resolution cache for parallel detail-page loading.
  public async prefetchMembership(req: Request, b2bOrgUid: string, foundationSlug: string): Promise<void> {
    try {
      await this.resolver.fetchMembershipsBySlug(req, b2bOrgUid, foundationSlug);
    } catch {
      // Intentionally ignored — resolveContext re-fetches and surfaces the error there.
    }
  }

  // Adds a key contact and returns the reconciled affected role row.
  public async addKeyContact(req: Request, b2bOrgUid: string, foundationSlug: string, body: AddKeyContactRequest): Promise<OrgMembershipKeyContact> {
    const ctx = await this.resolveOr404(req, b2bOrgUid, foundationSlug);
    const created = await this.createContact(req, ctx, body);
    // Reconcile from the authoritative write response (real uid, no indexer lag), upserted over the
    // current role row. A bare indexer re-read here would race read-after-write and echo stale data.
    return this.upsertRow(req, ctx, body.contactType, created, []);
  }

  // Replaces one contact in a role, using PUT when possible and create+delete otherwise.
  public async replaceKeyContact(
    req: Request,
    b2bOrgUid: string,
    foundationSlug: string,
    contactUid: string,
    body: ReplaceKeyContactRequest
  ): Promise<OrgMembershipKeyContact> {
    const ctx = await this.resolveOr404(req, b2bOrgUid, foundationSlug);
    const email = body.email.trim().toLowerCase();
    const known = (await this.getEmployeesByOrgUid(req, ctx.b2bOrgUid)).some((e) => e.email === email);

    let authoritative: OrgMembershipKeyContactPerson;
    if (known) {
      // Atomic in-place update (FR-015): no transient empty state. The PUT returns the updated record
      // (same uid), which we use to reconcile — avoiding read-after-write indexer lag.
      const etag = await this.fetchEtag(req, ctx.membershipUid, contactUid);
      const updated = await this.microserviceProxy.proxyRequest<KeyContactDoc>(
        req,
        'LFX_V2_SERVICE',
        `/project_memberships/${ctx.membershipUid}/key_contacts/${contactUid}`,
        'PUT',
        undefined,
        this.toUpdateBody(body, email),
        etag ? { 'If-Match': etag } : undefined
      );
      authoritative = this.toPerson(updated);
    } else {
      // Brand-new contact (FR-022b): create-new (carries names) then remove-old. These can't be a single
      // atomic call (the member-service update body has no name fields), so a create-succeeded /
      // delete-failed window exists where the role transiently holds BOTH contacts. On a delete failure
      // surface a reload-and-review message so the user doesn't blind-retry and create a second duplicate.
      authoritative = await this.createContact(req, ctx, body);
      const etag = await this.fetchEtag(req, ctx.membershipUid, contactUid);
      try {
        await this.microserviceProxy.proxyRequest(
          req,
          'LFX_V2_SERVICE',
          `/project_memberships/${ctx.membershipUid}/key_contacts/${contactUid}`,
          'DELETE',
          undefined,
          undefined,
          etag ? { 'If-Match': etag } : undefined
        );
      } catch (error) {
        logger.warning(req, 'replace_org_key_contact', 'Partial replace: new contact created but old not removed', {
          membership_uid: ctx.membershipUid,
          old_contact_uid: contactUid,
          new_contact_uid: authoritative.personId,
          err: error instanceof Error ? error.message : String(error),
        });
        throw new MicroserviceError(
          'The new contact was added, but the previous one could not be removed — reload to review the current contacts before retrying.',
          409,
          'CONFLICT',
          { operation: 'replace_org_key_contact', service: 'LFX_V2_SERVICE', path: `/project_memberships/${ctx.membershipUid}/key_contacts/${contactUid}` }
        );
      }
    }

    // Single-slot replace: the role ends with exactly the new contact. Drop the old uid + dedup the new.
    return this.upsertRow(req, ctx, body.contactType, authoritative, [contactUid]);
  }

  // Removes one contact and returns the affected role row.
  public async removeKeyContact(req: Request, b2bOrgUid: string, foundationSlug: string, contactUid: string): Promise<OrgMembershipKeyContact> {
    const ctx = await this.resolveOr404(req, b2bOrgUid, foundationSlug);
    const rowsBefore = await this.fetchRowsForContext(req, ctx);
    // Identify the role the contact belongs to so we can return the affected row. If it isn't in any
    // role row, the contact is gone from this membership (already removed / indexer drift) — surface a
    // 404 the controller maps to a friendly "reload" message rather than guessing an unrelated row.
    const beforeRow = rowsBefore.find((r) => r.people.some((p) => p.personId === contactUid));
    if (!beforeRow) {
      throw new MicroserviceError('Key contact not found for this membership', 404, 'NOT_FOUND', {
        operation: 'remove_org_key_contact',
        service: 'LFX_V2_SERVICE',
        path: `/project_memberships/${ctx.membershipUid}/key_contacts/${contactUid}`,
      });
    }

    const etag = await this.fetchEtag(req, ctx.membershipUid, contactUid);
    await this.microserviceProxy.proxyRequest(
      req,
      'LFX_V2_SERVICE',
      `/project_memberships/${ctx.membershipUid}/key_contacts/${contactUid}`,
      'DELETE',
      undefined,
      undefined,
      etag ? { 'If-Match': etag } : undefined
    );

    // Reconcile by dropping the removed uid from the pre-write row (indexer may still echo it).
    return { ...beforeRow, people: beforeRow.people.filter((p) => p.personId !== contactUid) };
  }

  // Returns org-wide key-contact employee-search candidates deduped by email.
  public async getEmployees(req: Request, b2bOrgUid: string): Promise<KeyContactEmployee[]> {
    if (!b2bOrgUid || !isFilterSafeIdentifier(b2bOrgUid)) {
      return [];
    }
    return this.getEmployeesByOrgUid(req, b2bOrgUid);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async fetchRowsForContext(req: Request, ctx: ResolvedMembershipContext): Promise<OrgMembershipKeyContact[]> {
    // Scope strictly to the active membership. NOTE: query-service treats multiple `tags` as OR, so
    // adding `b2b_org_uid` (which matches every org contact) would silently widen this to the whole
    // org across all memberships. The membership UID is derived from the org's own project_membership
    // (resolver) and query-service applies the caller's FGA, so the single tag is both correct and safe.
    // Tracing (perf): scoped key_contact read for the resolved membership (usually a single page).
    const tFetchStart = Date.now();
    const docs = await fetchAllQueryResources<KeyContactDoc>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<KeyContactDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'key_contact',
        tags: `project_membership_uid:${ctx.membershipUid}`,
        per_page: 200,
        ...(pageToken && { page_token: pageToken }),
      })
    );
    logger.info(req, 'fetch_key_contacts_timing', 'key_contact read complete', {
      project_membership_uid: ctx.membershipUid,
      contact_doc_count: docs.length,
      fetch_ms: Date.now() - tFetchStart,
    });
    return this.buildCatalogRows(docs);
  }

  private async getEmployeesByOrgUid(req: Request, b2bOrgUid: string): Promise<KeyContactEmployee[]> {
    if (!isFilterSafeIdentifier(b2bOrgUid)) return [];
    const docs = await fetchAllQueryResources<KeyContactDoc>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<KeyContactDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'key_contact',
        tags: `b2b_org_uid:${b2bOrgUid}`,
        per_page: 200,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    const byEmail = new Map<string, KeyContactEmployee>();
    for (const d of docs) {
      if ((d.status ?? '').toLowerCase() === 'inactive') continue;
      const email = this.resolveEmail(d);
      if (!email || byEmail.has(email)) continue;
      const firstName = (d.first_name ?? '').trim();
      const lastName = (d.last_name ?? '').trim();
      byEmail.set(email, {
        email,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        jobTitle: d.title?.trim() ? d.title.trim() : null,
        initials: this.deriveInitials(firstName, lastName),
      });
    }
    return [...byEmail.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  // Resolves an active membership context or throws a not-found MicroserviceError.
  private async resolveOr404(req: Request, b2bOrgUid: string, foundationSlug: string): Promise<ResolvedMembershipContext> {
    const ctx = await this.resolver.resolveContext(req, b2bOrgUid, foundationSlug);
    if (!ctx) {
      throw new MicroserviceError('No active membership for this organization and foundation', 404, 'NOT_FOUND', {
        operation: 'resolve_membership_context',
        service: 'LFX_V2_SERVICE',
        path: '/query/resources',
      });
    }
    return ctx;
  }

  // Creates a key-contact row in member-service and maps it to the UI person shape.
  private async createContact(
    req: Request,
    ctx: ResolvedMembershipContext,
    body: AddKeyContactRequest | ReplaceKeyContactRequest
  ): Promise<OrgMembershipKeyContactPerson> {
    const title = body.jobTitle?.trim();
    const created = await this.microserviceProxy.proxyRequest<KeyContactDoc>(
      req,
      'LFX_V2_SERVICE',
      `/project_memberships/${ctx.membershipUid}/key_contacts`,
      'POST',
      undefined,
      {
        email: body.email.trim().toLowerCase(),
        first_name: body.firstName.trim(),
        last_name: body.lastName.trim(),
        ...(title ? { title } : {}),
        role: CONTACT_TYPE_TO_ROLE[body.contactType],
        status: 'Active',
        primary_contact: body.contactType === KEY_CONTACT_PRIMARY_CONTACT_TYPE,
        board_member: false,
      }
    );
    return this.toPerson(created);
  }

  private toUpdateBody(body: ReplaceKeyContactRequest, email: string): Record<string, unknown> {
    const title = body.jobTitle?.trim();
    return {
      email,
      role: CONTACT_TYPE_TO_ROLE[body.contactType],
      status: 'Active',
      primary_contact: body.contactType === KEY_CONTACT_PRIMARY_CONTACT_TYPE,
      board_member: false,
      ...(title ? { title } : {}),
    };
  }

  // Reads the current ETag for optimistic-concurrency writes.
  private async fetchEtag(req: Request, membershipUid: string, contactUid: string): Promise<string | undefined> {
    const resp = await this.microserviceProxy.proxyRequestWithResponse<unknown>(
      req,
      'LFX_V2_SERVICE',
      `/project_memberships/${membershipUid}/key_contacts/${contactUid}`,
      'GET'
    );
    const headers = resp.headers ?? {};
    const etag = headers['etag'] ?? headers['ETag'];
    if (!etag) {
      // Without an ETag the downstream write goes out unconditionally, so the FR-022a lost-update /
      // 412-conflict protection is lost for this mutation. Log so the degradation is visible to operators.
      logger.warning(req, 'fetch_key_contact_etag', 'No ETag on key_contact GET; write will proceed without If-Match (optimistic concurrency degraded)', {
        membership_uid: membershipUid,
        contact_uid: contactUid,
      });
    }
    return etag;
  }

  // Upserts one authoritative person into the affected role row.
  private async upsertRow(
    req: Request,
    ctx: ResolvedMembershipContext,
    contactType: OrgMembershipKeyContactType,
    person: OrgMembershipKeyContactPerson,
    removeUids: string[]
  ): Promise<OrgMembershipKeyContact> {
    const rows = await this.fetchRowsForContext(req, ctx);
    const cfg = KEY_CONTACT_ROLE_CATALOG.find((c) => c.contactType === contactType);
    const current = rows.find((r) => r.contactType === contactType);
    const drop = new Set([...removeUids, person.personId]);
    const kept = (current?.people ?? []).filter((p) => !drop.has(p.personId));
    return {
      contactType,
      contactTypeLabel: current?.contactTypeLabel ?? cfg?.contactTypeLabel ?? contactType,
      minContacts: current?.minContacts ?? cfg?.minContacts ?? 0,
      maxContacts: current?.maxContacts ?? cfg?.maxContacts ?? 0,
      people: [...kept, person],
    };
  }

  // Groups key-contact docs into the fixed 9-role catalog order.
  private buildCatalogRows(docs: KeyContactDoc[]): OrgMembershipKeyContact[] {
    const byType = new Map<OrgMembershipKeyContactType, OrgMembershipKeyContactPerson[]>();
    for (const cfg of KEY_CONTACT_ROLE_CATALOG) {
      byType.set(cfg.contactType, []);
    }

    for (const d of docs) {
      if ((d.status ?? '').toLowerCase() === 'inactive') continue;
      const contactType = roleToContactType(d.role);
      if (!contactType) continue; // role outside the catalog — ignored per FR-006
      byType.get(contactType)?.push(this.toPerson(d));
    }

    return KEY_CONTACT_ROLE_CATALOG.map((cfg) => ({
      contactType: cfg.contactType,
      contactTypeLabel: cfg.contactTypeLabel,
      minContacts: cfg.minContacts,
      maxContacts: cfg.maxContacts,
      people: byType.get(cfg.contactType) ?? [],
    }));
  }

  private toPerson(d: KeyContactDoc): OrgMembershipKeyContactPerson {
    const firstName = (d.first_name ?? '').trim();
    const lastName = (d.last_name ?? '').trim();
    return {
      personId: d.uid,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email: this.resolveEmail(d),
      jobTitle: d.title?.trim() ? d.title.trim() : null,
      initials: this.deriveInitials(firstName, lastName),
    };
  }

  // Resolves canonical lowercased email, falling back to the first alternate address.
  private resolveEmail(d: KeyContactDoc): string {
    const primary = (d.email ?? '').trim();
    if (primary) return primary.toLowerCase();
    const first = (d.emails ?? []).find((e) => !!e?.trim());
    return first ? first.trim().toLowerCase() : '';
  }

  private deriveInitials(firstName: string, lastName: string): string {
    const a = firstName.charAt(0).toUpperCase();
    const b = lastName.charAt(0).toUpperCase();
    return `${a}${b}`.trim() || '?';
  }
}
