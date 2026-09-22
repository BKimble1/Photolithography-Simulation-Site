/// <reference lib="webworker" />
import { Engine } from './engine';
import type { Choices } from './types';
import { computeWaferMap } from './waferMap';

const engine = new Engine(48);

self.onmessage = (e: MessageEvent<{ id: number; choices: Choices }>) => {
  const { id, choices } = e.data;
  const result = computeWaferMap(engine, choices);
  (self as unknown as Worker).postMessage({ id, result });
};
