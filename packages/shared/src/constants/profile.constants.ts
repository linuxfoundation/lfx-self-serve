// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Affiliation, ConnectedIdentity, ProfileHeaderData, ProfileProject, ProfileTab } from '../interfaces';

/**
 * Profile tab configuration
 */
export const PROFILE_TABS: ProfileTab[] = [
  { id: 'overview', label: 'Overview', route: 'overview', icon: 'fa-light fa-house' },
  { id: 'badges', label: 'Badges', route: 'badges', icon: 'fa-light fa-award' },
  { id: 'certificates', label: 'Certificates', route: 'certificates', icon: 'fa-light fa-certificate' },
  { id: 'affiliations', label: 'Affiliations', route: 'affiliations', icon: 'fa-light fa-building' },
  { id: 'edit', label: 'Edit Profile', route: 'edit', icon: 'fa-light fa-pencil' },
  { id: 'visibility', label: 'Visibility', route: 'visibility', icon: 'fa-light fa-eye' },
  { id: 'identity-services', label: 'Identity Services', route: 'identity-services', icon: 'fa-light fa-fingerprint' },
  { id: 'password', label: 'Password', route: 'password', icon: 'fa-light fa-lock' },
  { id: 'email', label: 'Email', route: 'email', icon: 'fa-light fa-envelope' },
  { id: 'developer', label: 'Developer', route: 'developer', icon: 'fa-light fa-code' },
];

/**
 * Mock profile header data
 */
export const MOCK_PROFILE_HEADER: ProfileHeaderData = {
  firstName: 'John',
  lastName: 'Doe',
  username: 'johndoe',
  jobTitle: 'Senior Software Engineer',
  organization: 'Linux Foundation',
  city: 'San Francisco',
  stateProvince: 'California',
  country: 'United States',
  avatarUrl: '',
};

/**
 * Mock projects for the Overview tab
 */
export const MOCK_PROJECTS: ProfileProject[] = [
  {
    id: 'proj-1',
    name: 'Kubernetes',
    logo: 'https://landscape.cncf.io/logos/kubernetes.svg',
    role: 'Maintainer',
    roleConfirmed: true,
    organization: 'Google',
    organizationLogo: 'https://www.google.com/favicon.ico',
  },
  {
    id: 'proj-2',
    name: 'Linux Kernel',
    logo: 'https://www.kernel.org/theme/images/logos/favicon.png',
    role: 'Contributor',
    roleConfirmed: true,
    organization: 'Independent',
    organizationLogo: '',
  },
  {
    id: 'proj-3',
    name: 'OpenTelemetry',
    logo: 'https://landscape.cncf.io/logos/open-telemetry.svg',
    role: 'Reviewer',
    roleConfirmed: false,
    organization: 'Microsoft',
    organizationLogo: 'https://www.microsoft.com/favicon.ico',
  },
  {
    id: 'proj-4',
    name: 'Prometheus',
    logo: 'https://landscape.cncf.io/logos/prometheus.svg',
    role: 'Contributor',
    roleConfirmed: true,
    organization: 'Google',
    organizationLogo: 'https://www.google.com/favicon.ico',
  },
];

/**
 * Mock connected identities for the Overview tab
 */
export const MOCK_IDENTITIES: ConnectedIdentity[] = [
  {
    id: 'id-1',
    provider: 'github',
    identifier: 'johndoe',
    verified: true,
    icon: 'fa-brands fa-github',
  },
  {
    id: 'id-2',
    provider: 'linkedin',
    identifier: 'john-doe-engineer',
    verified: true,
    icon: 'fa-brands fa-linkedin',
  },
  {
    id: 'id-3',
    provider: 'gitlab',
    identifier: 'johndoe',
    verified: false,
    icon: 'fa-brands fa-gitlab',
  },
  {
    id: 'id-4',
    provider: 'email',
    identifier: 'john.doe@example.com',
    verified: true,
    icon: 'fa-light fa-envelope',
  },
];

/**
 * Mock skills for the Overview tab
 */
export const MOCK_SKILLS: string[] = ['TypeScript', 'Angular', 'Kubernetes', 'Go', 'Python', 'Docker', 'CI/CD'];

/**
 * Skill taxonomy for autocomplete
 * This would typically come from an API
 */
export const SKILL_TAXONOMY: string[] = [
  // Programming Languages
  'JavaScript',
  'TypeScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C++',
  'C',
  'Ruby',
  'PHP',
  'Swift',
  'Kotlin',
  'Scala',
  'Haskell',
  'Elixir',
  'Erlang',
  // Frontend
  'Angular',
  'React',
  'Vue.js',
  'Svelte',
  'HTML',
  'CSS',
  'Tailwind CSS',
  'SASS',
  'Bootstrap',
  'Material Design',
  'Responsive Design',
  'Web Accessibility',
  'PWA',
  // Backend
  'Node.js',
  'Express.js',
  'NestJS',
  'Django',
  'Flask',
  'FastAPI',
  'Spring Boot',
  'Ruby on Rails',
  'ASP.NET',
  'GraphQL',
  'REST APIs',
  'gRPC',
  // Databases
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Elasticsearch',
  'Cassandra',
  'SQLite',
  'DynamoDB',
  // DevOps & Infrastructure
  'Docker',
  'Kubernetes',
  'Terraform',
  'Ansible',
  'AWS',
  'Azure',
  'GCP',
  'CI/CD',
  'Jenkins',
  'GitHub Actions',
  'GitLab CI',
  'Linux',
  'Networking',
  'Prometheus',
  'Grafana',
  // Data & ML
  'Machine Learning',
  'Deep Learning',
  'TensorFlow',
  'PyTorch',
  'Data Analysis',
  'Data Engineering',
  'Apache Spark',
  'Apache Kafka',
  // Security
  'Security',
  'Cryptography',
  'OAuth',
  'OIDC',
  'Penetration Testing',
  // Other
  'Git',
  'Agile',
  'Scrum',
  'Technical Writing',
  'Code Review',
  'System Design',
  'Microservices',
  'Event-Driven Architecture',
  'WebSockets',
  'Testing',
  'TDD',
  'Performance Optimization',
].sort();

/**
 * Mock affiliations for the Affiliations tab
 */
export const MOCK_AFFILIATIONS: Affiliation[] = [
  {
    id: 'aff-1',
    organization: 'Google',
    organizationLogo: 'https://www.google.com/favicon.ico',
    basis: {
      source: 'Email domain verification',
    },
    scope: 'Global',
    verified: true,
    startDate: 'Jan 2020',
    endDate: undefined,
  },
  {
    id: 'aff-2',
    organization: 'Linux Foundation',
    organizationLogo: 'https://www.linuxfoundation.org/favicon.ico',
    basis: {
      source: 'Git commit analysis',
      contributionCount: 156,
    },
    scope: 'Project',
    verified: true,
    startDate: 'Mar 2019',
    endDate: undefined,
  },
  {
    id: 'aff-3',
    organization: 'Microsoft',
    organizationLogo: 'https://www.microsoft.com/favicon.ico',
    basis: {
      source: 'Git commit analysis',
      contributionCount: 42,
    },
    scope: 'Project',
    verified: false,
    startDate: 'Jun 2021',
    endDate: 'Dec 2022',
  },
  {
    id: 'aff-4',
    organization: 'Red Hat',
    organizationLogo: 'https://www.redhat.com/favicon.ico',
    basis: {
      source: 'Manual entry',
    },
    scope: 'Committee',
    verified: false,
    startDate: 'Sep 2022',
    endDate: undefined,
  },
];
