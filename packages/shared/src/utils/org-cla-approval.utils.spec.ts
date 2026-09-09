// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_CLA_APPROVAL_CRITERIA } from '../constants/cla.constants';
import type { OrgClaApprovalCriteriaKind, OrgClaApprovalEntry } from '../interfaces/cla.interface';
import { orgClaApprovalCriteriaLabel, orgClaApprovalEntryMatches, sortOrgClaApprovalEntries, validateOrgClaApprovalValue } from './org-cla-approval.utils';

function entry(kind: OrgClaApprovalCriteriaKind, value: string): OrgClaApprovalEntry {
  return { kind, value };
}

// These validators are ports of the producer's, so the tests are written against the producer's
// rules — including the ones that look like bugs. A test that asserted the *sensible* behaviour
// would pass here and still lose a CLA manager's whole request to a 400 from upstream.
describe('validateOrgClaApprovalValue', () => {
  it('accepts a value for every criteria type, so no list is unusable', () => {
    const acceptable: Record<OrgClaApprovalCriteriaKind, string> = {
      domain: 'example.com',
      email: 'contributor@example.com',
      'github-org': 'example-org',
      'github-username': 'octocat',
      'gitlab-group': 'https://gitlab.com/example-group',
      'gitlab-username': 'example-user',
    };

    for (const option of ORG_CLA_APPROVAL_CRITERIA) {
      expect(validateOrgClaApprovalValue(option.kind, acceptable[option.kind]), option.kind).toBeNull();
    }
  });

  it('accepts every placeholder the picker offers, so the shown example is never itself invalid', () => {
    for (const option of ORG_CLA_APPROVAL_CRITERIA) {
      expect(validateOrgClaApprovalValue(option.kind, option.placeholder), option.kind).toBeNull();
    }
  });

  it('rejects blank and whitespace-only values for every criteria type', () => {
    for (const option of ORG_CLA_APPROVAL_CRITERIA) {
      expect(validateOrgClaApprovalValue(option.kind, ''), option.kind).not.toBeNull();
      expect(validateOrgClaApprovalValue(option.kind, '   '), option.kind).not.toBeNull();
    }
  });

  it('trims before validating, so a pasted value with a trailing space is not a distinct rule', () => {
    expect(validateOrgClaApprovalValue('email', '  contributor@example.com  ')).toBeNull();
    expect(validateOrgClaApprovalValue('domain', ' example.com ')).toBeNull();
  });

  describe('domain', () => {
    it('accepts a wildcard, which is how an organization approves every subdomain at once', () => {
      expect(validateOrgClaApprovalValue('domain', '*.example.com')).toBeNull();
    });

    it('rejects a trailing period, naming the missing top-level domain', () => {
      expect(validateOrgClaApprovalValue('domain', 'example.com.')).toContain('missing top level domain');
    });

    it('rejects a label that begins or ends with a hyphen', () => {
      expect(validateOrgClaApprovalValue('domain', '-example.com')).toContain('begins with a hyphen');
      expect(validateOrgClaApprovalValue('domain', 'example-.com')).toContain('ends with a hyphen');
    });

    // The rule that catches a mistyped IP address or a port pasted along with the host.
    it('rejects a top-level domain that begins with a digit', () => {
      expect(validateOrgClaApprovalValue('domain', '192.168.0.1')).toContain('begins with a digit');
    });

    it('rejects a character no hostname can carry, naming its offset', () => {
      expect(validateOrgClaApprovalValue('domain', 'exa mple.com')).toContain("invalid character ' ' at offset 3");
    });

    it('rejects a label longer than 63 bytes', () => {
      expect(validateOrgClaApprovalValue('domain', `${'a'.repeat(64)}.com`)).toContain("can't exceed 63");
    });

    it('rejects a domain longer than 255 bytes before looking at its labels', () => {
      expect(validateOrgClaApprovalValue('domain', `${'a'.repeat(300)}.com`)).toContain("can't exceed 255");
    });

    // An email in the domain field is the likeliest paste mistake, and `@` is not a hostname
    // character — so the offset in the message points at it.
    it('rejects an email address pasted into the domain field', () => {
      expect(validateOrgClaApprovalValue('domain', 'contributor@example.com')).toContain("invalid character '@'");
    });
  });

  describe('email', () => {
    it('rejects a value with no domain part', () => {
      expect(validateOrgClaApprovalValue('email', 'contributor')).toContain('invalid approval list email');
    });

    it('rejects a bare domain, which belongs in the domain list instead', () => {
      expect(validateOrgClaApprovalValue('email', 'example.com')).not.toBeNull();
    });

    it('accepts the plus-addressing and dots a real mailbox may carry', () => {
      expect(validateOrgClaApprovalValue('email', 'first.last+cla@example.co.uk')).toBeNull();
    });
  });

  describe('handles', () => {
    // Not an arbitrary minimum: the producer rejects `<= 2` characters on all four handle-shaped
    // kinds, so a two-character GitHub username that exists in reality is still refused upstream.
    it('rejects a handle shorter than three characters on every handle-shaped kind', () => {
      expect(validateOrgClaApprovalValue('github-username', 'ab')).toContain('3 or more characters');
      expect(validateOrgClaApprovalValue('github-org', 'ab')).toContain('3 or more characters');
      expect(validateOrgClaApprovalValue('gitlab-username', 'ab')).toContain('3 or more characters');
      expect(validateOrgClaApprovalValue('gitlab-group', 'ab')).toContain('3 or more characters');
    });

    it('rejects a full profile url pasted in place of a username', () => {
      expect(validateOrgClaApprovalValue('github-username', 'https://github.com/octocat')).toContain('invalid GitHub username');
    });

    it('names the field that was wrong, so a six-row form can point at one row', () => {
      expect(validateOrgClaApprovalValue('github-org', 'bad org')).toContain('GitHub organization');
      expect(validateOrgClaApprovalValue('gitlab-username', 'bad user')).toContain('Gitlab username');
    });
  });

  describe('gitlab group', () => {
    // The odd one out: upstream wants a gitlab.com URL here, not a handle, which is why the
    // picker's placeholder for this kind is a URL while the other five are bare values.
    it('accepts the url with the scheme, without it, and with www', () => {
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://gitlab.com/example-group')).toBeNull();
      expect(validateOrgClaApprovalValue('gitlab-group', 'gitlab.com/example-group')).toBeNull();
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://www.gitlab.com/example-group')).toBeNull();
    });

    it('rejects a bare group name, which upstream would answer 400 for', () => {
      expect(validateOrgClaApprovalValue('gitlab-group', 'example-group')).toContain('invalid Gitlab organization');
    });

    it('rejects a url on another host', () => {
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://github.com/example-group')).not.toBeNull();
    });

    // The optional subdomain group was rewritten to remove backtracking, so these pin the language
    // it accepts: three characters or more, starting and ending on a word character, hyphens and
    // underscores in between.
    it('accepts a subdomain in front of gitlab.com', () => {
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://sub.gitlab.com/example-group')).toBeNull();
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://my-sub.gitlab.com/example-group')).toBeNull();
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://a_b.gitlab.com/example-group')).toBeNull();
    });

    it('rejects a subdomain that is too short or edged with a hyphen', () => {
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://ab.gitlab.com/example-group')).not.toBeNull();
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://-ab.gitlab.com/example-group')).not.toBeNull();
      expect(validateOrgClaApprovalValue('gitlab-group', 'https://ab-.gitlab.com/example-group')).not.toBeNull();
    });

    // A CLA manager supplies this value, so the cost of rejecting one has to stay flat in its
    // length. The pattern this was ported from is fine in Go, whose engine does not backtrack;
    // spelled the same way in JavaScript it took ~25s to reject 4,000 characters. The bound is
    // deliberately loose — it is here to catch the quadratic shape coming back, not to time it.
    it('rejects a long non-matching value promptly rather than backtracking over it', () => {
      const hostile = `a${'0'.repeat(20_000)}!`;

      const startedAt = performance.now();
      expect(validateOrgClaApprovalValue('gitlab-group', hostile)).not.toBeNull();

      expect(performance.now() - startedAt).toBeLessThan(1000);
    });
  });
});

