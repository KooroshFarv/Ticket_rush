import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      instance: process.env.INSTANCE_ID ?? 'unknown',
    });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
