/**
 * Measures how well the film's cue times match the narration as the browser decodes it.
 *
 * The film's captions and its semantic events (the camera and process cues in
 * src/content/film.ts) are placed at the cue start times in the narration manifest. This
 * script decodes every segment's MP3 in Chromium (Web Audio, the same decoder the <audio>
 * element uses), finds where speech actually begins and ends around each cue from the signal
 * energy, and reports the differences. It checks the data, including any decoder priming
 * offset; the playback clock itself is checked by e2e/watch.spec.ts.
 *
 * Run with the dev server up:  node scripts/cue-alignment.mjs [base-url]
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/narration/film-1/manifest.json`);
const out = await page.evaluate(async () => {
  const dir = location.href.replace(/manifest\.json.*$/, '');
  const manifest = await (await fetch(dir + 'manifest.json')).json();
  const ctx = new OfflineAudioContext(1, 1, 24000);
  const rows = [];
  for (const seg of manifest.segments) {
    const buf = await ctx.decodeAudioData(await (await fetch(dir + seg.file)).arrayBuffer());
    const x = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const win = Math.round(0.01 * sr); // 10 ms energy windows
    const n = Math.floor(x.length / win);
    const db = new Float32Array(n);
    let peak = -120;
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let k = i * win; k < (i + 1) * win; k++) e += x[k] * x[k];
      db[i] = 10 * Math.log10(e / win + 1e-12);
      peak = Math.max(peak, db[i]);
    }
    // speech: 10 ms windows within 35 dB of the segment's loudest window
    const loud = (i) => db[i] > peak - 35;
    for (const cue of seg.cues) {
      const from = Math.max(0, Math.floor((cue.startMs - 300) / 10));
      const to = Math.min(n - 1, Math.ceil((cue.endMs + 300) / 10));
      let on = -1;
      for (let i = from; i <= to; i++) if (loud(i) && loud(i + 1) && loud(i + 2)) { on = i; break; }
      let off = -1;
      for (let i = to; i >= from; i--) if (loud(i) && loud(i - 1)) { off = i + 1; break; }
      rows.push({ seg: seg.id, cue: cue.id, onsetMs: on * 10 - cue.startMs, endMs: off * 10 - cue.endMs, decodedMs: Math.round((x.length / sr) * 1000), manifestMs: seg.durationMs });
    }
  }
  return rows;
});
await browser.close();

const abs = (a) => a.map(Math.abs).sort((p, q) => p - q);
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
const range = (a) => `${Math.min(...a)} to ${Math.max(...a)} ms`;
const onset = abs(out.map((r) => r.onsetMs));
const ends = abs(out.map((r) => r.endMs));
const lenDiff = abs([...new Map(out.map((r) => [r.seg, r.decodedMs - r.manifestMs])).values()]);
console.log(`cues: ${out.length} (positive = speech after the cue time)`);
console.log(`speech onset - cue start: ${range(out.map((r) => r.onsetMs))}; |median| ${pct(onset, 0.5)} ms, |95th percentile| ${pct(onset, 0.95)} ms`);
console.log(`speech end - cue end:     ${range(out.map((r) => r.endMs))}; |median| ${pct(ends, 0.5)} ms, |95th percentile| ${pct(ends, 0.95)} ms`);
console.log(`decoded length vs manifest duration: worst ${lenDiff.at(-1)} ms over ${lenDiff.length} segments`);
const late = out.filter((r) => Math.abs(r.onsetMs) > 150);
if (late.length) console.log('cues more than 150 ms off:', late.map((r) => `${r.seg}/${r.cue} ${r.onsetMs} ms`).join(', '));
