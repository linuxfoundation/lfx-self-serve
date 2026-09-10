// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipEnrollForm,
  MentorshipEnrollStep,
  MentorshipLfProject,
  MentorshipLfProjectsResponse,
  MentorshipPrerequisite,
  MentorshipProgramTerm,
} from '../interfaces/mentorship.interface';
import { mentorshipArtworkIconUrl } from './mentorship.constants';
import { toLocalDateOnlyString } from '../utils/date-time.utils';

export const MENTORSHIP_ENROLL_STEPS_ORDER: MentorshipEnrollStep[] = ['details', 'setup', 'prerequisites'];

export const MENTORSHIP_ENROLL_STEP_LABELS: Record<MentorshipEnrollStep, string> = {
  details: 'Program Details',
  setup: 'Program Setup',
  prerequisites: 'Prerequisites',
};

export const MENTORSHIP_ENROLL_NAME_MIN = 3;
export const MENTORSHIP_ENROLL_NAME_MAX = 100;
export const MENTORSHIP_ENROLL_DESCRIPTION_MAX = 3000;
export const MENTORSHIP_TERM_NAME_MAX = 50;
export const MENTORSHIP_MAX_OPEN_TERMS = 4;
export const MENTORSHIP_CUSTOM_PREREQ_NAME_MAX = 20;
export const MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX = 500;
export const MENTORSHIP_CUSTOM_PREREQ_FILE_LABEL = 'Check if completion of this task requires that the mentee submits a file.';
export const MENTORSHIP_LF_PROJECT_PAGE_SIZE = 10;

/** Year choices for the term dialog — last year through 10 years ahead. */
export const MENTORSHIP_TERM_YEAR_OPTIONS: ReadonlyArray<{ label: string; value: string }> = Array.from({ length: 12 }, (_, index) => {
  const year = (new Date().getFullYear() - 1 + index).toString();
  return { label: year, value: year };
});

export const MENTORSHIP_ENROLL_LOGO_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png';
/** SVG excluded (XSS risk), matching `ALLOWED_AVATAR_MIME_TYPES`. */
export const MENTORSHIP_ENROLL_LOGO_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const;
export const MENTORSHIP_ENROLL_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const MENTORSHIP_ENROLL_LOGO_HELPER = 'JPG, PNG · 420px × 420px · Max 2 MB';
export const MENTORSHIP_ENROLL_LOGO_TYPE_ERROR = 'Program logo is not the right file type.';

export const MENTORSHIP_ENROLL_DETAILS_INTRO = 'Describe the program and the project it belongs to. This is what candidates read on your program page.';
export const MENTORSHIP_ENROLL_SETUP_INTRO = 'Define the skills mentees need and the term schedule for this program.';
export const MENTORSHIP_ENROLL_SETUP_SKILLS_HELPER =
  'What skills or interest areas are you looking for in prospective mentees? Remember to include non-technical areas that your program could benefit from.';
export const MENTORSHIP_ENROLL_SETUP_MENTOR_INFO = 'Mentor invitation has been moved to the Mentors tab and will be available after your program is approved.';
export const MENTORSHIP_MENTOR_DOCS_URL = 'https://docs.linuxfoundation.org/lfx/mentorship/administrators/manage-mentors';
export const MENTORSHIP_ENROLL_SETUP_TERMS_HELPER =
  'The mentorship program is available for specific periods throughout the year - you may also define a custom term.';
export const MENTORSHIP_ENROLL_PREREQ_INTRO =
  'In order for candidates to qualify for your mentorship program, they will have to complete the following prerequisites. Please select the applicable prerequisites and provide clear and complete instructions, including external links where relevant.';
export const MENTORSHIP_ENROLL_TERMS_INTRO =
  'Before you submit your mentorship program to LFX Platform, please review and accept the terms and conditions below.';
export const MENTORSHIP_ENROLL_REPO_HELPER =
  "This URL will be used to display the repository statistics on your LFX mentorship page, as well as to provide a link to the program's repository.";
export const MENTORSHIP_ENROLL_WEBSITE_HELPER = 'This URL will be available as a link on your LFX mentorship page.';
export const MENTORSHIP_ENROLL_COC_INTRO =
  'Like security, diversity and inclusion are our top priorities. We ask that all projects have a published Code of Conduct (CoC) to identify the standard behavior expected of their community — and to protect those involved. If your project does not already have a CoC, you can use our template to quickly create one. If you do not enter a link to your own CoC, your project listing on Mentorship will default to the Contributor Covenant. Note that you can update your project at any time should you wish to change the link to your own CoC.';
