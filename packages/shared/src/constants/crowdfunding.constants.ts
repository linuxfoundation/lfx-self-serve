// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FundType } from '../enums/crowdfunding.enum';
import type {
  AllowedLogoMimeType,
  CrowdfundingInitiativesStats,
  CrowdfundingTransaction,
  CrowdfundingTransactionList,
  DonationStats,
  FundDistributionItem,
  InitiativesResponse,
  MyDonationsResponse,
  RecurringDonation,
  RecurringDonationsResponse,
  SponsorshipDonationMode,
  SponsorshipTier,
  SponsorshipTierName,
  TopicOption,
} from '../interfaces/crowdfunding.interface';

export const CROWDFUNDING_FUND_TYPE_LABELS: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'General Fund',
  [FundType.PROJECT]: 'Project',
  [FundType.SECURITY_AUDIT]: 'Security Audit',
  [FundType.MENTORSHIP]: 'Mentorship',
  [FundType.EVENT]: 'Event',
};

export const CROWDFUNDING_FUND_TYPE_ICONS: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'fa-light fa-piggy-bank',
  [FundType.PROJECT]: 'fa-light fa-diagram-project',
  [FundType.SECURITY_AUDIT]: 'fa-light fa-shield-halved',
  [FundType.MENTORSHIP]: 'fa-light fa-user-group',
  [FundType.EVENT]: 'fa-light fa-calendar',
};

export const CROWDFUNDING_FUND_TYPE_COLOR_CLASSES: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'text-violet-600',
  [FundType.PROJECT]: 'text-indigo-600',
  [FundType.SECURITY_AUDIT]: 'text-amber-600',
  [FundType.MENTORSHIP]: 'text-emerald-600',
  [FundType.EVENT]: 'text-blue-600',
};

export const CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'rounded-xl bg-violet-100 !text-violet-700',
  [FundType.PROJECT]: 'rounded-xl bg-indigo-100 !text-indigo-700',
  [FundType.SECURITY_AUDIT]: 'rounded-xl bg-amber-100 !text-amber-700',
  [FundType.MENTORSHIP]: 'rounded-xl bg-emerald-100 !text-emerald-700',
  [FundType.EVENT]: 'rounded-xl bg-blue-100 !text-blue-700',
};

export const CROWDFUNDING_DONOR_AVATAR_PALETTE: string[] = [
  'bg-blue-100 !text-blue-700',
  'bg-violet-100 !text-violet-700',
  'bg-emerald-100 !text-emerald-700',
  'bg-amber-100 !text-amber-700',
];

export const DEFAULT_CROWDFUNDING_PAGE_SIZE = 10;

// Stripe Elements style — hex values required (Stripe does not accept Tailwind classes).
export const STRIPE_ELEMENT_STYLE = {
  base: {
    color: '#0F172A',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '14px',
    lineHeight: '20px',
    '::placeholder': { color: '#94A3B8' },
  },
  invalid: { color: '#EF4444' },
};
export const EMPTY_INITIATIVES_RESPONSE: InitiativesResponse = {
  data: [],
  total: 0,
  pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE,
  offset: 0,
};
export const EMPTY_CROWDFUNDING_STATS: CrowdfundingInitiativesStats = {
  activeCount: 0,
  totalRaised: 0,
  monthlyGain: 0,
  totalSponsors: 0,
};

export const EMPTY_TRANSACTION_LIST: CrowdfundingTransactionList = { data: [], totalCount: 0, from: 0, size: 0 };
export const EMPTY_TRANSACTION_STATE: { items: CrowdfundingTransaction[]; totalCount: number } = {
  items: [],
  totalCount: 0,
};
export const EMPTY_MY_DONATIONS: MyDonationsResponse = {
  data: [],
  total: 0,
  pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE,
  offset: 0,
};
export const EMPTY_RECURRING_DONATIONS: RecurringDonationsResponse = {
  data: [],
  total: 0,
  pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE,
  offset: 0,
};
export const EMPTY_RECURRING_DONATION_LIST: RecurringDonation[] = [];
export const EMPTY_DONATION_STATS: DonationStats = {
  totalDonated: 0,
  initiativesSupported: 0,
  activeRecurringAmount: 0,
  activeRecurringCount: 0,
};

