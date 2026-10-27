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
  ProjectMembershipIndexedDoc,
  QueryServiceResponse,
  ResolvedMembershipContext,
  ReplaceKeyContactRequest,
} from '@lfx-one/shared/interfaces';
import { agreedUsername, isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { allOrgPeopleDirectoryNamespaces } from '../helpers/org-people-directory-cache.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { evictPerUserOrgFetch } from '../utils/single-flight';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgMembershipResolverService } from './org-membership-resolver.service';
import { invalidatePerUserCache } from './valkey.service';

// Key-contact reads + writes backed by query-service (read) and member-service (write).
export class OrgLensKeyContactsService {
  // Active membership statuses, case-insensitive — mirrors OrgMembershipResolverService and OrgPeopleKeyContactsService so we don't silently drop 'purchased' or mixed-case 'active' memberships.
  private static readonly activeMembershipStatuses = new Set(['active', 'purchased']);

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
    // Invalidate the moment the write lands, not after the reconcile: upsertRow re-reads the indexer
    // and can throw, and a roster left cached behind a failed reconcile is stale all the same.
    await this.invalidateCallerDirectoryCache(req, ctx.b2bOrgUid);
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
      await this.invalidateCallerDirectoryCache(req, ctx.b2bOrgUid);
    } else {
      // Brand-new contact (FR-022b): create-new (carries names) then remove-old. These can't be a single
      // atomic call (the member-service update body has no name fields), so a create-succeeded /
      // delete-failed window exists where the role transiently holds BOTH contacts. On a delete failure
      // surface a reload-and-review message so the user doesn't blind-retry and create a second duplicate.
      authoritative = await this.createContact(req, ctx, body);
      // The create has landed, so the role row has already changed. Invalidating here rather than only
      // at the end covers every exit below it, including the 409 thrown when the delete fails — the case
      // that most needs it, since that message sends the user off to review the contacts.
      await this.invalidateCallerDirectoryCache(req, ctx.b2bOrgUid);
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
      // Again, now that the delete has landed. Between the two the role genuinely holds BOTH contacts,
      // and a read that started in that window caches that transient roster — the eviction above is
      // already behind it, so without this the caller is served a two-holder row until the TTL expires.
      await this.invalidateCallerDirectoryCache(req, ctx.b2bOrgUid);
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
    await this.invalidateCallerDirectoryCache(req, ctx.b2bOrgUid);
    return { ...beforeRow, people: beforeRow.people.filter((p) => p.personId !== contactUid) };
  }

  // Returns org-wide key-contact employee-search candidates deduped by email.
  public async getEmployees(req: Request, b2bOrgUid: string): Promise<KeyContactEmployee[]> {
    if (!b2bOrgUid || !isFilterSafeIdentifier(b2bOrgUid)) {
      return [];
    }
    return this.getEmployeesByOrgUid(req, b2bOrgUid);
  }

  /**
   * Drop the caller's cached All Employees roster after a key-contact write.
   *
   * Mirrors `OrgLensBoardCommitteeService.invalidateCallerSeatCaches`, and for the same reason: the
   * directory merges key contacts as one of its four sources, so a reassign changes both who appears
   * on All Employees and — since #4401 — which roles their Key Contact cell shows. Without this, a
   * user who reassigns a role and returns to All Employees sees the former holder's pill until the
   * 30-second entry expires.
   *
   * Evicting the in-process flight matters as much as the delete: a merge that started before the
   * write would otherwise be joined by the next read and write the pre-write roster back afterwards.
   * Once evicted it skips its write (`isCurrent` is false) and the next read starts fresh.
   *
   * Residual, as with seats: the fence is per process and per caller. A fill in flight on another
   * replica, or another caller's entry, can still serve the pre-write roster until the TTL expires.
   */
  private async invalidateCallerDirectoryCache(req: Request, b2bOrgUid: string): Promise<void> {
    const username = getEffectiveUsername(req) ?? '';
    // The directory is cached per (time range, project scope) and for the unranged roster, so the bare
    // family name is not a key any entry is stored under. Every scope goes, as the seat helper does it:
    // a key contact's roles are range-independent, so there is no scope a write can leave standing.
    const namespaces = allOrgPeopleDirectoryNamespaces();
    for (const namespace of namespaces) {
      evictPerUserOrgFetch(namespace, username, b2bOrgUid);
    }
    await Promise.all(namespaces.map((namespace) => invalidatePerUserCache(namespace, username, b2bOrgUid)));
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
        page_size: 200,
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
    // Username agreement is only sound over the complete document set, so a dropped page fails the fetch.
    // The memberships ride alongside (not after) the contacts, so scoping the roles costs no serial latency.
    //
    // allSettled, not all: the memberships only scope the ROLES, while the employee list they travel with
    // is what the reassign pickers search and what replaceKeyContact reads to choose PUT over create+delete.
    // Letting a membership-index blip reject the whole read would take a write path and a people picker
    // down for the sake of a column, and would drop every key-contact-only person out of the directory
    // roster — the directory folds this source in with allSettled, so a rejection removes it entirely.
    const [docsResult, membershipsResult] = await Promise.allSettled([
      fetchAllQueryResources<KeyContactDoc>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<KeyContactDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'key_contact',
            tags: `b2b_org_uid:${b2bOrgUid}`,
            page_size: 200,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      ),
      fetchAllQueryResources<ProjectMembershipIndexedDoc>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'project_membership',
            tags: `b2b_org_uid:${b2bOrgUid}`,
            page_size: 200,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      ),
    ]);

    // The contacts are this read's reason to exist, so their failure is still fatal.
    if (docsResult.status === 'rejected') throw docsResult.reason;
    const docs = docsResult.value;

    // A contact document stays Active after its membership lapses, so a role is only real while the
    // membership behind it is. The Key Contacts tab joins the same way (OrgPeopleKeyContactsService), and
    // the two views have to agree about who holds what. This scopes the ROLES only — the employee list
    // itself stays as it was, because the people pickers that share this read search the whole org.
    //
    // With the memberships unavailable there is no way to tell a live role from a lapsed one, so every
    // role is dropped rather than guessed at. The column then reads as "no key-contact roles", which is
    // wrong in the quiet direction; serving them unscoped would re-open the very disagreement with the
    // Key Contacts tab that scoping them closed.
    if (membershipsResult.status === 'rejected') {
      logger.warning(req, 'get_org_key_contact_employees', 'Membership read failed; serving employees without key-contact roles', {
        b2b_org_uid: b2bOrgUid,
        err: membershipsResult.reason,
      });
    }
    const memberships = membershipsResult.status === 'fulfilled' ? membershipsResult.value : [];
    const activeMembershipUids = new Set(
      memberships.filter((m) => m.uid && OrgLensKeyContactsService.activeMembershipStatuses.has((m.status ?? '').toLowerCase())).map((m) => m.uid as string)
    );

    // Group by address, then require the group to agree on one non-empty username; fail closed otherwise.
    const docsByEmail = new Map<string, KeyContactDoc[]>();
    for (const d of docs) {
      if ((d.status ?? '').toLowerCase() === 'inactive') continue;
      const email = this.resolveEmail(d);
      if (!email) continue;
      docsByEmail.set(email, [...(docsByEmail.get(email) ?? []), d]);
    }

    const employees: KeyContactEmployee[] = [];
    for (const [email, group] of docsByEmail) {
      const d = group[0];
      const firstName = (d.first_name ?? '').trim();
      const lastName = (d.last_name ?? '').trim();
      employees.push({
        email,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        jobTitle: d.title?.trim() ? d.title.trim() : null,
        initials: this.deriveInitials(firstName, lastName),
        avatarUrl: d.avatar?.trim() ? d.avatar.trim() : null,
        lfUsername: agreedUsername(group.map((doc) => doc.username)),
        // One doc per (membership, role), so the same role on two foundation memberships appears twice — dedupe to the person-level set the Key Contact column renders.
        roles: [
          ...new Set(
            group
              .filter((doc) => OrgLensKeyContactsService.holdsLiveRole(doc, activeMembershipUids))
              .map((doc) => doc.role?.trim())
              .filter((role): role is string => !!role)
          ),
        ].sort((a, b) => a.localeCompare(b)),
      });
    }
    return employees.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * Whether the document describes a role the person actually holds right now.
   *
   * Both halves mirror OrgPeopleKeyContactsService, because the Key Contact column and the Key Contacts
   * tab have to agree about who holds what:
   *
   * - The contact must itself be active. A set status that is anything other than 'active' is dropped,
   *   not just 'inactive' — the tab reads it that way, so a 'Pending' contact would otherwise earn a pill
   *   here and appear nowhere on the tab. An absent status is treated as active, as the tab treats it.
   * - The membership behind it must still be live. A document carries its membership under either key
   *   depending on the index, and one with neither is dropped rather than trusted: an unattributable role
   *   cannot be shown to be live, and showing a stale one is the worse failure.
   *
   * This gates the ROLE only. The employee list keeps its own looser filter, because the reassign pickers
   * share that read and search the whole org.
   */
  private static holdsLiveRole(doc: KeyContactDoc, activeMembershipUids: ReadonlySet<string>): boolean {
    if (doc.status && doc.status.toLowerCase() !== 'active') return false;
    const membershipUid = doc.project_membership_uid ?? doc.membership_uid;
    return !!membershipUid && activeMembershipUids.has(membershipUid);
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
        send_invite: true,
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
      send_invite: true,
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
      avatarUrl: d.avatar?.trim() ? d.avatar.trim() : null,
      username: d.username?.trim() ? d.username.trim() : null,
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
