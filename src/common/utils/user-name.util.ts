/**
 * Joins name parts into a display name for API responses, dropping the
 * legacy '-' placeholder stored for SSO users provisioned with no surname.
 */
export function formatUserName(
  ...parts: (string | null | undefined)[]
): string {
  return parts
    .map((p) => p?.trim())
    .filter((p) => p && p !== '-')
    .join(' ');
}
