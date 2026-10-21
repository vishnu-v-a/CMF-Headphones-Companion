import { responseDb } from './response.mjs';

// Listening starting points, not measurements of Sony/Realme or firmware limits.
export const presets = {
  punch: { name: 'Punch', deep: 30, punch: 65, clarity: 45 },
  deep: { name: 'Deep bass', deep: 70, punch: 35, clarity: 35 },
};

export function headroom(profile) {
  let peak = -Infinity;
  // Include every filter centre as well as a dense logarithmic frequency grid.
  const frequencies = profile.filters.map(filter => filter.frequency);
  for (let i = 0; i <= 2048; i++) frequencies.push(20 * 1000 ** (i / 2048));
  for (const hz of frequencies) {
    const db = responseDb(profile.filters, 0, hz);
    if (!Number.isFinite(db)) throw Error('These values cannot be used to estimate headroom.');
    peak = Math.max(peak, db);
  }
  // Extra margin, rounded toward attenuation. This is not a true-peak meter.
  const recommended = -Math.ceil((Math.max(0, peak) + 1) * 10) / 10;
  return { peak, recommended, outputPeak: peak + profile.preamp };
}

export function tuningProfile(values, name = 'Custom punch') {
  for (const key of ['deep', 'punch', 'clarity']) {
    if (!Number.isFinite(values[key]) || values[key] < 0 || values[key] > 100) {
      throw Error('Sound controls must be between 0 and 100.');
    }
  }
  const deep = values.deep / 100, punch = values.punch / 100, clarity = values.clarity / 100;
  const profile = {
    name, preamp: 0, disabled_filters: [],
    filters: [
      { id: 1, kind: 'LS', frequency: 50, gain: 4 * deep, q: 0.7 },
      { id: 2, kind: 'PK', frequency: 95, gain: 4 * punch, q: 0.85 },
      { id: 3, kind: 'PK', frequency: 280, gain: -2 * clarity, q: 0.9 },
      { id: 4, kind: 'PK', frequency: 2300, gain: 1.2 * clarity, q: 0.8 },
    ],
  };
  profile.preamp = headroom(profile).recommended;
  return profile;
}

export function exportProfile(profile) {
  return [
    `# ${profile.name.replace(/[\r\n]/g, ' ')}`,
    '# CMF EQ editor draft. Importing this file does not apply it to headphones.',
    `Preamp: ${profile.preamp} dB`,
    ...profile.filters.map(filter => `Filter ${filter.id}: ON ${filter.kind} Fc ${filter.frequency} Hz Gain ${filter.gain} dB Q ${filter.q}`),
    '',
  ].join('\n');
}
