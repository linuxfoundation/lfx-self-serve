// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';
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
      certification_activities: [{ ID: 'c1', Name: 'CKA', Status: 'Completed', Type: 'cert', StartDate: '2024', EndDate: '2025' }],
      training_activities: [{ Name: 'Intro', Status: 'Enrolled', Type: 'E-Learning' }],
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
    expect(projected.training_activities).toEqual([{ Name: 'Intro', Type: 'E-Learning' }]);
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
    expect(wire).not.toContain('Status'); // neither certification nor training Status is projected
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

// The projection helpers are module-private, so they're exercised through the exported
// `projectPublicProfile` seam — mirroring myprofile's training/certification computed filters.
describe('projectPublicProfile — training_activities allow-list projection', () => {
  it('keeps only allow-listed training Types, dropping exam/subscription/bundle rows', () => {
    const projected = projectPublicProfile({
      training_activities: [
        { Name: 'A', Type: 'E-Learning', Status: 'Completed' },
        { Name: 'B', Type: 'Instructor-Led', Status: 'Enrolled' },
        { Name: 'C', Type: 'edX', Status: 'Started' },
        { Name: 'D', Type: 'Certification Exam', Status: 'Completed' },
        { Name: 'E', Type: 'Subscription', Status: 'Completed' },
        { Name: 'F', Type: 'Bundle', Status: 'Completed' },
      ],
    });

    expect(projected.training_activities?.map((t) => t.Name)).toEqual(['A', 'B', 'C']);
  });

  it('keeps only allow-listed enrollment Statuses, dropping cancelled/unknown/absent-status rows', () => {
    const projected = projectPublicProfile({
      training_activities: [
        { Name: 'Enrolled row', Type: 'E-Learning', Status: 'Enrolled' },
        { Name: 'Completed row', Type: 'E-Learning', Status: 'Completed' },
        { Name: 'Started row', Type: 'E-Learning', Status: 'Started' },
        { Name: 'Not started row', Type: 'E-Learning', Status: 'Not started' },
        { Name: 'Cancelled row', Type: 'E-Learning', Status: 'Cancelled' },
        { Name: 'Unknown status row', Type: 'E-Learning', Status: 'In Progress' },
        { Name: 'No status row', Type: 'E-Learning' },
      ],
    });

    expect(projected.training_activities?.map((t) => t.Name)).toEqual(['Completed row', 'Enrolled row', 'Not started row', 'Started row']);
  });

  it('blanks epoch-placeholder dates to empty string and passes real dates through', () => {
    const projected = projectPublicProfile({
      training_activities: [{ Name: 'A', Type: 'E-Learning', Status: 'Completed', StartDate: '1970-01-01T00:00:00Z', EndDate: '2025-03-04T00:00:00Z' }],
    });

    expect(projected.training_activities?.[0]).toEqual({ Name: 'A', Type: 'E-Learning', StartDate: '', EndDate: '2025-03-04T00:00:00Z' });
  });

  it('leaves absent dates undefined rather than blanking them', () => {
    const projected = projectPublicProfile({
      training_activities: [{ Name: 'A', Type: 'E-Learning', Status: 'Completed' }],
    });

    expect(projected.training_activities?.[0].StartDate).toBeUndefined();
    expect(projected.training_activities?.[0].EndDate).toBeUndefined();
  });

  it('sorts the kept trainings by Name ascending', () => {
    const projected = projectPublicProfile({
      training_activities: [
        { Name: 'Zeta', Type: 'E-Learning', Status: 'Completed' },
        { Name: 'Alpha', Type: 'Instructor-Led', Status: 'Enrolled' },
        { Name: 'Mango', Type: 'edX', Status: 'Started' },
      ],
    });

    expect(projected.training_activities?.map((t) => t.Name)).toEqual(['Alpha', 'Mango', 'Zeta']);
  });

  it('returns undefined when training_activities is missing or not an array', () => {
    expect(projectPublicProfile({}).training_activities).toBeUndefined();
    expect(projectPublicProfile({ training_activities: null }).training_activities).toBeUndefined();
    expect(projectPublicProfile({ training_activities: 'nope' }).training_activities).toBeUndefined();
    expect(projectPublicProfile({ training_activities: { Name: 'A' } }).training_activities).toBeUndefined();
  });

  it('emits a drift debug signal counting rows dropped for an unrecognized Type despite an allow-listed Status', () => {
    projectPublicProfile(
      {
        training_activities: [
          { Name: 'Kept', Type: 'E-Learning', Status: 'Completed' },
          { Name: 'Renamed type', Type: 'eLearning', Status: 'Completed' },
          { Name: 'Another renamed type', Type: 'Self-Paced', Status: 'Enrolled' },
          { Name: 'Dropped for status, not type', Type: 'Bundle', Status: 'Cancelled' },
        ],
      },
      req
    );

    expect(logger.warning).toHaveBeenCalledWith(req, 'project_public_profile', expect.stringContaining('unrecognized Type'), { dropped_for_unknown_type: 2 });
  });

  it('does not emit the drift signal when every dropped row also fails the Status allow-list', () => {
    projectPublicProfile(
      {
        training_activities: [
          { Name: 'Kept', Type: 'E-Learning', Status: 'Completed' },
          { Name: 'Bad type and status', Type: 'Bundle', Status: 'Cancelled' },
        ],
      },
      req
    );

    expect(logger.warning).not.toHaveBeenCalled();
  });

  it('scrubs only a leading epoch year, leaving a value that merely contains 1970 intact (startsWith, not includes)', () => {
    const projected = projectPublicProfile({
      training_activities: [{ Name: 'A', Type: 'E-Learning', Status: 'Completed', StartDate: '11970000000', EndDate: '1970-01-01T00:00:00Z' }],
    });

    // StartDate contains "1970" but does not start with it — kept; EndDate is a leading epoch placeholder — blanked.
    expect(projected.training_activities?.[0]).toEqual({ Name: 'A', Type: 'E-Learning', StartDate: '11970000000', EndDate: '' });
  });
});

