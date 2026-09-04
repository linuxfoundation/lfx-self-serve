// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipEnrollForm, MentorshipEnrollStep, MentorshipPrerequisite, MentorshipProgramTerm } from '../interfaces/mentorship.interface';

export const MENTORSHIP_ENROLL_STEPS_ORDER: MentorshipEnrollStep[] = ['details', 'setup', 'prerequisites'];

export const MENTORSHIP_ENROLL_STEP_LABELS: Record<MentorshipEnrollStep, string> = {
  details: 'Program Details',
  setup: 'Program Setup',
  prerequisites: 'Prerequisites',
};

export const MENTORSHIP_ENROLL_NAME_MAX = 100;
export const MENTORSHIP_ENROLL_DESCRIPTION_MAX = 3000;
export const MENTORSHIP_TERM_NAME_MAX = 50;
export const MENTORSHIP_CUSTOM_PREREQ_NAME_MAX = 20;
export const MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX = 500;
export const MENTORSHIP_CUSTOM_PREREQ_FILE_LABEL = 'Check if completion of this task requires that the mentee submits a file.';

/** Year choices for the term dialog — last year through 10 years ahead. */
export const MENTORSHIP_TERM_YEAR_OPTIONS: ReadonlyArray<{ label: string; value: string }> = Array.from({ length: 12 }, (_, index) => {
  const year = (new Date().getFullYear() + index).toString();
  return { label: year, value: year };
});

export const MENTORSHIP_ENROLL_LOGO_ACCEPT = '.jpg,.jpeg,.png,.svg,image/jpeg,image/png,image/svg+xml';
export const MENTORSHIP_ENROLL_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const MENTORSHIP_ENROLL_LOGO_HELPER = 'JPG, PNG, SVG · 420px × 420px · Max 2 MB';

export const MENTORSHIP_ENROLL_DETAILS_INTRO = 'Describe the program and the project it belongs to. This is what candidates read on your program page.';
export const MENTORSHIP_ENROLL_SETUP_INTRO = 'Define the skills mentees need and the term schedule for this program.';
export const MENTORSHIP_ENROLL_SETUP_SKILLS_HELPER = 'List skills that help match the right mentees. You can invite mentors after enrollment is approved.';
export const MENTORSHIP_ENROLL_SETUP_MENTOR_INFO = 'After your program is approved, you can invite mentors from the program dashboard.';
export const MENTORSHIP_ENROLL_SETUP_TERMS_HELPER = 'Add the mentorship terms you plan to run. Applicants apply to a specific term.';
export const MENTORSHIP_ENROLL_PREREQ_INTRO = 'Select which application materials are required. You can add custom prerequisites if needed.';
export const MENTORSHIP_ENROLL_TERMS_INTRO = 'Before you submit your program enrollment to the LFX Platform, review and accept the terms and conditions below.';

export const MENTORSHIP_CII_APPLY_URL = 'https://bestpractices.coreinfrastructure.org/';
export const MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL = 'https://www.contributor-covenant.org/';

export const MENTORSHIP_POLICY_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'LFX Platform Use Agreement', href: 'https://www.linuxfoundation.org/legal/platform-use-agreement' },
  { label: 'Service-Specific Use Terms', href: 'https://www.linuxfoundation.org/legal/service-specific-terms' },
  { label: 'Acceptable Use Policy', href: 'https://www.linuxfoundation.org/legal/acceptable-use' },
  { label: 'Privacy Policy', href: 'https://www.linuxfoundation.org/privacy' },
];

export const MENTORSHIP_PROJECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'proj-gridflow', label: 'GridFlow' },
  { value: 'proj-apicurio', label: 'Apicurio Registry' },
  { value: 'proj-janusgraph', label: 'JanusGraph' },
  { value: 'proj-thanos', label: 'Thanos' },
  { value: 'proj-k8s', label: 'Kubernetes' },
];

/**
 * Canonical skill / technology catalog used by the enroll wizard.
 * Ported from menv3 `app/config/skills.ts`.
 */