describe('sortOrgClaApprovalEntries', () => {
  it('groups by criteria type in picker order, so a domain rule sits beside its siblings', () => {
    const sorted = sortOrgClaApprovalEntries([
      entry('gitlab-username', 'zoe'),
      entry('email', 'contributor@example.com'),
      entry('domain', 'example.com'),
      entry('github-username', 'octocat'),
    ]);

    expect(sorted.map((item) => item.kind)).toEqual(['domain', 'email', 'github-username', 'gitlab-username']);
  });

  it('orders values numerically within a type, so user2 precedes user10', () => {
    const sorted = sortOrgClaApprovalEntries([entry('github-username', 'user10'), entry('github-username', 'user2')]);

    expect(sorted.map((item) => item.value)).toEqual(['user2', 'user10']);
  });

  it('ignores case when ordering, so two spellings of one name do not split the list', () => {
    const sorted = sortOrgClaApprovalEntries([entry('domain', 'beta.com'), entry('domain', 'Alpha.com')]);

    expect(sorted.map((item) => item.value)).toEqual(['Alpha.com', 'beta.com']);
  });

  // Upstream returns six arrays in whatever order Dynamo held them. Sorting a copy is what keeps
  // two loads of an unchanged list from rendering in two different orders.
  it('leaves the given array untouched', () => {
    const entries = [entry('email', 'b@example.com'), entry('domain', 'example.com')];

    sortOrgClaApprovalEntries(entries);

    expect(entries.map((item) => item.kind)).toEqual(['email', 'domain']);
  });
});

describe('orgClaApprovalEntryMatches', () => {
  it('matches on the value, case-insensitively', () => {
    expect(orgClaApprovalEntryMatches(entry('domain', 'Example.com'), 'example')).toBe(true);
  });

  it('matches on the criteria label, which is a column the term is visibly compared against', () => {
    expect(orgClaApprovalEntryMatches(entry('github-org', 'example-org'), 'GitHub org')).toBe(true);
  });

  it('admits everything for an empty or whitespace-only term', () => {
    expect(orgClaApprovalEntryMatches(entry('domain', 'example.com'), '')).toBe(true);
    expect(orgClaApprovalEntryMatches(entry('domain', 'example.com'), '  ')).toBe(true);
  });

  it('excludes an entry that matches neither column', () => {
    expect(orgClaApprovalEntryMatches(entry('domain', 'example.com'), 'acme')).toBe(false);
  });

  // Deliberate: a term like `2026` matching a date the user was not looking at reads as a broken
  // filter, so the added-on column is not searchable.
  it('does not match on the added-on date', () => {
    expect(orgClaApprovalEntryMatches({ kind: 'domain', value: 'example.com', addedOn: '2026-03-04T00:00:00Z' }, '2026')).toBe(false);
  });
});

describe('orgClaApprovalCriteriaLabel', () => {
  it('has a label for every criteria type, so no row renders a blank type', () => {
    for (const option of ORG_CLA_APPROVAL_CRITERIA) {
      expect(orgClaApprovalCriteriaLabel(option.kind), option.kind).toBe(option.label);
    }
  });
});
