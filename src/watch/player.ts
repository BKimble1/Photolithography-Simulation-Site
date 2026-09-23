/**
 * The film's clock. While a narration segment plays, its audio element's position IS the
 * film time: the picture follows the sound, so if the audio stalls (buffering), the picture
 * waits with it, and muting changes nothing about timing. The silent camera moves between
 * segments, and the whole film when the narration cannot be played, run on the page clock
 * instead: one timeline, one time value, whichever source drives it.
 *
 * Two audio elements alternate, so the next segment is loaded while the current one plays.
 * Both are unlocked inside the click that started the film (browsers only allow sound after
 * a user gesture). Seeking sets the time directly; nothing is replayed.
 */
import { stageTime } from '../three/stage/time';
import { locate, type Timeline } from './timeline';

export type FilmStatus = 'loading' | 'playing' | 'paused' | 'buffering' | 'ended';

/** A tiny silent WAV used to unlock audio elements inside the user's click. */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

let pair: HTMLAudioElement[] | null = null;

/**
 * The film's two audio elements. Call inside the click that opens the film: an element that
 * has started playing in a user gesture may play sound later without one.
 */
export function filmAudio(unlock = false): HTMLAudioElement[] | null {
  if (typeof Audio === 'undefined') return null;
  if (!pair) {
    pair = [new Audio(), new Audio()];
    for (const el of pair) {
      el.preload = 'auto';
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    }
  }
  if (unlock)
    for (const el of pair) {
      el.src = SILENT;
      el.play()
        .then(() => el.pause())
        .catch(() => {});
    }
  return pair;
}

export class FilmPlayer {
  t = 0;
  /** The viewer wants the film to play. */
  wantPlay = false;
  buffering = false;
  ended = false;
  rate = 1;
  volume = 1;
  muted = false;
  /** False when the narration cannot be played: captions only, on the page clock. */
  audioOk: boolean;
  audioError: string | null = null;

  private els: HTMLAudioElement[] = [];
  private unlisten: (() => void)[] = [];
  /** Which segment each element holds (-1: none). */
  private holds: number[] = [-1, -1];
  private active = -1;
  private lastNow = 0;
  private timer: number | null = null;

  constructor(
    public tl: Timeline,
    private base: string,
    private onChange: () => void,
    /** The two audio elements (see filmAudio), or null for captions-only playback. */
    els: HTMLAudioElement[] | null,
  ) {
    this.audioOk = !!els && els.length === 2;
    if (els) {
      for (const el of els) {
        const onError = () => this.fail(el);
        const onChange = () => this.changed();
        el.addEventListener('error', onError);
        el.addEventListener('waiting', onChange);
        el.addEventListener('playing', onChange);
        this.unlisten.push(() => {
          el.removeEventListener('error', onError);
          el.removeEventListener('waiting', onChange);
          el.removeEventListener('playing', onChange);
        });
        this.els.push(el);
      }
    }
  }

  get status(): FilmStatus {
    if (this.ended) return 'ended';
    if (!this.wantPlay) return 'paused';
    return this.buffering ? 'buffering' : 'playing';
  }

  play(): void {
    if (this.ended || this.t >= this.tl.duration - 0.01) {
      this.ended = false;
      this.seek(0);
    }
    this.wantPlay = true;
    this.lastNow = stageTime.now();
    this.syncAudio(true);
    this.startTimer();
    this.changed();
  }

  pause(): void {
    this.wantPlay = false;
    this.buffering = false;
    for (const el of this.els) el.pause();
    this.stopTimer();
    this.changed();
  }

