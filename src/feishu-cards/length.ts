export const SECTION_SOFT_LIMIT = 2000;
export const SECTION_HARD_LIMIT = 4000;
export const MAX_SECTIONS = 4;

export interface BodySection {
  text: string;
  expanded: boolean;
}

export function splitIntoBodySections(text: string): BodySection[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= SECTION_SOFT_LIMIT) {
    return [{ text: trimmed, expanded: true }];
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const bins: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    if (!cur) {
      cur = p;
      continue;
    }
    const candidate = `${cur}\n\n${p}`;
    if (candidate.length > SECTION_HARD_LIMIT) {
      bins.push(cur);
      cur = p;
    } else {
      cur = candidate;
    }
  }
  if (cur) bins.push(cur);

  if (bins.length <= MAX_SECTIONS) {
    return bins.map((t, i) => ({ text: t, expanded: i === 0 }));
  }

  const kept = bins.slice(0, MAX_SECTIONS - 1);
  const tail = bins.slice(MAX_SECTIONS - 1).join('\n\n');
  const clipped =
    tail.length > SECTION_HARD_LIMIT
      ? tail.slice(0, SECTION_HARD_LIMIT - 3) + '...'
      : tail;
  kept.push(clipped);
  return kept.map((t, i) => ({ text: t, expanded: i === 0 }));
}
