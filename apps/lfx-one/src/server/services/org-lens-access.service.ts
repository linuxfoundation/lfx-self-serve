// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

import { ORG_ACCESS_ROLE_RELATION } from '@lfx-one/shared/constants';
import {
  MemberServiceB2bOrgSettings,
  MemberServiceOrgUser,
  OrgAccessInviteStatus,
  OrgAccessListResponse,
  OrgAccessRole,
  OrgAccessSummary,
  OrgAccessUser,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgLensKeyContactsService } from './org-lens-key-contacts.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

// Spec 025 — Org Lens Access read/write against member-service settings.
// Reads via GET /b2b_orgs/{uid}/settings. Writes use the PER-PRINCIPAL endpoints
// (POST/PUT/DELETE /b2b_orgs/{uid}/settings/users[/{email}]) so member-service mutates a
// single member while preserving every other member's username/invite lifecycle. This
// replaces the previous full-replace read-modify-write, which could reset untouched members.
// All member-service calls go through the LFX_V2_MEMBER_SERVICE base (defaults to the gateway);
// caller-management (canManage) still reads role-grants via LFX_V2_SERVICE (query-service).
export class OrgLensAccessService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly roleGrants: OrgRoleGrantsService;
  private readonly keyContacts: OrgLensKeyContactsService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.roleGrants = new OrgRoleGrantsService();
    this.keyContacts = new OrgLensKeyContactsService();
  }

  // ── public API (controller boundary) ─────────────────────────────────────────

  /**
   * US1 — list elevated-access principals + summary + caller management flag.
   * Pass `knownCanManage` from a write path that already asserted it to avoid a redundant
   * role-grants lookup on the post-write refresh.
   */
  public async listAccessUsers(req: Request, orgUid: string, knownCanManage?: boolean): Promise<OrgAccessListResponse> {
    const [settings, canManage] = await Promise.all([
      this.fetchSettings(req, orgUid),
      knownCanManage === undefined ? this.resolveCanManage(req, orgUid) : Promise.resolve(knownCanManage),
    ]);
    const users = await this.enrichJobTitles(req, orgUid, this.mapPrincipals(settings));
    return { orgUid, users, summary: this.buildSummary(users), canManage };
  }

  /** Add Users — invite a NEW principal via the per-principal POST endpoint; returns the refreshed list. */
  public async inviteUser(req: Request, orgUid: string, email: string, role: OrgAccessRole, name?: string | null): Promise<OrgAccessListResponse> {
    // Defense-in-depth UX gate (FR-011): reject non-managers before any write is issued.
    await this.assertCanManage(req, orgUid, 'invite_org_access_user');
    const cleanName = (name ?? '').trim();
    const body: { email: string; invited_as: 'writer' | 'auditor'; name?: string } = {
      email: email.trim().toLowerCase(),
      invited_as: ORG_ACCESS_ROLE_RELATION[role],
      ...(cleanName ? { name: cleanName } : {}),
    };
    await this.microserviceProxy.proxyRequest(req, 'LFX_V2_MEMBER_SERVICE', `/b2b_orgs/${encodeURIComponent(orgUid)}/settings/users`, 'POST', undefined, body);
    // canManage was just asserted true above — reuse it to skip a second role-grants lookup.
    return this.listAccessUsers(req, orgUid, true);
  }

  /** US2 — change a principal's role (Admin ⇄ Viewer) via the per-principal PUT endpoint; returns the refreshed list. */
  public async changeRole(req: Request, orgUid: string, email: string, role: OrgAccessRole): Promise<OrgAccessListResponse> {
    await this.assertCanManage(req, orgUid, 'change_org_access_role');
    const target = email.trim().toLowerCase();
    await this.microserviceProxy.proxyRequest(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(orgUid)}/settings/users/${encodeURIComponent(target)}`,
      'PUT',
      undefined,
      { invited_as: ORG_ACCESS_ROLE_RELATION[role] }
    );
    // canManage was just asserted true above — reuse it to skip a second role-grants lookup.
    return this.listAccessUsers(req, orgUid, true);
  }

  /** US3 — revoke a principal's access via the per-principal DELETE endpoint; returns the refreshed list. */
  public async removeUser(req: Request, orgUid: string, email: string): Promise<OrgAccessListResponse> {
    await this.assertCanManage(req, orgUid, 'remove_org_access_user');
    const target = email.trim().toLowerCase();
    await this.microserviceProxy.proxyRequest(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(orgUid)}/settings/users/${encodeURIComponent(target)}`,
      'DELETE'
    );
    // canManage was just asserted true above — reuse it to skip a second role-grants lookup.
    return this.listAccessUsers(req, orgUid, true);
  }

  // ── base helpers ─────────────────────────────────────────────────────────────

  /** Authoritative settings read (member-service source of record). */
  private async fetchSettings(req: Request, orgUid: string): Promise<MemberServiceB2bOrgSettings> {
    const settings = await this.microserviceProxy.proxyRequest<MemberServiceB2bOrgSettings>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(orgUid)}/settings`,
      'GET'
    );
    return settings ?? {};
  }

  /** Maps writers→admin / auditors→viewer; includes accepted+pending, excludes revoked/expired (FR-002), dedups by email writer-wins. */
  private mapPrincipals(settings: MemberServiceB2bOrgSettings): OrgAccessUser[] {
    const byEmail = new Map<string, OrgAccessUser>();

    const consume = (list: MemberServiceOrgUser[] | undefined, role: OrgAccessRole): void => {
      for (const principal of list ?? []) {
        const email = this.emailOf(principal);
        if (!email) continue;
        const status = this.effectiveStatus(principal);
        if (status === 'revoked' || status === 'expired') continue;
        // writer-wins: admins are consumed first, so never overwrite an existing admin row.
        if (byEmail.has(email)) continue;
        const name = (principal.name ?? '').trim() || email.split('@')[0];
        byEmail.set(email, {
          email,
          name,
          initials: this.deriveInitials(name),
          avatarUrl: principal.avatar?.trim() ? principal.avatar.trim() : null,
          jobTitle: null,
          role,
          inviteStatus: status,
          isPending: status !== 'accepted',
        });
      }
    };

    consume(settings.writers, 'admin');
    consume(settings.auditors, 'viewer');

    return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Pure projection of the mapped rows into the summary counts (SC-002 consistency). */
  private buildSummary(users: OrgAccessUser[]): OrgAccessSummary {
    let administrators = 0;
    let viewers = 0;
    for (const user of users) {
      if (user.isPending) continue;
      if (user.role === 'admin') administrators++;
      else viewers++;
    }
    return { totalUsers: users.length, administrators, viewers };
  }

  /** Best-effort job-title enrichment by email from the org people/key_contact index (D-006). */
  private async enrichJobTitles(req: Request, orgUid: string, users: OrgAccessUser[]): Promise<OrgAccessUser[]> {
    if (users.length === 0) return users;
    let titleByEmail = new Map<string, string>();
    try {
      const employees = await this.keyContacts.getEmployees(req, orgUid);
      titleByEmail = new Map(employees.filter((e) => e.email && e.jobTitle).map((e) => [e.email.toLowerCase(), e.jobTitle as string]));
    } catch (error) {
      // Enrichment is non-essential — a missing title must never block the list (D-006).
      logger.warning(req, 'enrich_org_access_job_titles', 'Job-title enrichment failed; rendering without titles', {
        org_uid: orgUid,
        err: error instanceof Error ? error.message : String(error),
      });
      return users;
    }
    return users.map((user) => ({ ...user, jobTitle: titleByEmail.get(user.email) ?? null }));
  }

  /** Caller can manage iff the selected org uid is a direct writer grant (D-005). UX gate only. */
  private async resolveCanManage(req: Request, orgUid: string): Promise<boolean> {
    const username = getEffectiveUsername(req);
    if (!username) return false;
    try {
      const grants = await this.roleGrants.getRoleGrants(req, username);
      return grants.writers.includes(orgUid);
    } catch (error) {
      logger.warning(req, 'resolve_org_access_can_manage', 'Role-grants lookup failed; defaulting canManage=false', {
        org_uid: orgUid,
        err: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Write gate: throws 403 when the caller is verified NOT to be a direct writer, but a retriable
   * 503 when the role-grants lookup itself fails — so a transient outage doesn't masquerade as
   * "no permission". (The lenient `resolveCanManage` is for the read/list UX gate only.)
   */
  private async assertCanManage(req: Request, orgUid: string, operation: string): Promise<void> {
    const forbidden = (): MicroserviceError =>
      new MicroserviceError('You do not have permission to manage Org Lens access for this organization.', 403, 'FORBIDDEN', {
        operation,
        service: 'LFX_V2_MEMBER_SERVICE',
        path: `/b2b_orgs/${orgUid}/settings/users`,
      });

    const username = getEffectiveUsername(req);
    if (!username) {
      throw forbidden();
    }

    let isWriter: boolean;
    try {
      const grants = await this.roleGrants.getRoleGrants(req, username);
      isWriter = grants.writers.includes(orgUid);
    } catch (error) {
      // Couldn't verify (transient role-grants outage) — surface a retriable error, not a 403.
      logger.warning(req, 'assert_org_access_can_manage', 'Role-grants lookup failed; cannot verify manager permission', {
        org_uid: orgUid,
        operation,
        err: error instanceof Error ? error.message : String(error),
      });
      throw new MicroserviceError("Couldn't verify your permissions right now. Please try again.", 503, 'ROLE_GRANTS_UNAVAILABLE', {
        operation,
        // The failing upstream is the role-grants lookup (query-service), not the member-service
        // settings endpoint — report its real path so outage telemetry isn't misleading.
        service: 'LFX_V2_SERVICE',
        path: '/query/resources',
        originalError: error instanceof Error ? error : undefined,
      });
    }

    if (!isWriter) {
      throw forbidden();
    }
  }

  // ── small utilities ──────────────────────────────────────────────────────────

  /** Mirrors member-service `B2BOrgUser.EffectiveStatus`: explicit `invite_status` wins, else `username` present ⇒ accepted, absent ⇒ pending. */
  private effectiveStatus(user: MemberServiceOrgUser): OrgAccessInviteStatus {
    if (user.invite_status) return user.invite_status;
    return user.username ? 'accepted' : 'pending';
  }

  private emailOf(user: MemberServiceOrgUser): string {
    return (user.email ?? '').trim().toLowerCase();
  }

  private deriveInitials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase() || '?';
    return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  }
}
