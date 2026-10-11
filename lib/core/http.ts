import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

export async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue');
  return id;
}

export async function requireUserContext(): Promise<{ id: string; name: string; email: string }> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue');
  return { id, name: session?.user?.name?.trim() || 'Job seeker', email: session?.user?.email || '' };
}

export function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  try {
    const submitted = new URL(origin);
    if (submitted.host === request.nextUrl.host && submitted.protocol === request.nextUrl.protocol) return;
  } catch { /* Reject malformed origins. */ }
  throw new ApiError(403, 'ORIGIN_MISMATCH', 'Request origin is not allowed');
}

export function objectId(id: string): ObjectId {
  if (!ObjectId.isValid(id) || new ObjectId(id).toHexString() !== id.toLowerCase()) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid identifier');
  }
  return new ObjectId(id);
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ code: error.code, message: error.message, fieldErrors: error.fieldErrors }, { status: error.status });
  console.error('API request failed', error instanceof Error ? error.message : 'Unknown failure');
  return NextResponse.json({ code: 'INTERNAL_ERROR', message: 'Something went wrong' }, { status: 500 });
}

export async function jsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON object');
  }
}

export function stringField(value: unknown, name: string, max: number, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${name} is invalid`, { [name]: `Enter ${required ? 'a nonempty ' : ''}${name} of at most ${max} characters` });
  }
  return value.trim();
}

export function safeJson<T>(fn: () => Promise<T>) {
  return fn().then(value => NextResponse.json(value)).catch(jsonError);
}

export function isDuplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
