// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from '../interfaces/org-lens-time-range.interface';

// Maintainer roles, on LFX Insights' rule (lfx-self-serve#4482): one role per (person, project), counted when it
// overlaps the range, whether or not the person contributed code, credited to the person's current employer.

/** Label for every count of maintainer roles. */
export const ORG_MAINTAINER_ROLES_LABEL = 'Maintainer roles';

/** Label where the count covers LF projects only (Overview Foundations & Projects, Memberships projects drawer). */
export const ORG_LF_MAINTAINER_ROLES_LABEL = 'LF maintainer roles';

/** The counting rule for People → Contributors' tile, which follows the range but not the Employment filter (lfx-self-serve#4627). */
export const ORG_MAINTAINER_ROLES_DEFINITION =
  "Maintainer roles: people named as maintainers in a project's governance files, counted once per project, credited to their current employer, in the selected range. It does not follow the Employment filter.";

/** The counting rule for the Overview card: LF projects, past 365 days. */
export const ORG_OVERVIEW_MAINTAINER_ROLES_DEFINITION =
  "Maintainer roles: people named as maintainers in a project's governance files, counted once per project, credited to their current employer, in LF projects over the past 365 days. The chart shows the roles held in each month.";

/** The counting rule per project on the Overview and in the Memberships projects drawer: LF projects, past 365 days. */
export const ORG_LF_PROJECT_MAINTAINER_ROLES_DEFINITION =
  "Maintainer roles: people named as maintainers in a project's governance files, counted once per project, credited to their current employer, in LF projects over the past 365 days.";

/** The window of the Overview's maintainer counts (card headline, Foundations & Projects, Memberships drawer). */
export const ORG_OVERVIEW_MAINTAINER_ROLES_RANGE: OrgLensTimeRange = '365d';

/** The window the person drawer's Maintainer pill follows when it is opened without a range. */
export const ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE: OrgLensTimeRange = '365d';

/** The window of the Projects page's maintainer lists — past 2 years, the window of its contributors (it has no range picker). */
export const ORG_PROJECTS_MAINTAINER_ROLES_RANGE: OrgLensTimeRange = '730d';

/** The counting rule on Project Detail's Maintainer roles card and drawer, which follow the page toggle. */
export const ORG_PROJECT_MAINTAINER_ROLES_DEFINITION =
  "Maintainer roles: people named as maintainers in this project's governance files, counted once per project, credited to their current employer, in the selected range.";

/** ROLE_START_DATE the warehouse stores when a role's start is unknown; shown as unknown, never as a date. */
export const ORG_MAINTAINER_ROLE_UNKNOWN_START_DATE = '2000-01-01';

/** Display name for a maintainer the warehouse has no name for — never the crowd.dev member id. */
export const ORG_UNKNOWN_MAINTAINER_NAME = 'Unknown maintainer';
