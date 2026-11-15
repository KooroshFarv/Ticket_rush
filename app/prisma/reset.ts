import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.order.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.event.deleteMany();
  console.log('Database wiped. Run "prisma db seed" to re-seed.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
