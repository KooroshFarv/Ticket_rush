import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('X-Served-By', process.env.INSTANCE_ID ?? 'unknown');
  return response;
}

export const config = { matcher: ['/(.*)',] };
