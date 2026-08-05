// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getPublicProfilesBucketUrl, projectPublicProfile, PublicProfileService, resolvePublicFlag } from './public-profile.service';

const req = {} as unknown as Request;
const BUCKET_ENV = 'PUBLIC_PROFILES_BUCKET_URL';

/** Builds a minimal fetch Response stand-in with the given status and text body. */
function mockResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[BUCKET_ENV];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPublicProfilesBucketUrl', () => {
  it('returns an empty string when the env var is unset (no baked-in default)', () => {
    expect(getPublicProfilesBucketUrl()).toBe('');
  });

  it('reads PUBLIC_PROFILES_BUCKET_URL and trims surrounding whitespace and trailing slashes', () => {
    process.env[BUCKET_ENV] = '  https://profiles-bucket.example.com///  ';
    expect(getPublicProfilesBucketUrl()).toBe('https://profiles-bucket.example.com');
  });
});

describe('resolvePublicFlag', () => {
  it('treats an absent flag as private (fail closed — requires an explicit opt-in)', () => {
    expect(resolvePublicFlag({})).toBe(false);
  });

  it('treats an explicit boolean true as public (PascalCase)', () => {
    expect(resolvePublicFlag({ IsPublic: true })).toBe(true);
  });

  it('treats an explicit boolean true as public (camelCase)', () => {
    expect(resolvePublicFlag({ isPublic: true })).toBe(true);
  });

  it('treats an explicit false as private (PascalCase)', () => {
    expect(resolvePublicFlag({ IsPublic: false })).toBe(false);
  });

  it('treats an explicit false as private (camelCase)', () => {
    expect(resolvePublicFlag({ isPublic: false })).toBe(false);
  });

  it('lets an explicit PascalCase false win over a stray camelCase true (fail closed)', () => {
    expect(resolvePublicFlag({ IsPublic: false, isPublic: true })).toBe(false);
  });

  it('fails closed on the reciprocal conflict (PascalCase true, camelCase false)', () => {
    expect(resolvePublicFlag({ IsPublic: true, isPublic: false })).toBe(false);
  });

  it('fails closed when a present casing is null even if the other is true', () => {
    expect(resolvePublicFlag({ IsPublic: null, isPublic: true })).toBe(false);
  });

  it('treats both casings explicitly true as public', () => {
    expect(resolvePublicFlag({ IsPublic: true, isPublic: true })).toBe(true);
  });

  it('treats a non-boolean flag as private (string "false")', () => {
    expect(resolvePublicFlag({ IsPublic: 'false' })).toBe(false);
  });

  it('treats a non-boolean flag as private (numeric 0)', () => {
    expect(resolvePublicFlag({ IsPublic: 0 })).toBe(false);
  });

  it('treats a non-boolean flag as private (object)', () => {
    expect(resolvePublicFlag({ IsPublic: {} })).toBe(false);
  });
});

describe('projectPublicProfile', () => {
  it('keeps only render-allowlisted fields and drops unrendered PII (fail closed)', () => {
    const raw = {
      IsPublic: true,
      isPublic: true,
      basic: {
        Name: 'Jane',
        Title: 'Engineer',
        Username: 'jane-secret',
        Identities: [{ Username: '  ' }, { Username: 'jane-gh', Avatar: 'https://avatar.example/jane.png' }, { Username: 'jane-twitter' }],
      },
      About: 'Hello',
      technical_contribution: {
        projects: [
          {
            ID: 'proj-1',
            Name: 'Kubernetes',
            Slug: 'k8s',
            commits: 12,
            docs: 3,
            affiliations: [{ Organization: { Name: 'Acme' }, StartDate: '2020', EndDate: '2022' }],
            contributions: [{ date: '2024-01-01', commits: 2 }],
          },
        ],
      },
      certification_activities: [{ ID: 'c1', Name: 'CKA', Status: 'active', Type: 'cert', StartDate: '2024', EndDate: '2025' }],
      training_activities: [{ Name: 'Intro', Status: 'done', Type: 'course' }],
      badges: [{ Image: 'https://img.example/b.png', Url: 'https://b.example' }],
      skills: [{ ID: 's1', Name: 'Go' }],
      presentations: [{ Name: 'Talk', LocationName: '123 Main St, Springfield' }],
    };

    const projected = projectPublicProfile(raw);

    // Allowlisted fields survive.
    expect(projected.isPublic).toBe(true);
    expect(projected.basic).toMatchObject({ Name: 'Jane', Title: 'Engineer', Identities: [{ Username: 'jane-gh' }] });
    expect(projected.About).toBe('Hello');
    expect(projected.technical_contribution?.projects[0]).toEqual({ Name: 'Kubernetes', Slug: 'k8s', commits: 12, deleted: 0, added: 0, prs: 0, issues: 0 });
    expect(projected.certification_activities).toEqual([{ Name: 'CKA', Type: 'cert', StartDate: '2024', EndDate: '2025' }]);
    expect(projected.training_activities).toEqual([{ Name: 'Intro', Type: 'course' }]);
    expect(projected.badges).toEqual([{ Image: 'https://img.example/b.png', Url: 'https://b.example' }]);

    // Unrendered / PII fields never ship — assert on the serialized wire form.
    const wire = JSON.stringify(projected);
    expect(projected).not.toHaveProperty('IsPublic');
    expect(projected).not.toHaveProperty('skills');
    expect(projected).not.toHaveProperty('presentations');
    expect(wire).not.toContain('jane-secret'); // basic.Username
    expect(wire).not.toContain('jane-twitter'); // only the first non-empty identity username projected
    expect(wire).not.toContain('avatar.example'); // Identities[].Avatar
    expect(wire).not.toContain('affiliations');
    expect(wire).not.toContain('contributions');
    expect(wire).not.toContain('Acme'); // employment history
    expect(wire).not.toContain('proj-1'); // project.ID
    expect(wire).not.toContain('"docs"'); // project.docs
    expect(wire).not.toContain('Springfield'); // presentation location
    expect(wire).not.toContain('active'); // certification Status
    expect(wire).not.toContain('"done"'); // training Status
  });

  it('fails closed to isPublic false and omits absent optional sections', () => {
    const projected = projectPublicProfile({ basic: { Name: 'Jane' } });
    expect(projected.isPublic).toBe(false);
    // Round-trip through JSON to drop undefined keys, mirroring the wire payload.
    expect(JSON.parse(JSON.stringify(projected))).toEqual({ isPublic: false, basic: { Name: 'Jane' } });
  });
});

