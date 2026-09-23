// Dev measurement: bounding box, triangles, draw calls and mesh counts per tool scene.
import { chromium } from '@playwright/test';
const cases = [
  ['foup', 'arrive'], ['foup', 'transfer'], ['inspect', 'scan'], ['wetclean', 'clean'], ['furnace', 'padox'], ['etch', 'gate-etch'],
  ['cmp', 'sti-fill'], ['implant', 'wells'], ['depo', 'pmd'], ['track', 'coat'], ['scanner', 'expose'], ['metrology', 'adi'],
  ['prober', 'probe'], ['dicing', 'dice'], ['package', 'bond'], ['testbench', 'final'], ['fab', 'coat'],
];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
for (const [tool, step] of cases) {
  const view = tool === 'fab' ? 'fab' : 'tool';
  await page.goto(`http://127.0.0.1:5173/?step=${step}&view=${view}&p=0.5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const f = window.__fab; if (!f) return null;
    const { scene, gl, THREE } = f;
    const box = new THREE.Box3();
    let meshes = 0, tris = 0, inst = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      meshes++;
      const g = o.geometry; if (!g) return;
      const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      const k = o.isInstancedMesh ? o.count : 1; if (o.isInstancedMesh) inst++;
      tris += n * k;
      if (g.boundingBox == null) g.computeBoundingBox();
      if (!o.material?.transparent || o.material.opacity > 0.5) { const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld); if (isFinite(b.min.x)) box.union(b); }
    });
    gl.info.autoReset = true;
    return { meshes, inst, tris: Math.round(tris), calls: gl.info.render.calls, frameTris: gl.info.render.triangles, box: [box.min.toArray().map((v) => +v.toFixed(2)), box.max.toArray().map((v) => +v.toFixed(2))], geos: gl.info.memory.geometries, tex: gl.info.memory.textures };
  });
  console.log(tool.padEnd(10), JSON.stringify(r));
}
await browser.close();
