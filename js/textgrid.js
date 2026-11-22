// TextGrid de Praat (formato largo) con un tier de intervalos.
// intervals: [{ start, end, label }] en segundos; los huecos se rellenan con intervalos vacíos.

function q(s) { return '"' + String(s ?? '').replace(/"/g, '""') + '"'; }

export function makeTextGrid(duration, tiers) {
  duration = round(duration);
  const out = [];
  out.push('File type = "ooTextFile"', 'Object class = "TextGrid"', '',
    'xmin = 0', `xmax = ${duration}`, 'tiers? <exists>', `size = ${tiers.length}`, 'item []:');
  tiers.forEach((tier, ti) => {
    const filled = [];
    let t = 0;
    const sorted = tier.intervals
      .map((iv) => ({ start: Math.max(0, Math.min(duration, iv.start)), end: Math.max(0, Math.min(duration, iv.end)), label: iv.label }))
      .filter((iv) => iv.end > iv.start)
      .sort((a, b) => a.start - b.start);
    for (const iv of sorted) {
      const s = Math.max(iv.start, t);
      if (iv.end <= s) continue;
      if (s > t) filled.push({ start: t, end: s, label: '' });
      filled.push({ start: s, end: iv.end, label: iv.label });
      t = iv.end;
    }
    if (t < duration) filled.push({ start: t, end: duration, label: '' });
    if (!filled.length) filled.push({ start: 0, end: duration, label: '' });

    out.push(`    item [${ti + 1}]:`, '        class = "IntervalTier"', `        name = ${q(tier.name)}`,
      '        xmin = 0', `        xmax = ${duration}`, `        intervals: size = ${filled.length}`);
    filled.forEach((iv, i) => {
      out.push(`        intervals [${i + 1}]:`, `            xmin = ${round(iv.start)}`,
        `            xmax = ${round(iv.end)}`, `            text = ${q(iv.label)}`);
    });
  });
  return out.join('\n') + '\n';
}

function round(x) { return Math.round(x * 1e6) / 1e6; }
