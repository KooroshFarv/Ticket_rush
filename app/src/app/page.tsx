import { prisma } from '@/lib/prisma';
import SeatGrid from '@/components/SeatGrid';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const events = await prisma.event.findMany({
    include: {
      seats: { orderBy: { seatNumber: 'asc' } },
    },
  });

  return (
    <main>
      <h1>Ticket Rush</h1>
      {events.length === 0 && <p>No events found — run the seed.</p>}
      {events.map(event => (
        <div key={event.id} className="event-card">
          <h2>{event.name}</h2>
          <p>
            {event.venue}&nbsp;·&nbsp;
            {new Date(event.date).toLocaleDateString('en-US', { dateStyle: 'long' })}
          </p>
          <SeatGrid
            seats={event.seats.map(s => ({
              id: s.id,
              seatNumber: s.seatNumber,
              status: s.status as 'AVAILABLE' | 'SOLD',
            }))}
          />
        </div>
      ))}
    </main>
  );
}
