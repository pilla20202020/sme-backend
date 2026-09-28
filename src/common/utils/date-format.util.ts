function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Formats a date as MM/DD/YYYY for API responses. Pass `{ includeTime: true }`
 * for timestamp fields (createdAt, sentAt, etc.) to append "hh:mm AM/PM".
 *
 * Date-only formatting reads UTC components (calendar dates are stored at
 * midnight UTC, so local getters could shift the day); timestamp formatting
 * reads local components since it represents a real instant.
 */
export function formatDateMDY(
  value: Date | string | number | null | undefined,
  options: { includeTime?: boolean } = {},
): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  if (options.includeTime) {
    const hours24 = date.getHours();
    const hours12 = hours24 % 12 || 12;
    const meridiem = hours24 >= 12 ? 'PM' : 'AM';
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()} ${pad2(hours12)}:${pad2(date.getMinutes())} ${meridiem}`;
  }

  return `${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}/${date.getUTCFullYear()}`;
}