  toggle(): void {
    if (this.wantPlay) this.pause();
    else this.play();
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.tl.duration, t));
    this.ended = false;
    this.lastNow = stageTime.now();
    this.active = -1;
    for (const el of this.els) el.pause();
    this.syncAudio(true);
    this.changed();
  }

  setRate(r: number): void {
    this.rate = r;
    for (const el of this.els) el.playbackRate = r;
    this.changed();
  }

  setVolume(v: number): void {
    this.volume = v;
    for (const el of this.els) el.volume = v;
    this.changed();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    for (const el of this.els) el.muted = m;
    this.changed();
  }

  /** Try the narration again after a failure. */
  retryAudio(): void {
    if (!this.els.length) return;
    this.audioOk = true;
    this.audioError = null;
    this.holds = [-1, -1];
    this.active = -1;
    this.syncAudio(true);
    this.changed();
  }

  dispose(): void {
    this.stopTimer();
    this.unlisten.forEach((f) => f());
    for (const el of this.els) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }

  /**
   * The film time right now, read from the narration audio at the moment of the call (or from
   * the page clock in a silent move). The picture uses this when it draws, so it follows the
   * sound however slowly frames are produced; tick() does the bookkeeping (segment hand-over,
   * buffering, the end).
   */
  now(): number {
    if (!this.wantPlay || this.ended || this.buffering) return this.t;
    const loc = locate(this.tl, this.t);
    if (loc.inGap || !this.audioOk) return Math.min(this.tl.duration, this.t + Math.max(0, (stageTime.now() - this.lastNow) / 1000) * this.rate);
    const el = this.els[this.active];
    if (!el || this.holds[this.active] !== loc.seg.index || el.paused || el.seeking) return this.t;
    return loc.seg.start + Math.min(loc.seg.dur, el.ended ? loc.seg.dur : el.currentTime);
  }

  /** Advance the clock; called every animation frame (and a few times a second when hidden). */
  tick(): void {
    const now = stageTime.now();
    const dt = Math.max(0, Math.min(0.25, (now - this.lastNow) / 1000));
    this.lastNow = now;
    if (!this.wantPlay || this.ended) return;
    const loc = locate(this.tl, this.t);
    const seg = loc.seg;
    const el = this.audioOk && !loc.inGap ? this.syncAudio(false) : null;
    if (el) {
      // The audio is the clock.
      const waiting = el.readyState < 3 || el.seeking || (el.paused && !el.ended);
      if (waiting) {
        if (!this.buffering) {
          this.buffering = true;
          this.changed();
        }
        if (el.paused && !el.seeking && el.readyState >= 3) el.play().catch(() => {});
        return;
      }
      if (this.buffering) {
        this.buffering = false;
        this.changed();
      }
      const at = el.ended ? seg.dur : Math.min(seg.dur, el.currentTime);
      this.t = seg.start + at;
      // past the end of the segment's audio: continue on the page clock into the gap
      if (el.ended || at >= seg.dur - 0.005) this.t = seg.start + seg.dur + 1e-4;
    } else {
      // Silent moves (and captions-only playback) run on the page clock.
      const before = this.t;
      this.t = Math.min(this.tl.duration, this.t + dt * this.rate);
      // entering the next segment: hand the clock to its audio at the right offset
      const next = locate(this.tl, this.t);
      if (this.audioOk && !next.inGap && next.seg.index !== seg.index && before < next.seg.start) this.syncAudio(true);
    }
    if (this.t >= this.tl.duration - 1e-3) {
      this.t = this.tl.duration;
      this.ended = true;
      this.wantPlay = false;
      this.stopTimer();
      this.changed();
    }
    this.preloadNext();
  }

  // ───────────────────────────── audio plumbing ─────────────────────────────

  /**
   * Make the element for the segment at the current time hold it, at the right position, and
   * playing if the film is playing. Returns that element (null in a gap or without audio).
   */
  private syncAudio(force: boolean): HTMLAudioElement | null {
    if (!this.audioOk || !this.els.length) return null;
    const loc = locate(this.tl, this.t);
    if (loc.inGap) {
      for (const el of this.els) if (!el.paused) el.pause();
      this.active = -1;
      return null;
    }
    const seg = loc.seg;
    let i = this.holds.indexOf(seg.index);
    if (i < 0) {
      i = this.active === 0 ? 1 : 0;
      this.load(i, seg.index);
      force = true;
    }
    const el = this.els[i];
    if (this.active !== i) {
      for (let k = 0; k < this.els.length; k++) if (k !== i) this.els[k].pause();
      this.active = i;
      force = true;
    }
    if (force) {
      const want = Math.max(0, this.t - seg.start);
      if (Math.abs(el.currentTime - want) > 0.03) {
        try {
          el.currentTime = want;
        } catch {
          /* not seekable yet: loadedmetadata will allow it */
        }
      }
      el.playbackRate = this.rate;
      el.volume = this.volume;
      el.muted = this.muted;
      if (this.wantPlay) el.play().catch((e: unknown) => this.blocked(e));
      else el.pause();
    }
    return el;
  }

  private load(i: number, segIndex: number): void {
    const el = this.els[i];
    this.holds[i] = segIndex;
    el.src = this.base + this.tl.segments[segIndex].file;
    el.load();
  }

  /** Load the next segment into the idle element shortly before it is needed. */
  private preloadNext(): void {
    if (!this.audioOk || this.els.length < 2) return;
    const loc = locate(this.tl, this.t);
    const next = this.tl.segments[loc.seg.index + (loc.inGap || this.t > loc.seg.start + loc.seg.dur - 4 ? 1 : 0)];
    if (!next || this.holds.includes(next.index)) return;
    const idle = this.active === 0 ? 1 : 0;
    if (this.holds[idle] === loc.seg.index && !loc.inGap) return;
    this.load(idle, next.index);
  }

  private fail(el: HTMLAudioElement): void {
    if (!el.src || el.src.startsWith('data:')) return;
    this.audioOk = false;
    this.audioError = 'The narration audio could not be loaded.';
    this.buffering = false;
    for (const e of this.els) e.pause();
    this.lastNow = stageTime.now();
    this.changed();
  }

  private blocked(e: unknown): void {
    // Autoplay refused (no user gesture yet): stop and let the viewer press play.
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      this.wantPlay = false;
      this.buffering = false;
      this.changed();
    }
  }

  private startTimer(): void {
    if (this.timer !== null || typeof window === 'undefined') return;
    // A background tab gets no animation frames; keep the clock (and segment hand-over) going.
    this.timer = window.setInterval(() => {
      if (document.hidden) this.tick();
    }, 250);
  }

  private stopTimer(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private changed(): void {
    this.onChange();
  }
}