describe('PublicProfileService.getPublicProfile', () => {
  const service = new PublicProfileService();
  const TEST_BUCKET = 'https://test-bucket.example.com';

  beforeEach(() => {
    process.env[BUCKET_ENV] = TEST_BUCKET;
  });

  it('rejects a malformed username without fetching', async () => {
    const result = await service.getPublicProfile(req, '../secrets');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the bucket is not configured, without fetching', async () => {
    delete process.env[BUCKET_ENV];
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the configured bucket URL is malformed, without fetching', async () => {
    process.env[BUCKET_ENV] = 'not a url';
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the bucket URL uses a non-http scheme, without fetching', async () => {
    process.env[BUCKET_ENV] = 'file:///etc';
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the bucket URL has no host, without fetching', async () => {
    // `https://` trims to `https:`; a combined-URL parse would treat the username as the host, so
    // the base itself must be rejected rather than producing an outbound fetch.
    process.env[BUCKET_ENV] = 'https://';
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL-encodes the username into the bucket object key', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: true, basic: { Name: 'Jane' } })));
    await service.getPublicProfile(req, 'jane.doe');
    expect(fetchMock).toHaveBeenCalledWith(`${TEST_BUCKET}/jane.doe.json`, expect.objectContaining({ signal: expect.anything() }));
  });

  it('returns null when the artifact does not exist (404)', async () => {
    fetchMock.mockResolvedValue(mockResponse(404, 'Not Found'));
    expect(await service.getPublicProfile(req, 'ghost')).toBeNull();
  });

  it('returns null when S3 forbids access (403)', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, 'Forbidden'));
    expect(await service.getPublicProfile(req, 'ghost')).toBeNull();
  });

  it('returns the projected profile with isPublic true for a public artifact (raw IsPublic dropped)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: true, basic: { Name: 'Jane Apple' } })));
    const result = await service.getPublicProfile(req, 'jane');
    // The raw `IsPublic` flag is not re-exposed — only the normalized `isPublic` gate ships.
    expect(result).toEqual({ basic: { Name: 'Jane Apple' }, isPublic: true });
    expect(result).not.toHaveProperty('IsPublic');
  });

  it('normalizes isPublic to false for a private artifact and preserves the payload', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: false, basic: { Name: 'Jane' } })));
    const result = await service.getPublicProfile(req, 'jane');
    expect(result?.isPublic).toBe(false);
  });

  it('throws a MicroserviceError on a non-404 upstream failure', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, 'boom'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toBeInstanceOf(MicroserviceError);
  });

  it('throws a MicroserviceError when the body is empty', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '   '));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toBeInstanceOf(MicroserviceError);
  });

  it('throws a MicroserviceError when the body is invalid JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '{not json'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toBeInstanceOf(MicroserviceError);
  });

  it('throws a MicroserviceError when the body parses to null (not a JSON object)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, 'null'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a MicroserviceError when the body parses to a JSON array (not an object)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '[1,2,3]'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a MicroserviceError when the body parses to a JSON primitive (not an object)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '42'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('normalizes an absent flag to isPublic false (fail closed) and preserves the payload', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ basic: { Name: 'Jane' } })));
    const result = await service.getPublicProfile(req, 'jane');
    expect(result?.isPublic).toBe(false);
    expect(result?.basic).toEqual({ Name: 'Jane' });
  });

  it('normalizes a non-boolean flag to isPublic false (fail closed)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: 'false', basic: { Name: 'Jane' } })));
    const result = await service.getPublicProfile(req, 'jane');
    expect(result?.isPublic).toBe(false);
  });

  it('maps a fetch timeout to a 504 MicroserviceError', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    fetchMock.mockRejectedValue(timeout);
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 504 });
  });

  it('maps a network failure to a 502 MicroserviceError', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 502 });
  });
});
