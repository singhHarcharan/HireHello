import { createHmac, timingSafeEqual } from 'crypto';
import { ApiError } from './http';

/** Bind approval to the exact sender, recipients, text, and attachment reviewed. */
export function createPreviewToken(userId: string, input: unknown, prepared: {
  senderAddress: string;
  resume: Record<string, unknown>;
  previews: unknown[];
  skipped: unknown[];
}): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required');
  return createHmac('sha256', secret).update(JSON.stringify({ userId, input,
    senderAddress: prepared.senderAddress, resume: { sha256: prepared.resume.sha256, size: prepared.resume.size, label: prepared.resume.label },
    previews: prepared.previews, skipped: prepared.skipped,
  })).digest('hex');
}

export function requireCurrentPreview(submitted: unknown, expected: string): void {
  if (typeof submitted !== 'string' || !/^[a-f0-9]{64}$/.test(submitted) ||
    !timingSafeEqual(Buffer.from(submitted, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new ApiError(409, 'PREVIEW_CHANGED', 'Your materials or recipients changed. Preview every message again before sending.');
  }
}
