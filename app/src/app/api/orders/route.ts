import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

class NotFoundError extends Error {}
class ConflictError extends Error {}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { seatId, firstName, lastName, email } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof seatId !== 'string' ||
    typeof firstName !== 'string' ||
    typeof lastName !== 'string' ||
    typeof email !== 'string' ||
    !seatId || !firstName || !lastName || !email
  ) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Pessimistic lock: blocks any concurrent transaction from reading
      // the same row until this transaction commits or rolls back.
      type SeatRow = { id: string; status: string };
      const rows = await tx.$queryRaw<SeatRow[]>`
        SELECT "id", "status" FROM "Seat" WHERE "id" = ${seatId} FOR UPDATE
      `;

      if (rows.length === 0) throw new NotFoundError();
      if (rows[0].status === 'SOLD') throw new ConflictError();

      await tx.seat.update({
        where: { id: seatId },
        data: { status: 'SOLD' },
      });

      return tx.order.create({
        data: { seatId, firstName, lastName, email },
      });
    });

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: 'Seat not found' }, { status: 404 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: 'Seat already sold' }, { status: 409 });
    }
    // Unique constraint violation — safety net if two transactions slip through
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'Seat already sold' }, { status: 409 });
    }
    // Connection pool exhausted
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2024'
    ) {
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 },
      );
    }
    console.error('orders error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
