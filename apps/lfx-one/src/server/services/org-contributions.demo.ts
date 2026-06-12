// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Demo dataset for the Org Lens → Code Contributions page (LFXV2-1894).
//
// SCAFFOLD: this worktree serves curated demo-company data rather than querying real
// Salesforce / Snowflake. The shapes match the wire interfaces so the follow-up data
// pass can drop in the LFX Insights queries without touching the controller or UI.

import type {
  ContributionSource,
  OrgContributionCommitRow,
  OrgContributionEmployeeOption,
  OrgContributionProjectOption,
  OrgContributionRepoRow,
} from '@lfx-one/shared/interfaces';

/** Upstream base URL per source — demo only; the real data layer derives this from the repo's ingested upstream URL. */
const UPSTREAM_HOSTS: Record<ContributionSource, string> = {
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
  gerrit: 'https://gerrit.onap.org',
  git: 'https://github.com',
};

/** Project logo per slug (CNCF artwork). Demo only; the data pass derives logos from the project catalog. Slugs without an entry fall back to an initials square. */
const PROJECT_LOGOS: Record<string, string> = {
  kubernetes: 'https://raw.githubusercontent.com/cncf/artwork/master/projects/kubernetes/icon/color/kubernetes-icon-color.svg',
  prometheus: 'https://raw.githubusercontent.com/cncf/artwork/master/projects/prometheus/icon/color/prometheus-icon-color.svg',
  envoy: 'https://raw.githubusercontent.com/cncf/artwork/master/projects/envoy/icon/color/envoy-icon-color.svg',
  opentelemetry: 'https://raw.githubusercontent.com/cncf/artwork/master/projects/opentelemetry/icon/color/opentelemetry-icon-color.svg',
  etcd: 'https://raw.githubusercontent.com/cncf/artwork/master/projects/etcd/icon/color/etcd-icon-color.svg',
};

/** Internal demo author — `username` drives commit handles; not on the wire. */
const DEMO_EMPLOYEES = [
  { id: 'emp-ana', displayName: 'Ana Ramirez', username: 'aramirez' },
  { id: 'emp-bjorn', displayName: 'Bjorn Lee', username: 'blee' },
  { id: 'emp-chen', displayName: 'Chen Wei', username: 'cwei' },
  { id: 'emp-dmitri', displayName: 'Dmitri Volkov', username: 'dvolkov' },
  { id: 'emp-elena', displayName: 'Elena Novak', username: 'enovak' },
  { id: 'emp-farid', displayName: 'Farid Khan', username: 'fkhan' },
  { id: 'emp-grace', displayName: 'Grace Okafor', username: 'gokafor' },
  { id: 'emp-hiro', displayName: 'Hiroshi Tanaka', username: 'htanaka' },
] as const;

/** Hierarchical project catalog the demo org has touched — foundations carry `parentSlug: null`. */
export const DEMO_PROJECT_OPTIONS: OrgContributionProjectOption[] = [
  { slug: 'cncf', projectId: 'proj-cncf', name: 'CNCF', commits: 2845, parentSlug: null },
  { slug: 'kubernetes', projectId: 'proj-k8s', name: 'Kubernetes', commits: 1450, parentSlug: 'cncf' },
  { slug: 'prometheus', projectId: 'proj-prom', name: 'Prometheus', commits: 635, parentSlug: 'cncf' },
  { slug: 'envoy', projectId: 'proj-envoy', name: 'Envoy', commits: 320, parentSlug: 'cncf' },
  { slug: 'etcd', projectId: 'proj-etcd', name: 'etcd', commits: 180, parentSlug: 'cncf' },
  { slug: 'opentelemetry', projectId: 'proj-otel', name: 'OpenTelemetry', commits: 260, parentSlug: 'cncf' },
  { slug: 'lfn', projectId: 'proj-lfn', name: 'LF Networking', commits: 115, parentSlug: null },
  { slug: 'onap', projectId: 'proj-onap', name: 'ONAP', commits: 115, parentSlug: 'lfn' },
  { slug: 'gitlab', projectId: 'proj-gitlab', name: 'GitLab', commits: 40, parentSlug: null },
];

