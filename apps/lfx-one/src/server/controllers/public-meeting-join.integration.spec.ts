// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The controller's shared-utils imports transitively pull in @angular/common/http, which needs the JIT facade in plain Node.
import '@angular/compiler';

import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

import { MEETING_PASSWORD_HEADER } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import express, { NextFunction, Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the transport boundaries are faked: the M2M token fetch, NATS, and the HTTP proxy.
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn().mockResolvedValue('m2m-token') }));

import { apiErrorHandler } from '../middleware/error-handler.middleware';
import publicMeetingsRouter from '../routes/public-meetings.route';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { NatsService } from '../services/nats.service';

const MEETING_ID = 'mtg-1001';
const PASSWORD = 'meeting-pw';
const SUB = 'auth0|user-1';
const LOGIN_EMAIL = 'jane.doe@login-example.example';
const ALIAS_EMAIL = 'Jane.Doe+Meetings@Acme-Motors.example';
const JOIN_URL = 'https://zoom.example.com/j/123';

interface Row {
  meeting_id: string;
  email?: string;
  case_insensitive_email?: string;
  username?: string;
}

interface Scenario {
  rows: Row[];
  preference: 'none' | 'timeout' | string;
  authEmails: { primary_email: string; alternate_emails: { email: string; verified: boolean }[] } | 'fail';
}

let scenario: Scenario;
let natsCalls: { subject: string; payload: any }[];
let joinCalls: { path: string; query: any }[];
let queryCalls: { filters: string[]; filters_or?: string[] }[];

// A case-sensitive exact-term query service: `filters` AND-ed, `filters_or` OR-ed, matched against data.<field>.
function fakeQueryService(params: Record<string, any>): { resources: { data: Row }[] } {
  const term = (clause: string, row: Row): boolean => {
    const idx = clause.indexOf(':');
    return (row as any)[clause.slice(0, idx)] === clause.slice(idx + 1);
  };
  const filters: string[] = params['filters'] ?? [];
  const filtersOr: string[] | undefined = params['filters_or'];
  queryCalls.push({ filters, filters_or: filtersOr });
  const hits = scenario.rows.filter((row) => filters.every((c) => term(c, row)) && (!filtersOr || filtersOr.some((c) => term(c, row))));
  return { resources: hits.map((data) => ({ data })) };
}

const aliasRow = (): Row => ({ meeting_id: MEETING_ID, email: ALIAS_EMAIL, case_insensitive_email: ALIAS_EMAIL.toLowerCase() });

interface SessionOptions {
  sub?: string;
  email?: string;
  username?: string;
  apiGatewayToken?: string;
  impersonation?: { sub: string; email: string; username?: string };
}

let sessionOptions: SessionOptions | null;
let server: Server;
let baseUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const noop = () => undefined;
    const log: any = { debug: noop, info: noop, warn: noop, error: noop, trace: noop, fatal: noop, child: () => log };
    req.log = log;
    req.id = 'test-request';
    const s = sessionOptions;
    if (s) {
      (req as any).oidc = {
        isAuthenticated: () => true,
        user: {
          sub: s.sub ?? SUB,
          email: s.email,
          email_verified: true,
          ...(s.username ? { 'https://sso.linuxfoundation.org/claims/username': s.username } : {}),
        },
      };
      req.apiGatewayToken = s.apiGatewayToken;
      if (s.impersonation) {
        (req as any).appSession = {
          impersonationToken: 'imp-token',
          impersonationExpiresAt: Date.now() + 60_000,
          impersonationUser: s.impersonation,
        };
        req.impersonationActive = true;
      }
    }
    next();
  });
  app.use('/public/api/meetings', publicMeetingsRouter);
  app.use(apiErrorHandler);
  return app;
}

async function postJoin(body: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/public/api/meetings/${MEETING_ID}/join-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [MEETING_PASSWORD_HEADER]: PASSWORD },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const subjectCalls = (subject: string) => natsCalls.filter((c) => c.subject === subject);

