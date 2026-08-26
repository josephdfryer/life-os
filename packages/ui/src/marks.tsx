// Still — LifeOS brand marks
//
// The identity system as React. Every mark is drawn on the same 100×100 grid
// and paints with `currentColor`, so a mark takes the color of whatever it sits
// in — cognac on cream, camel on petrol, ink when the surface is undecided.
// Set the color on the element or a parent; never hard-code a hex here.
//
// Canonical SVG source lives in `packages/ui/brand/`. These components are the
// hand-maintained mirror of those files — if a mark changes there, change it
// here in the same commit.

import React from 'react';

export interface MarkProps extends Omit<React.SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'> {
  /** Rendered edge length in px. The grid is square, so one number is enough. */
  size?: number;
  /** Accessible name. Omit for decorative marks — they get aria-hidden. */
  title?: string;
}

function Mark({ size = 20, title, children, ...rest }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ---------------------------------------------------------------- master --- */

/**
 * The LifeOS mark. Four filled nodes around one open center — the graph, and
 * the gap at its middle where the derived reading lives.
 */
export function LifeOSMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <g fill="currentColor">
        <circle cx="22" cy="22" r="11" />
        <circle cx="78" cy="22" r="11" />
        <circle cx="22" cy="78" r="11" />
        <circle cx="78" cy="78" r="11" />
      </g>
      <circle cx="50" cy="50" r="13" stroke="currentColor" strokeWidth="6" />
    </Mark>
  );
}

/**
 * The master mark with the optical corrections for small sizes: nodes pushed
 * to the corners and every weight thickened. Use below ~24px — favicons, dense
 * table rows, anywhere the standard mark would silt up.
 */
export function LifeOSMarkSmall(props: MarkProps) {
  return (
    <Mark {...props}>
      <g fill="currentColor">
        <circle cx="20" cy="20" r="13" />
        <circle cx="80" cy="20" r="13" />
        <circle cx="20" cy="80" r="13" />
        <circle cx="80" cy="80" r="13" />
      </g>
      <circle cx="50" cy="50" r="15" stroke="currentColor" strokeWidth="8" />
    </Mark>
  );
}

/* ------------------------------------------------------------------ apps --- */

/** Home — the control plane. The master mark itself; Home is the whole graph. */
export const HomeMark = LifeOSMark;

/** Persons — two overlapping circles. The intersection is the relationship. */
export function PersonsMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="36" cy="50" r="26" stroke="currentColor" strokeWidth="6" />
      <circle cx="64" cy="50" r="26" stroke="currentColor" strokeWidth="6" />
    </Mark>
  );
}

/** Places — nested rings. Earth → country → city → room → shelf, one hierarchy. */
export function PlacesMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="50" cy="50" r="36" stroke="currentColor" strokeWidth="5" />
      <circle cx="50" cy="50" r="21" stroke="currentColor" strokeWidth="5" />
      <circle cx="50" cy="50" r="9" fill="currentColor" />
    </Mark>
  );
}

/** Stuff — a bounded frame holding one owned thing. */
export function StuffMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="14" y="14" width="72" height="72" rx="18" stroke="currentColor" strokeWidth="6" />
      <circle cx="50" cy="58" r="14" fill="currentColor" />
    </Mark>
  );
}

/**
 * Events — the record and the prediction on one edge. Solid node is what
 * happened; the open node is the Plan not yet fulfilled.
 */
export function EventsMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="24" cy="50" r="14" fill="currentColor" />
      <line x1="38" y1="50" x2="62" y2="50" stroke="currentColor" strokeWidth="5" />
      <circle cx="76" cy="50" r="14" stroke="currentColor" strokeWidth="6" />
    </Mark>
  );
}

/** Level Up — three nodes growing along one axis. The band, not the flex. */
export function LevelUpMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <g fill="currentColor">
        <circle cx="16" cy="50" r="8" />
        <circle cx="46" cy="50" r="12" />
        <circle cx="82" cy="50" r="16" />
      </g>
    </Mark>
  );
}

/**
 * Assistant — the counsel. A path crossing the declared axis: the tension
 * layer read out loud. Not a speech bubble.
 */
export function AssistantMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <line x1="50" y1="10" x2="50" y2="90" stroke="currentColor" strokeWidth="3" />
      <line x1="20" y1="72" x2="80" y2="28" stroke="currentColor" strokeWidth="5" />
      <g fill="currentColor">
        <circle cx="18" cy="74" r="10" />
        <circle cx="50" cy="50" r="10" />
        <circle cx="82" cy="26" r="10" />
      </g>
    </Mark>
  );
}

/* -------------------------------------------------------------- alphabet --- */

/** Site — a resolved entity. The filled node. */
export function GlyphSite(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="50" cy="50" r="24" fill="currentColor" />
    </Mark>
  );
}

/** Vacancy — an entity declared but not yet met by evidence. The open node. */
export function GlyphVacancy(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="50" cy="50" r="24" stroke="currentColor" strokeWidth="6" />
    </Mark>
  );
}

/** Bond — the Interaction edge. The one connector in the whole model. */
export function GlyphBond(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="24" cy="50" r="12" fill="currentColor" />
      <line x1="36" y1="50" x2="64" y2="50" stroke="currentColor" strokeWidth="5" />
      <circle cx="76" cy="50" r="12" fill="currentColor" />
    </Mark>
  );
}

/** Frame — containment. A thing held inside a bounded place. */
export function GlyphFrame(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="14" y="14" width="72" height="72" rx="18" stroke="currentColor" strokeWidth="6" />
      <circle cx="50" cy="58" r="12" fill="currentColor" />
    </Mark>
  );
}

/** Boundary — the declared axis. What was said, against which behavior is read. */
export function GlyphBoundary(props: MarkProps) {
  return (
    <Mark {...props}>
      <line x1="50" y1="12" x2="50" y2="88" stroke="currentColor" strokeWidth="3" />
    </Mark>
  );
}

/* -------------------------------------------------------------- dispatch --- */

import type { LifeOSAppKey } from './app-registry';

export const APP_MARKS: Record<LifeOSAppKey, (props: MarkProps) => React.JSX.Element> = {
  home: HomeMark,
  persons: PersonsMark,
  places: PlacesMark,
  stuff: StuffMark,
  events: EventsMark,
  assistant: AssistantMark,
  levelUp: LevelUpMark,
};

export interface AppMarkProps extends MarkProps {
  app: LifeOSAppKey;
}

/** Renders whichever app mark the key names. */
export function AppMark({ app, ...rest }: AppMarkProps) {
  const Component = APP_MARKS[app] ?? LifeOSMark;
  return <Component {...rest} />;
}
