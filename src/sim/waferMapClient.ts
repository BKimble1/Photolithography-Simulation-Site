/**
 * Runs wafer-map simulations off the main thread and caches results by choices.
 * Falls back to computing on the main thread if workers are unavailable.
 */
import { choicesKey, Engine } from './engine';
import type { Choices } from './types';
import { computeWaferMap, type WaferMapResult } from './waferMap';

type Listener = () => void;

class WaferMapClient {
  private cache = new Map<string, WaferMapResult>();
  private pending = new Map<number, string>();
  private inflight = new Set<string>();
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private nextId = 1;
  private fallback: Engine | null = null;

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;
    try {
      this.worker = new Worker(new URL('./waferMap.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; result: WaferMapResult }>) => {
        const key = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        if (key) {
          this.inflight.delete(key);
          this.cache.set(key, e.data.result);
          this.emit();
        }
      };
      this.worker.onerror = () => {
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  get(c: Choices): WaferMapResult | undefined {
    return this.cache.get(choicesKey(c));
  }

  request(c: Choices): void {
    const key = choicesKey(c);
    if (this.cache.has(key) || this.inflight.has(key)) return;
    const w = this.ensureWorker();
    this.inflight.add(key);
    if (w) {
      const id = this.nextId++;
      this.pending.set(id, key);
      w.postMessage({ id, choices: c });
    } else {
      setTimeout(() => {
        this.fallback ??= new Engine(48);
        this.cache.set(key, computeWaferMap(this.fallback, c));
        this.inflight.delete(key);
        this.emit();
      }, 0);
    }
  }

  isComputing(c: Choices): boolean {
    return this.inflight.has(choicesKey(c));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const waferMaps = new WaferMapClient();
