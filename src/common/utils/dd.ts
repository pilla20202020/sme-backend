export function dd(...args: unknown[]) {
  console.log(...args);
  process.exit(1);
}