export const ALLOWED_LOGO_MIME_TYPES: AllowedLogoMimeType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

// Runtime-checkable tuple of every valid initiative status value — used for server-side input validation.
export const CROWDFUNDING_INITIATIVE_STATUSES = ['submitted', 'pending', 'published', 'declined', 'hidden'] as const;

// Runtime-checkable tuple of every valid sponsorship tier name — used for server-side input validation.
export const SPONSORSHIP_TIER_NAMES = ['platinum', 'gold', 'silver', 'bronze'] as const;

// Runtime-checkable tuple of every valid donation mode — used for server-side input validation.
// Matches the upstream crowdfunding service's donation_mode enum ('tiers', not 'tier').
export const SPONSORSHIP_DONATION_MODES = ['tiers', 'open'] as const;

export const SPONSORSHIP_DONATION_MODE_OPTIONS: { label: string; value: SponsorshipDonationMode }[] = [
  { label: 'Sponsorship Tiers', value: 'tiers' },
  { label: 'Open Donation', value: 'open' },
];

export const DEFAULT_FUND_DISTRIBUTION: FundDistributionItem[] = [
  {
    category: 'development',
    label: 'Development',
    description: 'Pay your top developers, and bring in new talent to add features and fix bugs.',
    enabled: false,
    percentage: 0,
  },
  {
    category: 'marketing',
    label: 'Marketing',
    description: 'Promote and grow your project through collateral, website redesign, or event swag.',
    enabled: false,
    percentage: 0,
  },
  {
    category: 'meetups',
    label: 'Meetups',
    description: 'Connect with your community through local meetups or industry events.',
    enabled: false,
    percentage: 0,
  },
  {
    category: 'bug_bounty',
    label: 'Bug Bounty',
    description: 'Have your community help identify bugs and get rewarded.',
    enabled: false,
    percentage: 0,
  },
  {
    category: 'travel',
    label: 'Travel',
    description: 'Send project members to conferences, meetups, or customer meetings.',
    enabled: false,
    percentage: 0,
  },
  {
    category: 'documentation',
    label: 'Documentation',
    description: 'Drive specific documentation initiatives within your project.',
    enabled: false,
    percentage: 0,
  },
];

export const SPONSORSHIP_TIER_LABELS: Record<SponsorshipTierName, string> = {
  platinum: 'Platinum',
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
};

export const DEFAULT_SPONSORSHIP_TIERS: SponsorshipTier[] = [
  { name: 'platinum', enabled: false, benefits: [] },
  { name: 'gold', enabled: false, benefits: [] },
  { name: 'silver', enabled: false, benefits: [] },
  { name: 'bronze', enabled: false, benefits: [] },
];

