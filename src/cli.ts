// Parses "--off WH-NV", "--off WH-NV,WH-GA", "--off=WH-NV" (repeatable),
// and "--avoid WH-GA" / "--avoid=WH-GA" (one warehouse).
export function parseArgs(argv: string[], knownCodes: string[]): { off: string[]; avoid: string | null } {
  const off: string[] = [];
  const avoid: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = ['--off', '--avoid'].find((f) => arg === f || arg.startsWith(`${f}=`));
    if (!flag) throw new Error(`unknown argument: ${arg}`);
    const value = arg === flag ? argv[++i] : arg.slice(flag.length + 1);

    if (!value) throw new Error(`${flag} needs warehouse codes, e.g. ${flag} WH-NV`);
    const target = flag === '--off' ? off : avoid;
    for (const code of value.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)) {
      if (!knownCodes.includes(code)) throw new Error(`unknown warehouse: ${code}`);
      if (!target.includes(code)) target.push(code);
    }
  }
  if (avoid.length > 1) throw new Error('--avoid takes one warehouse');
  return { off, avoid: avoid[0] ?? null };
}
