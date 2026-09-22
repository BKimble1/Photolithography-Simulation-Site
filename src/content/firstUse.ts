import { FLOW } from '../sim/flow';
import { GLOSSARY } from './glossary';
import { STEPS } from './steps';

const TERM = /\[\[([a-z0-9]+)\|[^\]]+\]\]/g;

/**
 * For each step (by index), the glossary terms that appear in its copy for the first time in
 * the journey. The step panel defines these inline, so every term is defined where it is
 * first used; later mentions keep the hover/tap definition.
 */
export const FIRST_USE: string[][] = (() => {
  const seen = new Set<string>();
  return FLOW.map((f) => {
    const c = STEPS[f.id];
    const text = [c.doing, c.changes, c.why].join(' ');
    const out: string[] = [];
    for (const m of text.matchAll(TERM)) {
      const id = m[1];
      if (!GLOSSARY[id] || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  });
})();
