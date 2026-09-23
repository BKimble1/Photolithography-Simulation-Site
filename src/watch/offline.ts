/**
 * "Save for offline": an explicit, verified download of this build of the site and the film's
 * narration into a versioned cache, served by public/sw.js when there is no connection.
 *
 * Honest by construction: nothing is claimed until every file has been fetched, its sha256
 * checked against the build's list (app-files.json) or the narration manifest, and the cache
 * marked complete. A cache is named after both versions, so a package never mixes builds; an
 * older complete package is removed only after a newer one is complete.
 */
import { create } from 'zustand';
import { FILM_BASE, FILM_VERSION, loadManifest } from './film';

const PREFIX = 'fabone-offline-';
const MARKER = '__complete__';
const BASE = import.meta.env.BASE_URL;

export type OfflinePhase = 'checking' | 'unavailable' | 'none' | 'downloading' | 'ready' | 'outdated' | 'error';

export interface OfflineState {
  phase: OfflinePhase;
  /** Why saving is not possible here, or what went wrong. */
  message: string | null;
  doneBytes: number;
  totalBytes: number;
  /** Size of the saved package. */
  savedBytes: number;
}

export const useOffline = create<OfflineState>(() => ({ phase: 'checking', message: null, doneBytes: 0, totalBytes: 0, savedBytes: 0 }));

interface AppFiles {
  build: string;
  files: { path: string; bytes: number; sha256: string }[];
}

interface PackageFile {
  url: string;
  bytes: number;
  sha256: string;
}

const abs = (path: string) => new URL(path, window.location.origin + BASE).href;

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function packageList(): Promise<{ name: string; files: PackageFile[] }> {
  const res = await fetch(abs('app-files.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error('This copy of the site has no file list (offline saving works on the built site).');
  const app = (await res.json()) as AppFiles;
  const film = await loadManifest();
  const files: PackageFile[] = app.files.map((f) => ({ url: abs(f.path), bytes: f.bytes, sha256: f.sha256 }));
  for (const s of film.segments) {
    if (!s.sha256) throw new Error('The narration manifest has no checksums.');
    files.push({ url: new URL(s.file, window.location.origin + FILM_BASE).href, bytes: s.bytes ?? 0, sha256: s.sha256 });
  }
  return { name: `${PREFIX}${app.build}-${FILM_VERSION}`, files };
}

function supported(): string | null {
  if (typeof window === 'undefined' || !('caches' in window) || !('serviceWorker' in navigator)) return 'This browser cannot save sites for offline use.';
  if (!window.isSecureContext) return 'Offline saving needs a secure (https) connection.';
  if (import.meta.env.DEV) return 'Offline saving is available in the built site, not the development server.';
  return null;
}

/** Look for a complete saved package, and whether it matches this build and film. */
export async function checkOffline(): Promise<void> {
  const why = supported();
  if (why) {
    useOffline.setState({ phase: 'unavailable', message: why });
    return;
  }
  try {
    const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
    let current: string | null = null;
    try {
      current = (await packageList()).name;
    } catch {
      /* offline right now: judge by what is saved */
    }
    for (const k of keys) {
      const c = await caches.open(k);
      const m = await c.match(MARKER);
      if (!m) continue;
      const info = (await m.json()) as { bytes: number };
      useOffline.setState({ phase: current && k !== current ? 'outdated' : 'ready', savedBytes: info.bytes, message: null });
      return;
    }
    useOffline.setState({ phase: 'none', message: null });
  } catch (e) {
    useOffline.setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

let busy = false;

/** Download, verify and commit the package. Safe to call again after a failure (it resumes). */
export async function saveOffline(): Promise<void> {
  if (busy) return;
  const why = supported();
  if (why) {
    useOffline.setState({ phase: 'unavailable', message: why });
    return;
  }
  busy = true;
  try {
    const { name, files } = await packageList();
    const total = files.reduce((s, f) => s + f.bytes, 0);
    useOffline.setState({ phase: 'downloading', message: null, doneBytes: 0, totalBytes: total });
    // Room for it? Ask before downloading anything.
    const est = await navigator.storage?.estimate?.();
    if (est && est.quota !== undefined && est.usage !== undefined && est.quota - est.usage < total * 1.2) {
      const mb = (n: number) => (n / 1e6).toFixed(1);
      throw new Error(`Not enough storage space: the film needs about ${mb(total)} MB and ${mb(Math.max(0, est.quota - est.usage))} MB is free.`);
    }
    await navigator.storage?.persist?.().catch(() => false);
    const cache = await caches.open(name);
    let done = 0;
    for (const f of files) {
      const have = await cache.match(f.url);
      if (have) {
        done += f.bytes;
        useOffline.setState({ doneBytes: done });
        continue;
      }
      const res = await fetch(f.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${new URL(f.url).pathname}.`);
      const buf = await res.arrayBuffer();
      if ((await sha256(buf)) !== f.sha256) throw new Error(`A downloaded file did not match its checksum: ${new URL(f.url).pathname}.`);
      await cache.put(f.url, new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
      done += f.bytes;
      useOffline.setState({ doneBytes: done });
    }
    await cache.put(MARKER, new Response(JSON.stringify({ bytes: total, at: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } }));
    // Only now retire older packages, and start serving this one.
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
    await navigator.serviceWorker.register(abs('sw.js'));
    useOffline.setState({ phase: 'ready', savedBytes: total, doneBytes: total });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
    useOffline.setState({ phase: 'error', message: quota ? 'The browser ran out of storage space while saving the film.' : msg });
  } finally {
    busy = false;
  }
}

/** Remove every saved package and stop the offline service worker. */
export async function removeOffline(): Promise<void> {
  for (const k of await caches.keys()) if (k.startsWith(PREFIX)) await caches.delete(k);
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
  await Promise.all(regs.map((r) => r.unregister()));
  useOffline.setState({ phase: 'none', savedBytes: 0, doneBytes: 0, totalBytes: 0, message: null });
}
