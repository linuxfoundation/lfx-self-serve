// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Parsed shape of a user-supplied github.com URL. Shared because BOTH sides
// must agree on what "a repository URL" means: the intake form warns before
// submission when a value will not resolve to a readable repository, and the
// BFF's README fetch resolves the very same value server-side.

/** What a github.com URL points at once parsed. */
export type GithubUrlTargetKind = 'repository' | 'owner';

/** A URL that names one repository — `github.com/<owner>/<repo>` (or any deeper path under it). */
export interface GithubRepositoryTarget {
  kind: 'repository';
  /** Owner (organization or user) path segment, as written. */
  owner: string;
  /** Repository path segment, with any `.git` suffix stripped. */
  repo: string;
}

/**
 * A URL that names only an account — `github.com/<owner>`. Deliberately NOT
 * called an organization: github.com/<owner> is an organization or a personal
 * user, and the URL alone cannot tell them apart, so anything that says
 * "organization" to the user (or picks an organization-only fallback path)
 * would be guessing. There is no repository README behind it; the closest
 * things are the organization profile README (`<owner>/.github` →
 * `profile/README.md`) and the personal profile README (the `<owner>/<owner>`
 * repository), either of which may not exist.
 */
export interface GithubOwnerTarget {
  kind: 'owner';
  /** Owner (organization or user) path segment, as written. */
  owner: string;
}

/** A parsed github.com URL, or `null` from the parser when the URL is neither. */
export type GithubUrlTarget = GithubRepositoryTarget | GithubOwnerTarget;

/**
 * Why a value failed the repository-URL requirement. An account URL
 * (`github.com/<owner>`) and an unparsable one are different mistakes with
 * different fixes, so the reason travels with the error and the field says
 * which one happened.
 */
export type GithubRepoUrlErrorReason = 'owner' | 'unrecognized';

/** Payload of the `githubRepoUrl` control error raised by `githubRepoUrlValidator`. */
export interface GithubRepoUrlError {
  /** What the value turned out to be instead of a repository. */
  reason: GithubRepoUrlErrorReason;
}
