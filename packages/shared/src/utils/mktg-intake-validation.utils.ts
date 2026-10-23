// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Check intake sizes before format checks or document parsing. Measure the
 * submitted string, not its trimmed value, so padding cannot evade the budget.
 * Required/optional, type and unknown-key checks remain with each agent's validator.
 */
export function validateMktgIntakeAnswerLengths(answers: Record<string, unknown>, limits: Readonly<Record<string, number>>): string[] {
  const errors: string[] = [];
  for (const [key, maxChars] of Object.entries(limits)) {
    const value = answers[key];
    if (typeof value === 'string' && value.length > maxChars) {
      errors.push(`answers.${key} must be at most ${maxChars} characters`);
    }
  }
  return errors;
}
