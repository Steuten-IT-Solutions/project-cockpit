/** Same normalisation as src/Auth/RecoveryCodes.php: "abcde-fghjk" → "ABCDEFGHJK". */
export function normaliseRecoveryCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}
