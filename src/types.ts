export type Priority = 'A' | 'B' | string;

export interface Booth {
  label: string;
  hall: string | null;
}

/** One row of FULL MASTER LIST. All text fields are verbatim from Excel. */
export interface Point {
  id: number;
  priority: Priority;
  category: string;
  company: string;
  hall: string;
  booth: string;
  products: string;
  why: string;
  toCheck: string;
  phone: string;
  wechatEmail: string;
  website: string;
  verification: string;
  source: string;
  visitStatus: string;
  contactReceived: string;
  notes: string;
  mapGroup: string;
  pointType: string;
  /** Parsed from `booth` (split by ';'). */
  booths: Booth[];
  /** Halls from `hall` (split by '+') plus halls found in booth labels. */
  halls: string[];
  /** Original row keyed by Excel header. */
  raw: Record<string, string>;
}

export type Visit = 'pending' | 'visited' | 'skipped';

export interface PointState {
  visit: Visit;
  price: boolean;
  followUp: boolean;
  contact: boolean;
  notes: string;
  updatedAt?: string;
}

export type StatusFilter = 'pending' | 'visited' | 'skipped' | 'price' | 'followUp' | 'contact';
