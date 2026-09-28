function fieldMatches(value: number, field: string): boolean {
  if (field === '*') return true;

  if (field.includes(',')) {
    return field.split(',').some((f) => fieldMatches(value, f.trim()));
  }

  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = parseInt(step, 10);
    if (range === '*') return value % stepNum === 0;
    const [lo, hi] = range.includes('-')
      ? range.split('-').map(Number)
      : [parseInt(range, 10), Infinity];
    return value >= lo && value <= hi && (value - lo) % stepNum === 0;
  }

  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }

  return value === parseInt(field, 10);
}

export function getNextCronRunDate(expression: string, from: Date): Date {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5)
    throw new Error(`Invalid cron expression: "${expression}"`);

  const [minF, hourF, domF, monF, dowF] = parts;

  // Start checking 1 minute after "from"
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // Iterate minute-by-minute for up to 1 year
  for (let i = 0; i < 525_600; i++) {
    if (
      fieldMatches(cursor.getMinutes(), minF) &&
      fieldMatches(cursor.getHours(), hourF) &&
      fieldMatches(cursor.getDate(), domF) &&
      fieldMatches(cursor.getMonth() + 1, monF) &&
      fieldMatches(cursor.getDay(), dowF)
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(`Could not resolve next run date for cron: "${expression}"`);
}