describe('projectPublicProfile — certification_activities allow-list projection', () => {
  it('keeps only Completed certifications, dropping other/absent statuses', () => {
    const projected = projectPublicProfile({
      certification_activities: [
        { Name: 'Completed cert', Status: 'Completed', StartDate: '2025-01-02T00:00:00Z' },
        { Name: 'In progress cert', Status: 'In Progress', StartDate: '2025-01-02T00:00:00Z' },
        { Name: 'Enrolled cert', Status: 'Enrolled', StartDate: '2025-01-02T00:00:00Z' },
        { Name: 'No status cert', StartDate: '2025-01-02T00:00:00Z' },
      ],
    });

    expect(projected.certification_activities?.map((c) => c.Name)).toEqual(['Completed cert']);
  });

  it('drops completed certifications whose StartDate is the epoch placeholder or absent', () => {
    const projected = projectPublicProfile({
      certification_activities: [
        { Name: 'Real date', Status: 'Completed', StartDate: '2025-01-02T00:00:00Z' },
        { Name: 'Epoch date', Status: 'Completed', StartDate: '1970-01-01T00:00:00Z' },
        { Name: 'No date', Status: 'Completed' },
      ],
    });

    expect(projected.certification_activities?.map((c) => c.Name)).toEqual(['Real date']);
  });

  it('projects the render-only fields and never the raw Status', () => {
    const projected = projectPublicProfile({
      certification_activities: [
        { Name: 'Kubernetes', Type: 'Certification', Status: 'Completed', StartDate: '2025-01-02T00:00:00Z', EndDate: '2028-01-02T00:00:00Z' },
      ],
    });

    expect(projected.certification_activities?.[0]).toEqual({
      Name: 'Kubernetes',
      Type: 'Certification',
      StartDate: '2025-01-02T00:00:00Z',
      EndDate: '2028-01-02T00:00:00Z',
    });
    expect(projected.certification_activities?.[0]).not.toHaveProperty('Status');
  });

  it('sorts the kept certifications by Name ascending (matching the trainings rail)', () => {
    const projected = projectPublicProfile({
      certification_activities: [
        { Name: 'Zeta', Status: 'Completed', StartDate: '2025-01-02T00:00:00Z' },
        { Name: 'Alpha', Status: 'Completed', StartDate: '2025-01-02T00:00:00Z' },
        { Name: 'Mango', Status: 'Completed', StartDate: '2025-01-02T00:00:00Z' },
      ],
    });

    expect(projected.certification_activities?.map((c) => c.Name)).toEqual(['Alpha', 'Mango', 'Zeta']);
  });

  it('keeps a StartDate that merely contains 1970 but does not start with it (startsWith, not includes)', () => {
    const projected = projectPublicProfile({
      certification_activities: [{ Name: 'Contains 1970', Status: 'Completed', StartDate: '11970000000' }],
    });

    expect(projected.certification_activities?.map((c) => c.Name)).toEqual(['Contains 1970']);
  });

  it('returns undefined when certification_activities is missing or not an array', () => {
    expect(projectPublicProfile({}).certification_activities).toBeUndefined();
    expect(projectPublicProfile({ certification_activities: null }).certification_activities).toBeUndefined();
    expect(projectPublicProfile({ certification_activities: 'nope' }).certification_activities).toBeUndefined();
    expect(projectPublicProfile({ certification_activities: { Name: 'A' } }).certification_activities).toBeUndefined();
  });
});
