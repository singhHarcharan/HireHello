import { NextResponse } from 'next/server';

// Legacy direct-send endpoint is disabled. Confirmed campaigns create durable
// delivery rows so sends remain reviewable and restart-safe.
export async function POST() {
  return NextResponse.json(
    { error: 'Use POST /api/campaigns after previewing recipients.' },
    { status: 410 },
  );
}
