import { ApiError } from './http';

export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const MAX_CAMPAIGN_CONTACTS = 20;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email) || /[\r\n]/.test(email)) throw new ApiError(400, 'VALIDATION_ERROR', 'Email is invalid');
  return email;
}

const allowed = new Set(['recruiterName', 'companyName', 'senderName']);
export function validateTemplate(subject: string, bodyText: string): void {
  if (/[\r\n]/.test(subject)) throw new ApiError(400, 'VALIDATION_ERROR', 'Subject must be one line');
  for (const value of [subject, bodyText]) {
    const tokens = value.match(/{{[^{}]*}}|{{|}}/g) || [];
    for (const token of tokens) {
      const name = token.match(/^{{\s*([A-Za-z]+)\s*}}$/)?.[1];
      if (!name || !allowed.has(name)) throw new ApiError(400, 'INVALID_PLACEHOLDER', `Unsupported placeholder: ${token}`);
    }
  }
}

export function renderTemplate(value: string, fields: { recruiterName: string; companyName: string; senderName: string }): string {
  return value.replace(/{{\s*(recruiterName|companyName|senderName)\s*}}/g, (_match, name: keyof typeof fields) => fields[name]);
}

export function noHeaderInjection(value: string): boolean { return !/[\r\n]/.test(value); }
