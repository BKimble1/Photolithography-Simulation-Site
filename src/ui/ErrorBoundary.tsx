import { Component, type ReactNode } from 'react';

/** Renders `fallback` instead of crashing the page when a subtree throws (e.g. no WebGL). */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('3D view unavailable, using the 2D fallback:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** True when the browser can create a WebGL context (checked once). */
export const HAS_WEBGL: boolean = (() => {
  try {
    if (new URLSearchParams(window.location.search).get('flat') === '1') return false;
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
})();