/** Internal demo repo — `OrgContributionRepoRow` plus the contributing employee ids (for the Employees filter). */
const DEMO_REPOS_INTERNAL = [
  repo('repo-k8s', 'kubernetes/kubernetes', 'proj-k8s', 'Kubernetes', 'kubernetes', 'github', 1240, '2016-03-01', 28, [
    'emp-ana',
    'emp-chen',
    'emp-hiro',
    'emp-grace',
  ]),
  repo('repo-kubectl', 'kubernetes/kubectl', 'proj-k8s', 'Kubernetes', 'kubernetes', 'github', 210, '2018-07-14', 41, ['emp-ana', 'emp-bjorn']),
  repo('repo-prom', 'prometheus/prometheus', 'proj-prom', 'Prometheus', 'prometheus', 'github', 540, '2015-11-02', 12, ['emp-dmitri', 'emp-elena', 'emp-chen']),
  repo('repo-node-exp', 'prometheus/node_exporter', 'proj-prom', 'Prometheus', 'prometheus', 'github', 95, '2017-01-20', 63, ['emp-dmitri']),
  repo('repo-envoy', 'envoyproxy/envoy', 'proj-envoy', 'Envoy', 'envoy', 'github', 320, '2017-09-12', 9, ['emp-farid', 'emp-grace']),
  repo('repo-etcd', 'etcd-io/etcd', 'proj-etcd', 'etcd', 'etcd', 'github', 180, '2014-06-30', 54, ['emp-chen', 'emp-hiro']),
  repo('repo-otel', 'open-telemetry/opentelemetry-collector', 'proj-otel', 'OpenTelemetry', 'opentelemetry', 'github', 260, '2019-05-08', 4, [
    'emp-elena',
    'emp-bjorn',
    'emp-ana',
  ]),
  repo('repo-gitaly', 'gitlab-org/gitaly', 'proj-gitlab', 'GitLab', 'gitlab', 'gitlab', 40, '2020-02-17', 120, ['emp-dmitri']),
  repo('repo-onap-so', 'onap/so', 'proj-onap', 'ONAP', 'onap', 'gerrit', 75, '2018-11-05', 88, ['emp-farid', 'emp-hiro']),
] as const;

/** Wire-shaped repos (contributor ids stripped). */
export const DEMO_REPOS: OrgContributionRepoRow[] = DEMO_REPOS_INTERNAL.map((r) => ({
  repositoryId: r.repositoryId,
  repositoryPath: r.repositoryPath,
  projectId: r.projectId,
  projectName: r.projectName,
  projectSlug: r.projectSlug,
  projectLogoUrl: r.projectLogoUrl,
  source: r.source,
  upstreamUrl: r.upstreamUrl,
  commits: r.commits,
  firstCommitTs: r.firstCommitTs,
  lastCommitTs: r.lastCommitTs,
}));

/** repositoryId → contributing employee ids, for the Employees filter. */
export const DEMO_REPO_EMPLOYEES: Record<string, readonly string[]> = Object.fromEntries(DEMO_REPOS_INTERNAL.map((r) => [r.repositoryId, r.contributorIds]));

/** Employee id → commit handle, for matching the Employees filter against commit-feed usernames. */
export const DEMO_EMPLOYEE_USERNAMES: Record<string, string> = Object.fromEntries(DEMO_EMPLOYEES.map((e) => [e.id, e.username]));

/** Employee filter options with aggregated commit counts across the demo repos. */
export const DEMO_EMPLOYEE_OPTIONS: OrgContributionEmployeeOption[] = DEMO_EMPLOYEES.map((e) => ({
  id: e.id,
  displayName: e.displayName,
  commits: sumEmployeeCommits(e.id),
})).sort((a, b) => b.commits - a.commits);

