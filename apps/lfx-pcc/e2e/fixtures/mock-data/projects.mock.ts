// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Project } from '@lfx-pcc/shared/interfaces';

/**
 * Mock project data for Playwright tests
 * Organized by project slug for easy lookup
 */
export const mockProjects: Record<string, Project> = {
  aswf: {
    uid: 'a09f1234-f567-4abc-b890-1234567890ab',
    slug: 'aswf',
    name: 'Academy Software Foundation (ASWF)',
    description:
      "The mission of the Academy Software Foundation (ASWF) is to increase the quality and quantity of contributions to the content creation industry's open source software base; to provide a neutral forum to coordinate cross-project efforts; to provide a common build and test infrastructure; and to provide individuals and organizations a clear path to participation in advancing our open source ecosystem.",
    public: true,
    parent_uid: '',
    stage: 'graduated',
    category: 'foundation',
    funding_model: ['member-funded'],
    charter_url: 'https://github.com/AcademySoftwareFoundation/tac/blob/main/charter.md',
    legal_entity_type: 'directed-fund',
    legal_entity_name: 'Academy Software Foundation',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '2018-08-10T00:00:00Z',
    logo_url: 'https://artwork.aswf.io/projects/aswf/horizontal/color/aswf-horizontal-color.png',
    repository_url: 'https://github.com/AcademySoftwareFoundation',
    website_url: 'https://www.aswf.io/',
    created_at: '2018-08-10T00:00:00Z',
    updated_at: new Date().toISOString(),
    committees_count: 5,
    meetings_count: 23,
    mailing_list_count: 8,
    writer: true,
  },
  cncf: {
    uid: 'b09f1234-f567-4abc-b890-1234567890bc',
    slug: 'cncf',
    name: 'Cloud Native Computing Foundation',
    description:
      "The Cloud Native Computing Foundation (CNCF) hosts critical components of the global technology infrastructure. CNCF brings together the world's top developers, end users, and vendors and runs the largest open source developer conferences.",
    public: true,
    parent_uid: '',
    stage: 'graduated',
    category: 'foundation',
    funding_model: ['member-funded'],
    charter_url: 'https://github.com/cncf/foundation/blob/master/charter.md',
    legal_entity_type: 'directed-fund',
    legal_entity_name: 'Cloud Native Computing Foundation',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '2015-12-11T00:00:00Z',
    logo_url: 'https://landscape.cncf.io/logos/cncf-color.svg',
    repository_url: 'https://github.com/cncf',
    website_url: 'https://www.cncf.io/',
    created_at: '2015-12-11T00:00:00Z',
    updated_at: new Date().toISOString(),
    committees_count: 12,
    meetings_count: 156,
    mailing_list_count: 25,
    writer: false,
  },
  kubernetes: {
    uid: 'c09f1234-f567-4abc-b890-1234567890cd',
    slug: 'kubernetes',
    name: 'Kubernetes',
    description: 'Kubernetes is an open-source system for automating deployment, scaling, and management of containerized applications.',
    public: true,
    parent_uid: 'b09f1234-f567-4abc-b890-1234567890bc', // CNCF parent
    stage: 'graduated',
    category: 'project',
    funding_model: ['foundation-funded'],
    charter_url: 'https://github.com/kubernetes/community/blob/master/governance.md',
    legal_entity_type: 'project',
    legal_entity_name: 'Kubernetes',
    legal_parent_uid: 'b09f1234-f567-4abc-b890-1234567890bc',
    autojoin_enabled: true,
    formation_date: '2014-06-07T00:00:00Z',
    logo_url: 'https://kubernetes.io/images/kubernetes-horizontal-color.png',
    repository_url: 'https://github.com/kubernetes/kubernetes',
    website_url: 'https://kubernetes.io/',
    created_at: '2014-06-07T00:00:00Z',
    updated_at: new Date().toISOString(),
    committees_count: 8,
    meetings_count: 89,
    mailing_list_count: 15,
    writer: false,
  },
};

/**
 * Get mock project by slug
 * @param slug - Project slug to look up
 * @returns Project object or undefined if not found
 */
export function getMockProject(slug: string): Project | undefined {
  return mockProjects[slug];
}

/**
 * Get all mock projects as an array
 * @returns Array of all mock projects
 */
export function getAllMockProjects(): Project[] {
  return Object.values(mockProjects);
}

/**
 * Search mock projects by name or description
 * @param query - Search query string
 * @returns Array of matching projects
 */
export function searchMockProjects(query: string): Project[] {
  const searchTerm = query.toLowerCase();
  return getAllMockProjects().filter(
    (project) =>
      project.name.toLowerCase().includes(searchTerm) ||
      project.description.toLowerCase().includes(searchTerm) ||
      project.slug.toLowerCase().includes(searchTerm)
  );
}