export const MENTORSHIP_SKILL_OPTIONS: readonly string[] = [
  '3D',
  'Ajax',
  'Algorithm',
  'Amp',
  'Android',
  'Angular',
  'Ansible',
  'API',
  'Arduino',
  'ASP.NET',
  'Atom',
  'Awesome Lists',
  'Amazon Web Services',
  'Azure',
  'Babel',
  'Bash',
  'Bitcoin',
  'Blockchain',
  'Bootstrap',
  'Bot',
  'C',
  'Chrome',
  'Chrome extension',
  'Command line interface',
  'Clojure',
  'Code quality',
  'Code review',
  'Compiler',
  'Continuous integration',
  'C++',
  'Cryptocurrency',
  'Crystal',
  'C#',
  'CSS',
  'Data structures',
  'Data visualization',
  'Database',
  'Deep learning',
  'Dependency management',
  'Deployment',
  'Design',
  'Django',
  'Docker',
  'Documentation',
  '.NET',
  'Electron',
  'Elixir',
  'Emacs',
  'Ember',
  'Emoji',
  'Emulator',
  'ES6',
  'ESLint',
  'Ethereum',
  'Express',
  'Firebase',
  'Firefox',
  'Flask',
  'Font',
  'Framework',
  'Front end',
  'Game engine',
  'Git',
  'GitHub API',
  'GO',
  'Google',
  'Gradle',
  'GraphQL',
  'Gulp',
  'Haskell',
  'Homebrew',
  'Homebridge',
  'HTML',
  'HTTP',
  'Icon font',
  'iOS',
  'IPFS',
  'Java',
  'JavaScript',
  'Jekyll',
  'jQuery',
  'JSON',
  'The Julia Language',
  'Jupyter Notebook',
  'Koa',
  'Kotlin',
  'Kubernetes',
  'Laravel',
  'LaTeX',
  'Library',
  'Linux',
  'Localization',
  'Lua',
  'Machine Learning',
  'macOS',
  'Markdown',
  'Mastodon',
  'Material design',
  'MATLAB',
  'Maven',
  'Minecraft',
  'Mobile',
  'Monero',
  'MongoDB',
  'Mongoose',
  'Monitoring',
  'MvvmCross',
  'MySQL',
  'NativeScript',
  'Nim',
  'Natural language processing',
  'Node.js',
  'NoSQL',
  'npm',
  'Objective-C',
  'OpenGL',
  'Operating system',
  'P2P',
  'Package manager',
  'Language parsing',
  'Perl',
  'Perl 6',
  'Phaser',
  'PHP',
  'PICO-8',
  'Pixel Art',
  'PostgreSQL',
  'Project management',
  'Publishing',
  'PWA',
  'Python',
  'Qt',
  'R',
  'Rails',
  'Raspberry Pi',
  'Ratchet',
  'React',
  'React Native',
  'ReactiveUI',
  'Redux',
  'REST API',
  'Ruby',
  'Rust',
  'Sass',
  'Scala',
  'scikit-learn',
  'Software-defined networking',
  'Security',
  'Server',
  'Serverless',
  'Shell',
  'SpaceVim',
  'Spring Boot',
  'SQL',
  'Storybook',
  'Support',
  'Swift',
  'Symfony',
  'Telegram',
  'Tensorflow',
  'Terminal',
  'Terraform',
  'Testing',
  'Twitter',
  'TypeScript',
  'Ubuntu',
  'Unity',
  'Unreal Engine',
  'Vagrant',
  'Vim',
  'Virtual reality',
  'Vue.js',
  'Wagtail',
  'Web Components',
  'Web app',
  'Webpack',
  'Windows',
  'WordPlate',
  'WordPress',
  'Xamarin',
  'XML',
];

export const MENTORSHIP_DEFAULT_TERM: MentorshipProgramTerm = {
  id: 'term-3-2026',
  name: 'Term 3 - 2026',
  startDate: '2026-09-01',
  endDate: '2026-11-01',
  applicationStartDate: '2026-06-01',
  applicationEndDate: '2026-08-31',
};

export const MENTORSHIP_DEFAULT_PREREQUISITES: MentorshipPrerequisite[] = [
  {
    id: 'prereq-resume',
    name: 'Resume',
    description: 'Upload a current resume or CV.',
    required: false,
    requireFile: true,
  },
  {
    id: 'prereq-cover',
    name: 'Cover Letter',
    description: 'Explain why you want to join this program.',
    required: false,
    requireFile: true,
  },
  {
    id: 'prereq-school',
    name: 'School Enrollment Verification',
    description: 'Proof of current school enrollment, if applicable.',
    required: false,
    requireFile: false,
  },
  {
    id: 'prereq-permission',
    name: 'Participation permission from school or employer',
    description: 'Written permission if required by your institution.',
    required: false,
    requireFile: false,
  },
  {
    id: 'prereq-coding',
    name: 'Coding Challenge',
    description: 'Link to the coding challenge applicants should complete.',
    required: false,
    challengeUrl: '',
  },
];

export function createEmptyCustomMentorshipPrerequisite(): MentorshipPrerequisite {
  return {
    id: `prereq-custom-${Date.now()}`,
    name: '',
    description: '',
    required: true,
    custom: true,
    dueDate: '',
    requireFile: false,
  };
}

function clonePrerequisites(items: MentorshipPrerequisite[] = MENTORSHIP_DEFAULT_PREREQUISITES): MentorshipPrerequisite[] {
  return items.map((item) => ({ ...item }));
}

export function createEmptyMentorshipEnrollForm(): MentorshipEnrollForm {
  return {
    importProgramId: '',
    name: '',
    projectId: '',
    technologies: [],
    description: '',
    repositoryUrl: '',
    websiteUrl: '',
    ciiProjectId: '',
    codeOfConductUrl: '',
    logoFileName: '',
    logoPreviewUrl: '',
    skills: [],
    terms: [{ ...MENTORSHIP_DEFAULT_TERM }],
    prerequisites: clonePrerequisites(),
    termsAccepted: false,
  };
}

