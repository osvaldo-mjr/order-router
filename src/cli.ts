// Parses "--off WH-NV", "--off WH-NV,WH-GA", "--off=WH-NV" (repeatable).
export function parseArgs(argv: string[], knownCodes: string[]): { off: string[] } {
  const off: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;
    if (arg === '--off') value = argv[++i];
    else if (arg.startsWith('--off=')) value = arg.slice('--off='.length);
    else throw new Error(`unknown argument: ${arg}`);

    if (!value) throw new Error('--off needs warehouse codes, e.g. --off WH-NV');
    for (const code of value.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)) {
      if (!knownCodes.includes(code)) throw new Error(`unknown warehouse: ${code}`);
      if (!off.includes(code)) off.push(code);
    }
  }
  return { off };
}
