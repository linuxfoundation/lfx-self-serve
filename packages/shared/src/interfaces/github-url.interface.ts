// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Parsed shape of a user-supplied github.com URL. Shared because BOTH sides
// must agree on what "a repository URL" means: the intake form warns before
// submission when a value will not resolve to a readable repository, and the
// BFF's README fetch resolves the very same value server-side.

/** What a github.com URL points at once parsed. */
export type GithubUrlTargetKind = 'repository' | 'organization';

/** A URL that names one repository — `github.com/<owner>/<repo>` (or any deeper path under it). */
export interface GithubRepositoryTarget {
  kind: 'repository';
  /** Owner (organization or user) path segment, as written. */
  owner: string;
  /** Repository path segment, with any `.git` suffix stripped. */
  repo: string;
}

/**
 * A URL that names only an owner — `github.com/<owner>`. There is no repository
 * README behind it; the closest thing is the owner's profile README
 * (`<owner>/.github` → `profile/README.md`), which may not exist.
 */
export interface GithubOrganizationTarget {
  kind: 'organization';
  /** Owner (organization or user) path segment, as written. */
  owner: string;
}

/** A parsed github.com URL, or `null` from the parser when the URL is neither. */
export type GithubUrlTarget = GithubRepositoryTarget | GithubOrganizationTarget;

/**
 * Why a value failed the repository-URL requirement. An organization URL and
 * an unparsable one are different mistakes with different fixes, so the reason
 * travels with the error and the field says which one happened.
 */
export type GithubRepoUrlErrorReason = 'organization' | 'unrecognized';

/** Payload of the `githubRepoUrl` control error raised by `githubRepoUrlValidator`. */
export interface GithubRepoUrlError {
  /** What the value turned out to be instead of a repository. */
  reason: GithubRepoUrlErrorReason;
}