type ImportedProgramSource = Omit<MentorshipEnrollForm, 'importProgramId' | 'termsAccepted' | 'logoPreviewUrl'>;

const MENTORSHIP_IMPORT_PROGRAM_DETAILS: Record<string, ImportedProgramSource> = {
  mp_gridflow_fall26: {
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectId: 'proj-gridflow',
    technologies: ['GO', 'Kubernetes', 'GraphQL'],
    description: '<p>Build a time-series ingestion pipeline for grid telemetry, including storage, alerting, and contributor onboarding.</p>',
    repositoryUrl: 'https://github.com/lfenergy/gridflow',
    websiteUrl: 'https://lfenergy.org',
    ciiProjectId: '1842',
    codeOfConductUrl: 'https://www.contributor-covenant.org/version/2/1/code_of_conduct/',
    logoFileName: 'gridflow-logo.png',
    skills: ['GO', 'Kubernetes'],
    terms: [{ ...MENTORSHIP_DEFAULT_TERM, name: 'Term 3 - 2026' }],
    prerequisites: clonePrerequisites().map((item, index) => ({ ...item, required: index === 0 })),
  },
  mp_apicurio_winter26: {
    name: 'Apicurio Registry: Prompt Template Playground',
    projectId: 'proj-apicurio',
    technologies: ['GO', 'React', 'API'],
    description: '<p>Improve the Apicurio Registry prompt-template playground for schema discovery, authoring, and contributor workflows.</p>',
    repositoryUrl: 'https://github.com/Apicurio/apicurio-registry',
    websiteUrl: 'https://www.apicur.io/',
    ciiProjectId: '2104',
    codeOfConductUrl: 'https://github.com/Apicurio/apicurio-registry/blob/main/CODE_OF_CONDUCT.md',
    logoFileName: 'apicurio-logo.png',
    skills: ['GO', 'React', 'API'],
    terms: [{ ...MENTORSHIP_DEFAULT_TERM, name: 'Term 3 - 2026' }],
    prerequisites: clonePrerequisites().map((item) => ({
      ...item,
      required: item.id === 'prereq-resume' || item.id === 'prereq-cover',
    })),
  },
  mp_janusgraph_fall26: {
    name: 'JanusGraph: Adjacency Cache Instrumentation',
    projectId: 'proj-janusgraph',
    technologies: ['Java', 'GraphQL', 'Database'],
    description: '<p>Instrument JanusGraph adjacency-cache hits so contributors can profile traversal cost.</p>',
    repositoryUrl: 'https://github.com/JanusGraph/janusgraph',
    websiteUrl: 'https://janusgraph.org',
    ciiProjectId: '',
    codeOfConductUrl: '',
    logoFileName: '',
    skills: ['Java', 'Database'],
    terms: [{ ...MENTORSHIP_DEFAULT_TERM }],
    prerequisites: clonePrerequisites(),
  },
  mp_thanos_summer26: {
    name: 'Thanos: Fan-Out Query Observability',
    projectId: 'proj-thanos',
    technologies: ['GO', 'Kubernetes', 'Monitoring'],
    description: '<p>Improve observability for Thanos fan-out queries across store gateways.</p>',
    repositoryUrl: 'https://github.com/thanos-io/thanos',
    websiteUrl: 'https://thanos.io',
    ciiProjectId: '',
    codeOfConductUrl: '',
    logoFileName: '',
    skills: ['GO', 'Kubernetes'],
    terms: [
      {
        ...MENTORSHIP_DEFAULT_TERM,
        name: 'Term 2 - 2026',
        startDate: '2026-04-01',
        endDate: '2026-06-01',
        applicationStartDate: '2026-01-15',
        applicationEndDate: '2026-03-15',
      },
    ],
    prerequisites: clonePrerequisites().map((item) => ({ ...item, required: item.id === 'prereq-resume' })),
  },
};

export function formFromImportedMentorshipProgram(importProgramId: string): MentorshipEnrollForm {
  if (!importProgramId) {
    return createEmptyMentorshipEnrollForm();
  }

  const source = MENTORSHIP_IMPORT_PROGRAM_DETAILS[importProgramId];
  if (!source) {
    return { ...createEmptyMentorshipEnrollForm(), importProgramId };
  }

  return {
    importProgramId,
    name: source.name,
    projectId: source.projectId,
    technologies: [...source.technologies],
    description: source.description,
    repositoryUrl: source.repositoryUrl,
    websiteUrl: source.websiteUrl,
    ciiProjectId: source.ciiProjectId,
    codeOfConductUrl: source.codeOfConductUrl,
    logoFileName: source.logoFileName,
    logoPreviewUrl: '',
    skills: [...source.skills],
    terms: source.terms.map((term) => ({ ...term })),
    prerequisites: clonePrerequisites(source.prerequisites),
    termsAccepted: false,
  };
}

export function mentorshipPolicyHref(label: string): string {
  return MENTORSHIP_POLICY_LINKS.find((link) => link.label === label)?.href ?? '#';
}
