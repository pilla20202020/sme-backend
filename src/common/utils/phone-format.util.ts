/**
 * Formats a phone number as (xxx) xxx-xxxx for API responses. Strips a
 * leading US country code (1) when present. Numbers that don't resolve to
 * 10 digits are returned unchanged rather than mangled.
 */
export function formatPhoneNumber(phone: string): string;
export function formatPhoneNumber(
  phone: string | null | undefined,
): string | null;
export function formatPhoneNumber(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');
  const tenDigits =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (tenDigits.length !== 10) return phone;

  return `(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}
