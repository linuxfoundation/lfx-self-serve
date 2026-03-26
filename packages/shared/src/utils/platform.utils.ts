// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Returns a Font Awesome icon class for the chat platform detected from the URL. */
export function getChatPlatformIcon(url: string | null | undefined): string {
  const lower = (url || '').toLowerCase();
  if (lower.includes('slack')) return 'fa-brands fa-slack';
  if (lower.includes('discord')) return 'fa-brands fa-discord';
  if (lower.includes('teams.microsoft') || lower.includes('teams.live')) return 'fa-brands fa-microsoft';
  if (lower.includes('chat.google')) return 'fa-brands fa-google';
  return 'fa-light fa-comment';
}

/** Returns a human-readable label for the chat platform detected from the URL. */
export function getChatPlatformLabel(url: string | null | undefined): string {
  const lower = (url || '').toLowerCase();
  if (lower.includes('slack')) return 'Slack';
  if (lower.includes('discord')) return 'Discord';
  if (lower.includes('teams.microsoft') || lower.includes('teams.live')) return 'Microsoft Teams';
  if (lower.includes('chat.google')) return 'Google Chat';
  if (lower.includes('zulip')) return 'Zulip';
  if (lower.includes('matrix') || lower.includes('element')) return 'Matrix / Element';
  return 'Chat channel';
}

/** Returns a Font Awesome icon class for the repo/website platform detected from the URL. */
export function getRepoPlatformIcon(url: string | null | undefined): string {
  const lower = (url || '').toLowerCase();
  if (lower.includes('github')) return 'fa-brands fa-github';
  if (lower.includes('gitlab')) return 'fa-brands fa-gitlab';
  if (lower.includes('bitbucket')) return 'fa-brands fa-bitbucket';
  return 'fa-light fa-globe';
}

/** Returns a human-readable label for the repo/website platform detected from the URL. */
export function getRepoPlatformLabel(url: string | null | undefined): string {
  const lower = (url || '').toLowerCase();
  if (lower.includes('github')) return 'GitHub';
  if (lower.includes('gitlab')) return 'GitLab';
  if (lower.includes('bitbucket')) return 'Bitbucket';
  return 'Website';
}
