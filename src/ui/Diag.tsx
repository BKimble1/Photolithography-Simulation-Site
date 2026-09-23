/**
 * Developer diagnostics (?diag=1 only): the rendering tier and why, the renderer, frame times
 * measured here, and what the last frames cost the GPU. The buttons switch the tier, to
 * compare quality settings on a real device. Never shown otherwise.
 */
import { useEffect, useState } from 'react';
import { setTier, TIERS, useQuality, type Tier } from '../three/stage/quality';

interface Fab {
  gl: { info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number }; programs?: unknown[] }; getPixelRatio: () => number };
  quality: { shadowRedraws: number };
}

export function Diag() {
  const q = useQuality();
  const [s, setS] = useState({ fps: 0, p95: 0, calls: 0, tris: 0, geos: 0, tex: 0, programs: 0, dpr: 1, shadows: 0, heap: 0 });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const gaps: number[] = [];
    let shadows0 = 0;
    const loop = (t: number) => {
      gaps.push(t - last);
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(() => {
      const fab = (window as unknown as { __fab?: Fab }).__fab;
      const g = gaps.splice(0);
      const sorted = [...g].sort((a, b) => a - b);
      const mean = g.reduce((a, b) => a + b, 0) / Math.max(1, g.length);
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
      const info = fab?.gl.info;
      const sh = fab?.quality.shadowRedraws ?? 0;
      setS({
        fps: mean ? 1000 / mean : 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        calls: info?.render.calls ?? 0,
        tris: info?.render.triangles ?? 0,
        geos: info?.memory.geometries ?? 0,
        tex: info?.memory.textures ?? 0,
        programs: info?.programs?.length ?? 0,
        dpr: fab?.gl.getPixelRatio() ?? 1,
        shadows: sh - shadows0,
        heap: heap / 1e6,
      });
      shadows0 = sh;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, []);
  return (
    <div className="diag" role="status" aria-label="Rendering diagnostics">
      <div>
        <b>{q.tier}</b> · {q.reason}
      </div>
      <div className="diag__r">{q.renderer || 'renderer unknown'}</div>
      <div>
        {s.fps.toFixed(1)} fps · p95 {s.p95.toFixed(1)} ms · dpr {s.dpr.toFixed(2)}
      </div>
      <div>
        last pass: {s.calls} calls · {(s.tris / 1000).toFixed(1)}k tris · shadow redraws {s.shadows}/s
      </div>
      <div>
        {s.geos} geometries · {s.tex} textures · {s.programs} programs{s.heap ? ` · ${s.heap.toFixed(0)} MB heap` : ''}
      </div>
      <div className="diag__b">
        {(Object.keys(TIERS) as Tier[]).map((t) => (
          <button key={t} className="cmd cmd--quiet" aria-pressed={q.tier === t} onClick={() => setTier(t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
