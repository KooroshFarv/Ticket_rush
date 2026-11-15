import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const events = await prisma.event.findMany({
    include: {
      seats: {
        orderBy: { seatNumber: 'asc' },
        select: { id: true, seatNumber: true, status: true },
      },
    },
  });
  return NextResponse.json(events);
}
