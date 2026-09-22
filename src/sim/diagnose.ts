/**
 * Turns measurements and the electrical result into a plain-language diagnosis: what went
 * wrong, why, and which choice to restore. Every cause is detected from the simulated
 * geometry (residue, gate length, contact placement), not from the settings themselves.
 */

import type { ElectricalResult } from './electrical';
import { L_DRAWN, L_IDDQ } from './electrical';
import type { StepId } from './flow';
import type { GateMetrology, OverlayMeasurement } from './metrology';
import { CONTACT_LABELS, type ContactName } from './metrology';
import type { Choices } from './types';

export type CauseId = 'none' | 'residue' | 'short-gate' | 'long-gate' | 'overlay' | 'particle' | 'open' | 'other';

export interface Diagnosis {
  pass: boolean;
  cause: CauseId;
  headline: string;
  detail: string;
  /** Where to go to restore the default. */
  restoreStep?: StepId;
  restoreChoice?: keyof Choices;
  notes: string[];
}

export interface DiagnoseInput {
  electrical: ElectricalResult;
  gate: GateMetrology; // after gate etch
  resistResidue: number; // after develop
  overlay: OverlayMeasurement; // after contact develop
  /** Contacts found touching polysilicon in the finished die. */
  touching: ContactName[];
  choices: Choices;
}

export function diagnose(inp: DiagnoseInput): Diagnosis {
  const { electrical: e, gate, overlay, choices } = inp;
  const notes: string[] = [];
  const Ls = e.transistors.map((t) => t.length).filter((l) => Number.isFinite(l));
  const minL = Ls.length ? Math.min(...Ls) : NaN;
  const maxL = Ls.length ? Math.max(...Ls) : NaN;
  const touching = inp.touching.map((n) => ({ name: n, label: CONTACT_LABELS[n] }));
  const spinOff = Math.abs(choices.spin - 0.5) > 0.12;
  const litho: { step: StepId; choice: keyof Choices } =
    choices.dose !== 2 ? { step: 'expose', choice: 'dose' } : spinOff ? { step: 'coat', choice: 'spin' } : { step: 'expose', choice: 'dose' };

  if (Number.isFinite(maxL) && maxL > L_DRAWN * 1.2)
    notes.push(`Gates printed ${Math.round((maxL / L_DRAWN - 1) * 100)}% longer than designed: the transistors switch more slowly.`);
  if (Number.isFinite(minL) && minL < L_DRAWN * 0.9 && minL >= L_IDDQ)
    notes.push(`Gates printed ${Math.round((1 - minL / L_DRAWN) * 100)}% shorter than designed: faster, but leakier.`);
  if (overlay.ofMargin > 0.5 && overlay.ofMargin < 1)
    notes.push('Contacts landed off-centre but inside the safety margin, so they still connect.');

  if (e.pass) {
    return {
      pass: true,
      cause: 'none',
      headline: 'Works: output is the opposite of the input.',
      detail: 'Input low gives output high, input high gives output low, and it draws almost no current when idle.',
      notes,
    };
  }

  if (!e.wired) {
    return {
      pass: false,
      cause: 'open',
      headline: 'Not wired yet.',
      detail: 'The metal wiring that reaches the probe pads has not been built.',
      notes,
    };
  }

  if (gate.residue > 0.05) {
    return {
      pass: false,
      cause: 'residue',
      headline: 'Shorted: leftover polysilicon connects everything.',
      detail:
        'The developer did not fully clear the resist in the openings, so the etch could not remove the polysilicon there. The leftover film bridges the input to the source, drain and supplies.',
      restoreStep: litho.step,
      restoreChoice: litho.choice,
      notes,
    };
  }

  if (touching.length > 0 && e.shorts.some(([a, b]) => a === 'IN' || b === 'IN')) {
    const names = touching.map((c) => c.label.toLowerCase()).join(' and ');
    return {
      pass: false,
      cause: 'overlay',
      headline: 'Shorted: contacts touch the gates.',
      detail:
        overlay.ofMargin >= 1
          ? `The contact layer landed ${Math.abs(overlay.dx).toFixed(1)} units off target, more than the 4-unit margin. The ${names} contact${touching.length > 1 ? 's' : ''} now touch${touching.length > 1 ? '' : 'es'} a gate, tying the input to another node.`
          : `The contact layer landed ${Math.abs(overlay.dx).toFixed(1)} units off target — inside the margin on paper, but the gates printed wider than drawn and used up the rest. The ${names} contact${touching.length > 1 ? 's' : ''} now touch${touching.length > 1 ? '' : 'es'} a gate.`,
      restoreStep: 'contact-align',
      restoreChoice: 'overlay',
      notes,
    };
  }

  const punch = e.transistors.some((t) => t.punchThrough);
  if (punch || (Number.isFinite(minL) && minL < L_IDDQ)) {
    return {
      pass: false,
      cause: 'short-gate',
      headline: punch ? 'Fails: a gate is too short to switch off.' : 'Fails the leakage test: gates are too short.',
      detail: punch
        ? `The gates printed at ${Math.round((minL / L_DRAWN) * 100)}% of their designed length. Current flows straight under the gate even when it should be off.`
        : `The gates printed at ${Math.round((minL / L_DRAWN) * 100)}% of their designed length. The logic still flips, but the idle current (IDDQ) is above the limit.`,
      restoreStep: litho.step,
      restoreChoice: litho.choice,
      notes,
    };
  }

  return {
    pass: false,
    cause: 'other',
    headline: 'Fails the functional test.',
    detail: e.reasons[0] ?? 'The output does not follow the expected truth table.',
    notes,
  };
}