describe('POST /public/api/meetings/:id/join-url (restricted meeting, real service stack)', () => {
  beforeAll(async () => {
    server = buildApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    natsCalls = [];
    joinCalls = [];
    queryCalls = [];
    scenario = { rows: [], preference: 'none', authEmails: { primary_email: LOGIN_EMAIL, alternate_emails: [] } };
    sessionOptions = { email: LOGIN_EMAIL, apiGatewayToken: 'v1-gateway-token' };

    vi.spyOn(NatsService.prototype, 'request').mockImplementation(async function (this: NatsService, subject: string, data: Uint8Array) {
      const codec = this.getCodec();
      const payload = JSON.parse(codec.decode(data));
      natsCalls.push({ subject, payload });

      let reply: unknown;
      if (subject === NatsSubjects.MEETING_PREFERRED_EMAIL_GET) {
        if (scenario.preference === 'timeout') throw new Error('TIMEOUT');
        reply = scenario.preference === 'none' ? { email_id: null, email: null } : { email_id: 'pref-1', email: scenario.preference };
      } else if (subject === NatsSubjects.USER_EMAILS_READ) {
        if (scenario.authEmails === 'fail') throw new Error('TIMEOUT');
        reply = { success: true, data: scenario.authEmails };
      } else {
        throw new Error(`unexpected NATS subject ${subject}`);
      }
      return { data: codec.encode(JSON.stringify(reply)) } as any;
    });

    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation((async (
      _req: Request,
      _svc: string,
      path: string,
      _method: string,
      query?: any
    ) => {
      if (path === `/itx/meetings/${MEETING_ID}`) {
        return {
          id: MEETING_ID,
          restricted: true,
          password: PASSWORD,
          start_time: new Date(Date.now() - 3_600_000).toISOString(),
          project_uid: 'proj-1',
          title: 'Board',
        };
      }
      if (path === '/query/resources') {
        return fakeQueryService(query);
      }
      if (path === `/itx/meetings/${MEETING_ID}/join_link`) {
        joinCalls.push({ path, query });
        return { join_url: JOIN_URL };
      }
      throw new Error(`unexpected proxy path ${path}`);
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. joins with the meeting-invite preference alias when the login email and username do not match', async () => {
    scenario.rows = [aliasRow()];
    scenario.preference = ALIAS_EMAIL;

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ link: JOIN_URL });
    expect(joinCalls).toHaveLength(1);
    expect(joinCalls[0].query.email).toBe(ALIAS_EMAIL);
  });

  it('2. joins when the alias is only a verified alternate in auth-service', async () => {
    scenario.rows = [aliasRow()];
    scenario.authEmails = { primary_email: LOGIN_EMAIL, alternate_emails: [{ email: ALIAS_EMAIL, verified: true }] };

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(joinCalls[0].query.email).toBe(ALIAS_EMAIL);
  });

  it('3. rejects when the alias is only an unverified alternate', async () => {
    scenario.rows = [aliasRow()];
    scenario.authEmails = { primary_email: LOGIN_EMAIL, alternate_emails: [{ email: ALIAS_EMAIL, verified: false }] };

    const res = await postJoin();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_REGISTERED_FOR_MEETING');
    expect(joinCalls).toHaveLength(0);
  });

  it('4. rejects an unregistered user when every email source is healthy', async () => {
    scenario.rows = [{ meeting_id: MEETING_ID, email: 'someone.else@example.com', case_insensitive_email: 'someone.else@example.com' }];
    scenario.preference = 'other.alias@example.com';

    const res = await postJoin();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_REGISTERED_FOR_MEETING');
    expect(joinCalls).toHaveLength(0);
  });

  it('5. still joins via a verified alternate when the preference lookup times out', async () => {
    scenario.rows = [aliasRow()];
    scenario.preference = 'timeout';
    scenario.authEmails = { primary_email: LOGIN_EMAIL, alternate_emails: [{ email: ALIAS_EMAIL, verified: true }] };

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(joinCalls[0].query.email).toBe(ALIAS_EMAIL);
  });

  it('5b. answers 503 rather than 403 when auth-service is down and nothing else matched', async () => {
    scenario.rows = [aliasRow()];
    scenario.authEmails = 'fail';

    const res = await postJoin();

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_ADVISORY');
    expect(joinCalls).toHaveLength(0);
  });

  it('5c. joins via the preference even when auth-service is down', async () => {
    scenario.rows = [aliasRow()];
    scenario.preference = ALIAS_EMAIL;
    scenario.authEmails = 'fail';

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(joinCalls[0].query.email).toBe(ALIAS_EMAIL);
  });

  it('5d. matches a registrant stored with mixed casing by the login email directly', async () => {
    scenario.rows = [{ meeting_id: MEETING_ID, email: 'Jane.Doe@Login-Example.example', case_insensitive_email: LOGIN_EMAIL }];

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(joinCalls[0].query.email).toBe('Jane.Doe@Login-Example.example');
    expect(natsCalls).toHaveLength(0);
  });

  it('6. matches a user with a username by username without touching the email sources', async () => {
    sessionOptions = { email: LOGIN_EMAIL, username: 'jdoe', apiGatewayToken: 'v1-gateway-token' };
    scenario.rows = [{ meeting_id: MEETING_ID, username: 'jdoe', email: 'jdoe.invite@example.com', case_insensitive_email: 'jdoe.invite@example.com' }];

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(joinCalls[0].query.email).toBe('jdoe.invite@example.com');
    expect(natsCalls).toHaveLength(0);
  });

  it('7. keeps the validation error for an anonymous caller with no email', async () => {
    sessionOptions = null;

    const res = await postJoin();

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(natsCalls).toHaveLength(0);
    expect(queryCalls).toHaveLength(0);
  });

  it('7b. still matches an anonymous caller by the email they submit', async () => {
    sessionOptions = null;
    scenario.rows = [{ meeting_id: MEETING_ID, email: 'guest@example.com', case_insensitive_email: 'guest@example.com' }];

    const res = await postJoin({ email: 'Guest@Example.com' });

    expect(res.status).toBe(200);
    expect(natsCalls).toHaveLength(0);
  });

  it('8. never reads the impersonator preference while impersonating', async () => {
    sessionOptions = {
      email: 'admin.user@example.com',
      apiGatewayToken: 'impersonator-gateway-token',
      impersonation: { sub: 'auth0|target-1', email: 'target.user@example.com' },
    };
    scenario.rows = [aliasRow()];
    scenario.preference = ALIAS_EMAIL;
    scenario.authEmails = { primary_email: 'target.user@example.com', alternate_emails: [{ email: ALIAS_EMAIL, verified: true }] };

    const res = await postJoin();

    expect(res.status).toBe(200);
    expect(subjectCalls(NatsSubjects.MEETING_PREFERRED_EMAIL_GET)).toHaveLength(0);
    expect(subjectCalls(NatsSubjects.USER_EMAILS_READ)[0].payload.user.auth_token).toBe('auth0|target-1');
  });

  it('8b. answers 403, not 503, for an unregistered impersonation target even though no preference is read', async () => {
    sessionOptions = {
      email: 'admin.user@example.com',
      apiGatewayToken: 'impersonator-gateway-token',
      impersonation: { sub: 'auth0|target-1', email: 'target.user@example.com' },
    };
    scenario.authEmails = { primary_email: 'target.user@example.com', alternate_emails: [] };

    const res = await postJoin();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_REGISTERED_FOR_MEETING');
    expect(subjectCalls(NatsSubjects.MEETING_PREFERRED_EMAIL_GET)).toHaveLength(0);
  });
});
