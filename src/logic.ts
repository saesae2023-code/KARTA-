import { POINTS, hallDistance } from './data';
import type { Point, PointState, StatusFilter } from './types';

export const DEFAULT_STATE: PointState = { visit: 'pending', price: false, followUp: false, contact: false, notes: '' };

/** Initial state taken from the Excel status columns. */
export function initialStateFor(p: Point): PointState {
  const v = p.visitStatus.toLowerCase();
  const visit = v.includes('пропущ') ? 'skipped' : v && !v.startsWith('не ') && v.includes('посещ') ? 'visited' : 'pending';
  const c = p.contactReceived.toLowerCase();
  return { ...DEFAULT_STATE, visit, contact: c === 'да' || c === 'yes', notes: p.notes };
}

export function priorityRank(p: Point): number {
  return p.strategic === 'A+' ? -1 : p.priority === 'A' ? 0 : p.priority === 'B' ? 1 : 2;
}

/** Closest of the point's halls to the current hall. */
export function nearestHall(p: Point, current: string | null): string {
  if (!current) return p.halls[0] ?? p.hall;
  return p.halls.slice().sort((a, b) => hallDistance(current, a) - hallDistance(current, b))[0] ?? p.hall;
}

export function boothsInHall(p: Point, hall: string): string[] {
  const list = p.booths.filter((b) => b.hall === hall).map((b) => b.label);
  return list.length ? list : p.booths.map((b) => b.label);
}

export function matchesStatus(s: PointState, f: StatusFilter): boolean {
  switch (f) {
    case 'pending':
    case 'visited':
    case 'skipped':
      return s.visit === f;
    case 'price':
      return s.price;
    case 'followUp':
      return s.followUp;
    case 'contact':
      return s.contact;
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export function matchesQuery(p: Point, q: string): boolean {
  const n = norm(q);
  if (!n) return true;
  const hay = norm(
    [p.company, p.category, p.products, p.hall, p.booth, p.halls.join(' '), p.mapGroup, String(p.id)].join(' '),
  );
  return hay.includes(n);
}

/** Extract phone numbers present in the text (only what is written, nothing guessed). */
export function phoneLinks(text: string): { label: string; tel: string; wa: string | null }[] {
  const out: { label: string; tel: string; wa: string | null }[] = [];
  const re = /\+?\d[\d\s()-]{7,}\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const digits = m[0].replace(/[^\d+]/g, '');
    const plain = digits.replace(/^\+/, '');
    out.push({ label: m[0].trim(), tel: digits.startsWith('+') ? digits : `+${digits}`, wa: plain.length >= 10 ? plain : null });
  }
  return out;
}

export function emails(text: string): string[] {
  return text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
}

export function wechatId(text: string): string | null {
  const m = text.match(/wechat\s*:\s*([\w-]+)/i);
  return m ? m[1] : null;
}

export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

const CSV_EXTRA = ['APP: Посещение', 'APP: Получить цену', 'APP: Follow-up', 'APP: Контакт получен', 'APP: Заметки', 'APP: Обновлено'];

export function toCsv(columns: string[], states: Record<number, PointState>): string {
  const visitLabel = { pending: 'Не посещено', visited: 'Посещено', skipped: 'Пропущено' } as const;
  const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [[...columns, ...CSV_EXTRA].map(esc).join(',')];
  for (const p of POINTS) {
    const s = states[p.id];
    const row = columns.map((c) => p.raw[c] ?? '');
    row.push(visitLabel[s.visit], s.price ? 'Да' : 'Нет', s.followUp ? 'Да' : 'Нет', s.contact ? 'Да' : 'Нет', s.notes, s.updatedAt ?? '');
    lines.push(row.map(esc).join(','));
  }
  return '﻿' + lines.join('\n');
}
