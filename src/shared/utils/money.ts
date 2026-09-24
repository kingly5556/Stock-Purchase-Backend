// All money in this module is an integer count of satang (THB x 100). Never
// use float for cost/price/total fields — see AGENTS.md "Coding Conventions".
export function thbToSatang(thb: number): number {
  return Math.round(thb * 100);
}

export function satangToThb(satang: number): number {
  return satang / 100;
}