/** Org-wide recent-commits activity feed (most recent first) — flat list across all active projects. */
export const DEMO_COMMIT_FEED: OrgContributionCommitRow[] = [
  feedRow('Drake', 'Maria Hernandez', 'Frontend Engineer', 'mhernandez47', 'github', '2026-05-13', 'proc/internal/ebpf: add struct and array tracking'),
  feedRow('Bazel', 'Debra Iyer', 'Senior Software Engineer', 'diyer54', 'github', '2026-05-12', 'libstdc++: Remove trailing whitespace in source'),
  feedRow(
    'Robot Operating System',
    'Priya Jones',
    'Senior Software Engineer',
    'pjones61',
    'github',
    '2026-05-11',
    'Merge pull request #4111 from nrwahl2/nrwahl-docs'
  ),
  feedRow('Kubernetes', 'Advait James', 'Staff Engineer', 'ajames68', 'github', '2026-05-10', "Merge branch 'main' into ui_test_konflux_integration"),
  feedRow('OpenTelemetry', 'Aiden Persson', 'Software Engineer', 'apersson75', 'gerrit', '2026-05-09', 'Updated README Signed-off-by: Masanori Goto'),
  feedRow(
    'The Linux Kernel Organization',
    'Khalid Brooks',
    'Frontend Engineer',
    'kbrooks82',
    'github',
    '2026-05-08',
    'Add working MTA FBC deploy pipeline and tests'
  ),
  feedRow('Upstream MultiPath TCP', 'Jack Kaur', 'Full Stack Engineer', 'jkaur89', 'github', '2026-05-07', 'docs(plans): add python pain points integration'),
  feedRow('Dify', 'Patricia Olsson', 'Product Manager', 'polsson96', 'gerrit', '2026-05-06', 'fix: clone component map and improve registry'),
  feedRow(
    'Pioneer Space Simulator',
    'Brandon Mehta',
    'Infrastructure Engineer',
    'bmehta4',
    'github',
    '2026-05-05',
    'fix: apply registry overrides to component imports'
  ),
  feedRow('Abseil', 'Liam Johansson', 'Data Scientist', 'ljohansson11', 'github', '2026-05-04', 'Speed up matrix multiplies (#24459)'),
  feedRow('Kubernetes', 'Ana Ramirez', 'Staff Engineer', 'aramirez', 'github', '2026-05-03', 'fix: handle nil pointer in reconcile loop'),
  feedRow('Prometheus', 'Dmitri Volkov', 'Software Engineer', 'dvolkov', 'github', '2026-05-02', 'feat: add structured logging to scrape manager'),
  feedRow('Envoy', 'Grace Okafor', 'Senior Software Engineer', 'gokafor', 'github', '2026-05-01', 'perf: reduce allocations in HTTP filter chain'),
  feedRow('etcd', 'Hiroshi Tanaka', 'Staff Engineer', 'htanaka', 'github', '2026-04-30', 'test: cover edge case in lease renewal backoff'),
];

function repo(
  repositoryId: string,
  repositoryPath: string,
  projectId: string,
  projectName: string,
  projectSlug: string,
  source: ContributionSource,
  commits: number,
  firstCommitDate: string,
  lastCommitDaysAgo: number,
  contributorIds: readonly string[]
) {
  const upstreamHost = UPSTREAM_HOSTS[source];
  return {
    repositoryId,
    repositoryPath,
    projectId,
    projectName,
    projectSlug,
    projectLogoUrl: PROJECT_LOGOS[projectSlug] ?? null,
    source,
    upstreamUrl: `${upstreamHost}/${repositoryPath}`,
    commits,
    firstCommitTs: `${firstCommitDate}T00:00:00.000Z`,
    lastCommitTs: daysAgoIso(lastCommitDaysAgo),
    contributorIds,
  };
}

/** ISO timestamp `n` days before now — keeps the demo "Last Commit" dates fresh on every request. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Build one org-wide commit-feed row with a synthetic commit URL keyed off the source. */
function feedRow(
  projectName: string,
  committerName: string,
  committerTitle: string,
  username: string,
  source: ContributionSource,
  date: string,
  message: string
): OrgContributionCommitRow {
  // Deterministic per-row id (stable across requests) so the template's `track commit.commitSha` stays reliable.
  const commitSha = `demo-${username}-${date.replace(/-/g, '')}`;
  return {
    commitSha,
    projectName,
    committerName,
    committerTitle,
    username,
    source,
    committedTs: `${date}T12:00:00.000Z`,
    message,
    // No repo-scoped path in the feed, so a real commit URL can't be built — omit rather than ship a 404 link.
    commitUrl: null,
  };
}

function sumEmployeeCommits(employeeId: string): number {
  return DEMO_REPOS_INTERNAL.filter((r) => r.contributorIds.includes(employeeId)).reduce((acc, r) => acc + Math.round(r.commits / r.contributorIds.length), 0);
}
