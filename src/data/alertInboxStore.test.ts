import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearInbox,
  fileAlerts,
  getInboxItems,
  markAllRead,
  markRead,
  unreadCount,
} from './alertInboxStore';
import type { PendingAlert } from '@/lib/alerts/alertEngine';

const NOW = new Date(2026, 7, 12, 12, 0, 0);

const alert = (id: string, over: Partial<PendingAlert> = {}): PendingAlert => ({
  id,
  category: 'risk_window',
  title: `Title ${id}`,
  body: `Body ${id}`,
  fireAtIso: new Date(NOW.getTime() + 3600_000).toISOString(),
  repeatsWeekly: false,
  ...over,
});

describe('alert inbox', () => {
  beforeEach(() => clearInbox());

  it('files new alerts and marks them unread', () => {
    expect(fileAlerts([alert('a'), alert('b')], NOW)).toBe(true);
    expect(getInboxItems()).toHaveLength(2);
    expect(unreadCount()).toBe(2);
  });

  it('dedupes on id across refreshes', () => {
    // The engine re-emits the same ids every refresh — that is how scheduling
    // replaces rather than duplicates, and the inbox has to match.
    fileAlerts([alert('a')], NOW);
    expect(fileAlerts([alert('a')], NOW)).toBe(false);
    expect(getInboxItems()).toHaveLength(1);
  });

  it('keeps the first-seen time when an id reappears', () => {
    fileAlerts([alert('a')], NOW);
    const first = getInboxItems()[0].seenIso;
    fileAlerts([alert('a')], new Date(NOW.getTime() + 86_400_000));
    expect(getInboxItems()[0].seenIso).toBe(first);
  });

  it('puts the newest first', () => {
    fileAlerts([alert('old')], NOW);
    fileAlerts([alert('new')], NOW);
    expect(getInboxItems()[0].id).toBe('new');
  });

  it('marks one read without touching the others', () => {
    fileAlerts([alert('a'), alert('b')], NOW);
    markRead('a');
    expect(unreadCount()).toBe(1);
    expect(getInboxItems().find((i) => i.id === 'a')!.readIso).not.toBeNull();
  });

  it('does not move the read timestamp on a second read', () => {
    fileAlerts([alert('a')], NOW);
    markRead('a');
    const at = getInboxItems()[0].readIso;
    markRead('a');
    expect(getInboxItems()[0].readIso).toBe(at);
  });

  it('marks everything read at once', () => {
    fileAlerts([alert('a'), alert('b'), alert('c')], NOW);
    markAllRead();
    expect(unreadCount()).toBe(0);
  });

  it('never drops an unread item when trimming', () => {
    // Fill past the cap with unread items, then confirm none were discarded.
    const many = Array.from({ length: 90 }, (_, i) => alert(`x${i}`));
    fileAlerts(many, NOW);
    expect(unreadCount()).toBe(90);
    expect(getInboxItems()).toHaveLength(90);
  });

  it('trims read items once the cap is exceeded', () => {
    fileAlerts(
      Array.from({ length: 70 }, (_, i) => alert(`r${i}`)),
      NOW,
    );
    markAllRead();
    fileAlerts([alert('fresh')], NOW);
    expect(getInboxItems().length).toBeLessThanOrEqual(61);
    expect(getInboxItems().some((i) => i.id === 'fresh')).toBe(true);
  });

  it('files one row per finding when several alerts share it', () => {
    // A recurring window emits one alert per lead time. Two notifications is
    // the intent; two inbox rows reading identically is not.
    expect(
      fileAlerts(
        [
          alert('risk_fri_2h', { findingId: 'risk_fri' }),
          alert('risk_fri_1h', { findingId: 'risk_fri' }),
        ],
        NOW,
      ),
    ).toBe(true);
    expect(getInboxItems()).toHaveLength(1);
    expect(getInboxItems()[0].id).toBe('risk_fri_2h');

    // And it stays one across the next refresh.
    expect(
      fileAlerts([alert('risk_fri_1h', { findingId: 'risk_fri' })], NOW),
    ).toBe(false);
    expect(getInboxItems()).toHaveLength(1);
  });

  it('carries the category and fire time through', () => {
    fileAlerts([alert('a', { category: 'data_health' })], NOW);
    const item = getInboxItems()[0];
    expect(item.category).toBe('data_health');
    expect(item.fireAtIso).toBe(alert('a').fireAtIso);
  });
});
