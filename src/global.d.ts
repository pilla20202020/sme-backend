export function dd(...args: any[]): never {
  console.log('\n===== DD =====');
  console.dir(args.length === 1 ? args[0] : args, {
    depth: null,
    colors: true,
  });
  console.log('==============\n');

  process.exit(1);
}
