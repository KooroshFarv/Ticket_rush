import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.order.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.event.deleteMany();

  const event = await prisma.event.create({
    data: {
      name: 'Rock Concert 2026',
      date: new Date('2026-12-31T20:00:00Z'),
      venue: 'Madison Square Garden',
      seats: {
        create: Array.from({ length: 100 }, (_, i) => ({ seatNumber: i + 1 })),
      },
    },
  });

  console.log(`Seeded event ${event.id} with 100 seats`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