export const MENTORSHIP_ENROLL_FORM_INCOMPLETE = 'Something on the form is not complete or invalid. Please correct the highlighted fields before continuing.';
export const MENTORSHIP_ENROLL_CANCEL_CONFIRM = 'You will lose your changes—are you sure you wish to cancel?';
export const MENTORSHIP_ENROLL_DELETE_TERM_CONFIRM = 'Are you sure you want to delete this term?';
export const MENTORSHIP_ENROLL_NAME_TAKEN = 'This program name is taken.';
export const MENTORSHIP_ENROLL_NAME_CHECKING = 'Checking program name...';
export const MENTORSHIP_ENROLL_NAME_UNAVAILABLE = 'Could not verify the program name. Please try again.';
export const MENTORSHIP_INVALID_URL = 'The link must be a valid URL.';
export const MENTORSHIP_CHALLENGE_URL_REQUIRED = 'The link is required.';
export const MENTORSHIP_MAX_OPEN_TERMS_MESSAGE = 'You can have at most 4 open terms per Mentorship Program. Close or delete one to create another.';
export const MENTORSHIP_COVER_LETTER_PROMPTS: readonly string[] = [
  'How did you find out about our mentorship program?',
  'Why are you interested in this program?',
  'What experience and knowledge/skills do you have that are applicable to this program?',
  'What do you hope to get out of this mentorship experience?',
];

export const MENTORSHIP_CII_HOST = 'https://www.bestpractices.dev';
export const MENTORSHIP_CII_APPLY_URL = `${MENTORSHIP_CII_HOST}/`;
export const MENTORSHIP_CII_BADGE_JSON_BASE = `${MENTORSHIP_CII_HOST}/projects`;
export const MENTORSHIP_CII_INTRO =
  'Security is our top priority on Mentorship, and we ask all participating projects to participate in our Core Infrastructure Initiative (CII) Best Practices badge program. If your project is not already participating in the CII Best Practices badge program, please enroll within 90 days to ensure continuation of your project on the platform.';
export const MENTORSHIP_CII_INVALID_ID = 'Invalid CII Project ID';
export const MENTORSHIP_CII_CHECKING = 'Checking CII Project ID...';
export const MENTORSHIP_CII_UNAVAILABLE = 'CII Best Practices is temporarily unavailable. Please try again.';
export const MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL = 'https://www.contributor-covenant.org/';

export function mentorshipCiiProjectUrl(projectId: string): string {
  return `${MENTORSHIP_CII_HOST}/projects/${projectId}`;
}

export function mentorshipCiiBadgeImageUrl(projectId: string): string {
  return `${MENTORSHIP_CII_HOST}/projects/${projectId}/badge`;
}

export function mentorshipCiiBadgeJsonUrl(projectId: string): string {
  return `${MENTORSHIP_CII_BADGE_JSON_BASE}/${projectId}/badge.json`;
}

export const MENTORSHIP_POLICY_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'LFX Platform Use Agreement', href: 'https://www.linuxfoundation.org/legal/platform-use-agreement' },
  { label: 'Service-Specific Use Terms', href: 'https://www.linuxfoundation.org/legal/service-specific-terms' },
  { label: 'Acceptable Use Policy', href: 'https://www.linuxfoundation.org/legal/acceptable-use' },
  { label: 'Privacy Policy', href: 'https://www.linuxfoundation.org/privacy' },
];

export const MOCK_MENTORSHIP_LF_PROJECTS: readonly MentorshipLfProject[] = [
  { id: 'proj-gridflow', name: 'GridFlow', logoUrl: mentorshipArtworkIconUrl('lf-energy', 'grid-exchange-fabric') },
  { id: 'proj-apicurio', name: 'Apicurio Registry', logoUrl: mentorshipArtworkIconUrl('cncf', 'apicurio-registry') },
  { id: 'proj-janusgraph', name: 'JanusGraph', logoUrl: mentorshipArtworkIconUrl('lfai', 'janusgraph') },
  { id: 'proj-thanos', name: 'Thanos', logoUrl: mentorshipArtworkIconUrl('cncf', 'thanos') },
  { id: 'proj-k8s', name: 'Kubernetes', logoUrl: mentorshipArtworkIconUrl('cncf', 'kubernetes') },
  { id: 'proj-prometheus', name: 'Prometheus', logoUrl: mentorshipArtworkIconUrl('cncf', 'prometheus') },
  { id: 'proj-envoy', name: 'Envoy', logoUrl: mentorshipArtworkIconUrl('cncf', 'envoy') },
  { id: 'proj-istio', name: 'Istio', logoUrl: mentorshipArtworkIconUrl('cncf', 'istio') },
  { id: 'proj-helm', name: 'Helm', logoUrl: mentorshipArtworkIconUrl('cncf', 'helm') },
  { id: 'proj-containerd', name: 'containerd', logoUrl: mentorshipArtworkIconUrl('cncf', 'containerd') },
  { id: 'proj-fluentd', name: 'Fluentd', logoUrl: mentorshipArtworkIconUrl('cncf', 'fluentd') },
  { id: 'proj-linkerd', name: 'Linkerd', logoUrl: mentorshipArtworkIconUrl('cncf', 'linkerd') },
  { id: 'proj-opa', name: 'Open Policy Agent', logoUrl: mentorshipArtworkIconUrl('cncf', 'open-policy-agent', 'opa') },
  { id: 'proj-spiffe', name: 'SPIFFE', logoUrl: mentorshipArtworkIconUrl('cncf', 'spiffe') },
  { id: 'proj-argo', name: 'Argo', logoUrl: mentorshipArtworkIconUrl('cncf', 'argo') },
  { id: 'proj-coredns', name: 'CoreDNS', logoUrl: mentorshipArtworkIconUrl('cncf', 'coredns') },
  { id: 'proj-etcd', name: 'etcd', logoUrl: mentorshipArtworkIconUrl('cncf', 'etcd') },
  { id: 'proj-crio', name: 'CRI-O', logoUrl: mentorshipArtworkIconUrl('cncf', 'crio') },
  { id: 'proj-tikv', name: 'TiKV', logoUrl: mentorshipArtworkIconUrl('cncf', 'tikv') },
  { id: 'proj-rook', name: 'Rook', logoUrl: mentorshipArtworkIconUrl('cncf', 'rook') },
];

