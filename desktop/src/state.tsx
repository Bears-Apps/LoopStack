// App-wide state both views share: the care-team thread and the review
// packet. A reply recorded on the care-team side shows in the person's thread
// tile. Nothing here leaves the window. The tree remounts when the dataset
// changes (main.tsx), so the thread starts again from the new dataset.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CARE_NOTE, DATA, DAY, HEADS_UP, PATIENT, QUESTION } from './data/current';
import { rangeLabel } from './data/derive';

export interface Msg {
  from: 'sam' | 'clinician';
  date: string;
  text: string;
  attach?: string;
  /** A reply recorded from the review's Agree / Modify / Discuss. */
  decision?: 'agree' | 'modify' | 'discuss';
}

export const initialThread = (): Msg[] => [
  ...(QUESTION ? [{ from: 'sam' as const, date: QUESTION.date, text: QUESTION.text, attach: HEADS_UP ? `${HEADS_UP.title} · ${HEADS_UP.detail}` : undefined }] : []),
  ...(CARE_NOTE ? [{ from: 'clinician' as const, date: CARE_NOTE.date, text: CARE_NOTE.text }] : []),
];

export type PacketPart = 'loop' | 'changes' | 'day' | 'question';
export const packetParts = (): { id: PacketPart; label: string; note: string }[] => [
  { id: 'loop', label: 'What Loop did', note: 'Delivered against scheduled, by hour' },
  { id: 'changes', label: 'Settings changes', note: 'Who proposed, who agreed, the before and after' },
  { id: 'day', label: 'Heads-ups and the day tracker', note: `The average ${DAY.name}${DAY.stretch ? `, ${rangeLabel(DAY.stretch[0], DAY.stretch[1])}` : ''}` },
  ...(QUESTION ? [{ id: 'question' as const, label: 'Your question', note: QUESTION.text }] : []),
];

export interface Packet {
  shared: string;
  parts: PacketPart[];
}

interface Store {
  thread: Msg[];
  send: (m: Msg) => void;
  packet: Packet;
  sharePacket: (parts: PacketPart[]) => void;
  /** The clinician's decision on the person's question, once recorded. */
  decision: Msg | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [thread, setThread] = useState<Msg[]>(initialThread);
  const [packet, setPacket] = useState<Packet>(() => ({ shared: DATA.source === 'synthetic' ? 'Nov 12' : 'not yet', parts: packetParts().map((p) => p.id) }));
  const send = useCallback((m: Msg) => setThread((t) => [...t, m]), []);
  const sharePacket = useCallback((parts: PacketPart[]) => setPacket({ shared: DATA.today, parts }), []);
  const decision = useMemo(() => [...thread].reverse().find((m) => m.decision) ?? null, [thread]);
  const value = useMemo(() => ({ thread, send, packet, sharePacket, decision }), [thread, send, packet, sharePacket, decision]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export const who = (m: Msg, side: 'patient' | 'clinician') =>
  m.from === 'clinician' ? (side === 'clinician' ? 'You' : PATIENT.clinician) : side === 'patient' ? 'You' : PATIENT.first;
