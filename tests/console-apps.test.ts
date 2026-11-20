import { describe, it, expect } from 'vitest';
import { APPS, visibleApps } from '../src/console/apps.jsx';

describe('the Console app list shared by the rail and the popup', () => {
  it('lists the public apps in rail order when locked', () => {
    expect(visibleApps(false).map((a) => a.id)).toEqual([
      'mdh',
      'audit',
      'cib',
      'builder',
      'inspector',
      'fabry',
      'galaxy',
    ]);
  });

  it('adds the gated apps at the end when unlocked', () => {
    const ids = visibleApps(true).map((a) => a.id);
    expect(ids).toHaveLength(10);
    expect(ids.slice(-3)).toEqual(['academy', 'rdc', 'sftp']);
  });

  it('gives every app a description and keeps the rail badges', () => {
    for (const app of APPS) expect(app.description).toBeTruthy();
    expect(APPS.find((a) => a.id === 'builder')!.beta).toBe(true);
    for (const id of ['academy', 'rdc', 'sftp']) {
      const app = APPS.find((a) => a.id === id)!;
      expect(app.exp && app.gated).toBe(true);
    }
  });
});
