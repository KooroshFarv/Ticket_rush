'use client';

import { useState } from 'react';

type Seat = { id: string; seatNumber: number; status: 'AVAILABLE' | 'SOLD' };
type Msg  = { kind: 'success' | 'error' | 'loading'; text: string } | null;

export default function SeatGrid({ seats: initial }: { seats: Seat[] }) {
  const [seats, setSeats]       = useState(initial);
  const [selected, setSelected] = useState<Seat | null>(null);
  const [form, setForm]         = useState({ firstName: '', lastName: '', email: '' });
  const [msg, setMsg]           = useState<Msg>(null);

  function pick(seat: Seat) {
    setSelected(seat);
    setMsg(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setMsg({ kind: 'loading', text: 'Placing order…' });

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seatId: selected.id, ...form }),
    });

    if (res.status === 201) {
      setSeats(s => s.map(x => x.id === selected.id ? { ...x, status: 'SOLD' } : x));
      setSelected(null);
      setForm({ firstName: '', lastName: '', email: '' });
      setMsg({ kind: 'success', text: `Seat #${selected.seatNumber} is yours!` });
    } else {
      const data = await res.json().catch(() => ({}));
      const text =
        res.status === 409 ? 'That seat was just sold — please pick another.' :
        res.status === 503 ? 'Server busy, please try again in a moment.' :
        (data as { error?: string }).error ?? 'Something went wrong.';
      if (res.status === 409) {
        setSeats(s => s.map(x => x.id === selected.id ? { ...x, status: 'SOLD' } : x));
        setSelected(null);
      }
      setMsg({ kind: 'error', text });
    }
  }

  const available = seats.filter(s => s.status === 'AVAILABLE').length;

  return (
    <>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>
        {available} of {seats.length} seats available
      </p>

      <div className="legend">
        <span><span className="dot available" />Available</span>
        <span><span className="dot selected"  />Selected</span>
        <span><span className="dot sold"      />Sold</span>
      </div>

      <div className="seat-grid">
        {seats.map(seat => (
          <button
            key={seat.id}
            className={`seat ${seat.status === 'SOLD' ? 'sold' : selected?.id === seat.id ? 'selected' : 'available'}`}
            disabled={seat.status === 'SOLD'}
            onClick={() => pick(seat)}
            title={seat.status === 'SOLD' ? `Seat ${seat.seatNumber} — sold` : `Seat ${seat.seatNumber}`}
          >
            {seat.seatNumber}
          </button>
        ))}
      </div>

      {selected && (
        <form className="order-form" onSubmit={submit}>
          <h3>Buy seat #{selected.seatNumber}</h3>
          <input
            placeholder="First name"
            value={form.firstName}
            onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
            required
          />
          <input
            placeholder="Last name"
            value={form.lastName}
            onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
            required
          />
          <input
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
          />
          <div className="form-actions">
            <button type="submit" className="btn-buy" disabled={msg?.kind === 'loading'}>
              {msg?.kind === 'loading' ? 'Placing…' : 'Buy ticket'}
            </button>
            <button type="button" className="btn-cancel" onClick={() => { setSelected(null); setMsg(null); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {msg && <p className={`message ${msg.kind}`}>{msg.text}</p>}
    </>
  );
}
