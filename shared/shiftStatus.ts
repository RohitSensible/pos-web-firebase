/** Dashboard and reports use the POS inactive flag as the authoritative status. */
export function dashboardShiftStatus(shift: { inActive: boolean }): 'Active' | 'Closed' {
  return shift.inActive === true ? 'Closed' : 'Active';
}
