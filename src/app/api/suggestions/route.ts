import { NextResponse } from 'next/server';

// Deprecated: local API removed in favor of Catalyst function
export async function POST() {
  return NextResponse.json({ error: 'Deprecated: use Catalyst function' }, { status: 410 });
}

export async function GET() {
  return NextResponse.json({ error: 'Deprecated: use Catalyst function' }, { status: 410 });
}