export const EMPTY_MENTORSHIP_LF_PROJECTS_RESPONSE: MentorshipLfProjectsResponse = { data: [], total: 0 };

/** @deprecated Prefer `MOCK_MENTORSHIP_LF_PROJECTS` — kept so existing enroll/BFF mappings keep working. */
export const MENTORSHIP_PROJECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = MOCK_MENTORSHIP_LF_PROJECTS.map((project) => ({
  value: project.id,
  label: project.name,
}));

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

/**
 * A term whose application window and start month stay valid on `today` and on a
 * UTC host one civil day ahead. Application start is tomorrow so an untouched
 * default is never "already past" on the BFF.
 */
export function createDefaultMentorshipTerm(today = new Date()): MentorshipProgramTerm {
  const start = new Date(today.getFullYear(), today.getMonth() + 3, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 5, 1);
  const applicationEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  const applicationStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const year = start.getFullYear();
  return {
    id: `term-1-${year}`,
    name: `Term 1 - ${year}`,
    startDate: toLocalDateOnlyString(start),
    endDate: toLocalDateOnlyString(end),
    applicationStartDate: toLocalDateOnlyString(applicationStart),
    applicationEndDate: toLocalDateOnlyString(applicationEnd),
  };
}

export const MENTORSHIP_DEFAULT_PREREQUISITES: MentorshipPrerequisite[] = [
  {
    id: 'prereq-resume',
    name: 'Resume',
    description: 'Upload the most recent version of your resume.',
    required: false,
    requireFile: true,
  },
  {
    id: 'prereq-cover',
    name: 'Cover Letter',
    description: 'A letter to the program covering the following topics:',
    required: false,
    requireFile: true,
  },
  {
    id: 'prereq-school',
    name: 'School Enrollment Verification',
    description: 'Students must upload proof of enrollment (college transcript, or copy student ID, or admissions offer if graduating from high school).',
    required: false,
    requireFile: false,
  },
  {
    id: 'prereq-permission',
    name: 'Participation permission from school or employer',
    description: 'By submitting this task, I certify that I have permission from my school or employer to participate in this mentorship program.',
    required: false,
    requireFile: false,
  },
  {
    id: 'prereq-coding',
    name: 'Coding Challenge',
    description: 'Complete a code challenge',
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
    terms: [createDefaultMentorshipTerm()],
    prerequisites: clonePrerequisites(),
    termsAccepted: false,
  };
}

// An imported template carries no logo bytes, so it must not carry a logo file name either —
// the admin picks the logo, and `logoFileName` is what the details step validates against.
type ImportedProgramSource = Omit<MentorshipEnrollForm, 'importProgramId' | 'termsAccepted' | 'logoFileName' | 'logoPreviewUrl' | 'terms'>;

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
    skills: ['GO', 'Kubernetes'],
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
    skills: ['GO', 'React', 'API'],
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
    skills: ['Java', 'Database'],
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
    skills: ['GO', 'Kubernetes'],
    prerequisites: clonePrerequisites().map((item) => ({ ...item, required: item.id === 'prereq-resume' })),
  },
};

/** True when the program has mock enrollment details that the import picker can copy. */
export function isMentorshipProgramImportable(programId: string): boolean {
  return Object.hasOwn(MENTORSHIP_IMPORT_PROGRAM_DETAILS, programId);
}

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
    logoFileName: '',
    logoPreviewUrl: '',
    skills: [...source.skills],
    terms: [createDefaultMentorshipTerm()],
    prerequisites: clonePrerequisites(source.prerequisites),
    termsAccepted: false,
  };
}

export function mentorshipPolicyHref(label: string): string {
  return MENTORSHIP_POLICY_LINKS.find((link) => link.label === label)?.href ?? '#';
}