export const CROWDFUNDING_TOPIC_OPTIONS: TopicOption[] = [
  { value: '3D', label: '3D' },
  { value: 'Ajax', label: 'Ajax' },
  { value: 'Algorithm', label: 'Algorithm' },
  { value: 'Amp', label: 'Amp' },
  { value: 'Android', label: 'Android' },
  { value: 'Angular', label: 'Angular' },
  { value: 'Ansible', label: 'Ansible' },
  { value: 'API', label: 'API' },
  { value: 'Arduino', label: 'Arduino' },
  { value: 'ASP.NET', label: 'ASP.NET' },
  { value: 'Atom', label: 'Atom' },
  { value: 'Awesome Lists', label: 'Awesome Lists' },
  { value: 'Amazon Web Services', label: 'Amazon Web Services' },
  { value: 'Azure', label: 'Azure' },
  { value: 'Babel', label: 'Babel' },
  { value: 'Bash', label: 'Bash' },
  { value: 'Bitcoin', label: 'Bitcoin' },
  { value: 'Blockchain', label: 'Blockchain' },
  { value: 'Bootstrap', label: 'Bootstrap' },
  { value: 'Bot', label: 'Bot' },
  { value: 'C', label: 'C' },
  { value: 'Chrome', label: 'Chrome' },
  { value: 'Chrome extension', label: 'Chrome extension' },
  { value: 'Command line interface', label: 'Command line interface' },
  { value: 'Clojure', label: 'Clojure' },
  { value: 'Code quality', label: 'Code quality' },
  { value: 'Code review', label: 'Code review' },
  { value: 'Compiler', label: 'Compiler' },
  { value: 'Continuous integration', label: 'Continuous integration' },
  { value: 'C++', label: 'C++' },
  { value: 'Cryptocurrency', label: 'Cryptocurrency' },
  { value: 'Crystal', label: 'Crystal' },
  { value: 'C#', label: 'C#' },
  { value: 'CSS', label: 'CSS' },
  { value: 'Data structures', label: 'Data structures' },
  { value: 'Data visualization', label: 'Data visualization' },
  { value: 'Database', label: 'Database' },
  { value: 'Deep learning', label: 'Deep learning' },
  { value: 'Dependency management', label: 'Dependency management' },
  { value: 'Deployment', label: 'Deployment' },
  { value: 'Design', label: 'Design' },
  { value: 'Django', label: 'Django' },
  { value: 'Docker', label: 'Docker' },
  { value: 'Documentation', label: 'Documentation' },
  { value: '.NET', label: '.NET' },
  { value: 'Electron', label: 'Electron' },
  { value: 'Elixir', label: 'Elixir' },
  { value: 'Emacs', label: 'Emacs' },
  { value: 'Ember', label: 'Ember' },
  { value: 'Emoji', label: 'Emoji' },
  { value: 'Emulator', label: 'Emulator' },
  { value: 'ES6', label: 'ES6' },
  { value: 'ESLint', label: 'ESLint' },
  { value: 'Ethereum', label: 'Ethereum' },
  { value: 'Express', label: 'Express' },
  { value: 'Firebase', label: 'Firebase' },
  { value: 'Firefox', label: 'Firefox' },
  { value: 'Flask', label: 'Flask' },
  { value: 'Font', label: 'Font' },
  { value: 'Framework', label: 'Framework' },
  { value: 'Front end', label: 'Front end' },
  { value: 'Game engine', label: 'Game engine' },
  { value: 'Git', label: 'Git' },
  { value: 'GitHub API', label: 'GitHub API' },
  { value: 'GO', label: 'GO' },
  { value: 'Google', label: 'Google' },
  { value: 'Gradle', label: 'Gradle' },
  { value: 'GraphQL', label: 'GraphQL' },
  { value: 'Gulp', label: 'Gulp' },
  { value: 'Haskell', label: 'Haskell' },
  { value: 'Homebrew', label: 'Homebrew' },
  { value: 'Homebridge', label: 'Homebridge' },
  { value: 'HTML', label: 'HTML' },
  { value: 'HTTP', label: 'HTTP' },
  { value: 'Icon font', label: 'Icon font' },
  { value: 'iOS', label: 'iOS' },
  { value: 'IPFS', label: 'IPFS' },
  { value: 'Java', label: 'Java' },
  { value: 'JavaScript', label: 'JavaScript' },
  { value: 'Jekyll', label: 'Jekyll' },
  { value: 'jQuery', label: 'jQuery' },
  { value: 'JSON', label: 'JSON' },
  { value: 'The Julia Language', label: 'The Julia Language' },
  { value: 'Jupyter Notebook', label: 'Jupyter Notebook' },
  { value: 'Koa', label: 'Koa' },
  { value: 'Kotlin', label: 'Kotlin' },
  { value: 'Kubernetes', label: 'Kubernetes' },
  { value: 'Laravel', label: 'Laravel' },
  { value: 'LaTeX', label: 'LaTeX' },
  { value: 'Library', label: 'Library' },
  { value: 'Linux', label: 'Linux' },
  { value: 'Localization', label: 'Localization' },
  { value: 'Lua', label: 'Lua' },
  { value: 'Machine Learning', label: 'Machine Learning' },
  { value: 'macOS', label: 'macOS' },
  { value: 'Markdown', label: 'Markdown' },
  { value: 'Mastodon', label: 'Mastodon' },
  { value: 'Material design', label: 'Material design' },
  { value: 'MATLAB', label: 'MATLAB' },
  { value: 'Maven', label: 'Maven' },
  { value: 'Minecraft', label: 'Minecraft' },
  { value: 'Mobile', label: 'Mobile' },
  { value: 'Monero', label: 'Monero' },
  { value: 'MongoDB', label: 'MongoDB' },
  { value: 'Mongoose', label: 'Mongoose' },
  { value: 'Monitoring', label: 'Monitoring' },
  { value: 'MvvmCross', label: 'MvvmCross' },
  { value: 'MySQL', label: 'MySQL' },
  { value: 'NativeScript', label: 'NativeScript' },
  { value: 'Nim', label: 'Nim' },
  { value: 'Natural language processing', label: 'Natural language processing' },
  { value: 'Node.js', label: 'Node.js' },
  { value: 'NoSQL', label: 'NoSQL' },
  { value: 'npm', label: 'npm' },
  { value: 'Objective-C', label: 'Objective-C' },
  { value: 'OpenGL', label: 'OpenGL' },
  { value: 'Operating system', label: 'Operating system' },
  { value: 'P2P', label: 'P2P' },
  { value: 'Package manager', label: 'Package manager' },
  { value: 'Language parsing', label: 'Language parsing' },
  { value: 'Perl', label: 'Perl' },
  { value: 'Perl 6', label: 'Perl 6' },
  { value: 'Phaser', label: 'Phaser' },
  { value: 'PHP', label: 'PHP' },
  { value: 'PICO-8', label: 'PICO-8' },
  { value: 'Pixel Art', label: 'Pixel Art' },
  { value: 'PostgreSQL', label: 'PostgreSQL' },
  { value: 'Project management', label: 'Project management' },
  { value: 'Publishing', label: 'Publishing' },
  { value: 'PWA', label: 'PWA' },
  { value: 'Python', label: 'Python' },
  { value: 'Qt', label: 'Qt' },
  { value: 'R', label: 'R' },
  { value: 'Rails', label: 'Rails' },
  { value: 'Raspberry Pi', label: 'Raspberry Pi' },
  { value: 'Ratchet', label: 'Ratchet' },
  { value: 'React', label: 'React' },
  { value: 'React Native', label: 'React Native' },
  { value: 'ReactiveUI', label: 'ReactiveUI' },
  { value: 'Redux', label: 'Redux' },
  { value: 'REST API', label: 'REST API' },
  { value: 'Ruby', label: 'Ruby' },
  { value: 'Rust', label: 'Rust' },
  { value: 'Sass', label: 'Sass' },
  { value: 'Scala', label: 'Scala' },
  { value: 'scikit-learn', label: 'scikit-learn' },
  { value: 'Software-defined networking', label: 'Software-defined networking' },
  { value: 'Security', label: 'Security' },
  { value: 'Server', label: 'Server' },
  { value: 'Serverless', label: 'Serverless' },
  { value: 'Shell', label: 'Shell' },
  { value: 'SpaceVim', label: 'SpaceVim' },
  { value: 'Spring Boot', label: 'Spring Boot' },
  { value: 'SQL', label: 'SQL' },
  { value: 'Storybook', label: 'Storybook' },
  { value: 'Support', label: 'Support' },
  { value: 'Swift', label: 'Swift' },
  { value: 'Symfony', label: 'Symfony' },
  { value: 'Telegram', label: 'Telegram' },
  { value: 'Tensorflow', label: 'Tensorflow' },
  { value: 'Terminal', label: 'Terminal' },
  { value: 'Terraform', label: 'Terraform' },
  { value: 'Testing', label: 'Testing' },
  { value: 'Twitter', label: 'Twitter' },
  { value: 'TypeScript', label: 'TypeScript' },
  { value: 'Ubuntu', label: 'Ubuntu' },
  { value: 'Unity', label: 'Unity' },
  { value: 'Unreal Engine', label: 'Unreal Engine' },
  { value: 'Vagrant', label: 'Vagrant' },
  { value: 'Vim', label: 'Vim' },
  { value: 'Virtual reality', label: 'Virtual reality' },
  { value: 'Vue.js', label: 'Vue.js' },
  { value: 'Wagtail', label: 'Wagtail' },
  { value: 'Web Components', label: 'Web Components' },
  { value: 'Web app', label: 'Web app' },
  { value: 'Webpack', label: 'Webpack' },
  { value: 'Windows', label: 'Windows' },
  { value: 'WordPlate', label: 'WordPlate' },
  { value: 'WordPress', label: 'WordPress' },
  { value: 'Xamarin', label: 'Xamarin' },
  { value: 'XML', label: 'XML' },
];
