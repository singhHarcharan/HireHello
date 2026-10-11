import { NextResponse } from 'next/server';

// Mailbox statistics require read scopes, which HireHello does not request.
export async function GET() {
  return NextResponse.json(
    { error: 'Mailbox statistics are unavailable. Use campaign results instead.' },
    { status: 410 },
  );
}
