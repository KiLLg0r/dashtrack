// Display-unit conversion. All stored/computed values are SI
// (speeds m/s, distances metres) — conversion happens only at render.
export type Units = 'metric' | 'imperial'

const M_PER_MI = 1609.344       // exact, international mile
const FT_PER_M = 1 / 0.3048     // exact, international foot
const MPS_TO_KMH = 3.6          // exact
const MPS_TO_MPH = 3600 / M_PER_MI

export const cvtSpeed = (mps: number, u: Units) =>
  mps * (u === 'imperial' ? MPS_TO_MPH : MPS_TO_KMH)

export const speedUnit = (u: Units) => (u === 'imperial' ? 'mph' : 'km/h')

export const fmtDistParts = (m: number, u: Units): [string, string] => {
  if (u === 'imperial') {
    return m >= 1000 / FT_PER_M  // switch to miles above 1000 ft
      ? [(m / M_PER_MI).toFixed(1), 'mi']
      : [String(Math.round(m * FT_PER_M)), 'ft']
  }
  return m >= 1000 ? [(m / 1000).toFixed(1), 'km'] : [String(Math.round(m)), 'm']
}

export const fmtDist = (m: number, u: Units) => fmtDistParts(m, u).join(' ')
