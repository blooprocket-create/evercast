import type { IconName } from './names';

/**
 * Stroke icons on a 24px grid, drawn inline so they inherit `currentColor`
 * and stay crisp at any size. There are no icon assets in the repo; `public/`
 * holds only .glb models for the renderer.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  character: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c0-4.2 3.4-6.5 7.5-6.5s7.5 2.3 7.5 6.5" />
    </>
  ),
  spellTree: (
    <>
      <path d="M12 21V9" />
      <path d="M12 9 6 4" />
      <path d="m12 12 6-5" />
      <circle cx="12" cy="7" r="2" />
      <circle cx="5" cy="3.5" r="1.6" />
      <circle cx="19" cy="6" r="1.6" />
    </>
  ),
  gear: (
    <>
      <path d="M12 3l7.5 4v6.5c0 4.2-3.8 6.4-7.5 7.5-3.7-1.1-7.5-3.3-7.5-7.5V7Z" />
      <path d="M12 3v18" />
    </>
  ),
  gearTree: (
    <>
      <path d="M4 20V8M10 20V4M16 20v-9M4 20h16" />
    </>
  ),
  rebirth: (
    <>
      <path d="M12 4a8 8 0 1 0 8 8" />
      <path d="M12 4v8l6 3" />
    </>
  ),
  automation: (
    <>
      <path d="M6 4v16M18 4v16M6 9h12M6 15h12" />
    </>
  ),
  audio: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
      <path d="M15.8 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path d="M18.6 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  bestiary: (
    <>
      <path d="M5 5h14v14H5z" />
      <path d="M9 10h6M9 14h6" />
    </>
  ),
  story: (
    <>
      <path d="M5 4h9l5 5v11H5z" />
      <path d="M14 4v5h5" />
    </>
  ),
  achievements: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="m9 14-2 7 5-3 5 3-2-7" />
    </>
  ),
  statistics: (
    <>
      <path d="m4 20 5-7 4 4 7-11" />
    </>
  ),
  collection: (
    <>
      <path d="M4 7h16v13H4z" />
      <path d="M7 7V4h10v3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  slotHelm: (
    <>
      <path d="M6 20V9a6 6 0 0 1 12 0v11" />
      <path d="M6 14h12" />
    </>
  ),
  slotStaff: (
    <>
      <path d="M12 8v13" />
      <circle cx="12" cy="5" r="3" />
    </>
  ),
  slotSpellbook: (
    <>
      <path d="M5 5h9l5 5v9H5z" />
      <path d="M14 5v5h5" />
      <path d="M8 13h6" />
    </>
  ),
  slotRobe: (
    <>
      <path d="m8 4 4 3 4-3 3 4-3 3v9H8v-9L5 8z" />
    </>
  ),
  slotBoots: (
    <>
      <path d="M6 5h5l1 8 6 3v3H6z" />
    </>
  ),
  slotNecklace: (
    <>
      <path d="M6 4a6 8 0 0 0 12 0" />
      <path d="m12 12 2.5 3-2.5 3-2.5-3z" />
    </>
  ),
  slotRing: (
    <>
      <circle cx="12" cy="14" r="6" />
      <path d="m9 8 3-4 3 4" />
    </>
  ),
  /* Two figures: the party, rather than the single figure `character` uses. */
  companions: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-5.2 5.5-5.2s5.5 1.9 5.5 5.2" />
      <path d="M16 6.2a3 3 0 0 1 0 5.8" />
      <path d="M17.2 14.4c2 .7 3.3 2.4 3.3 4.7" />
    </>
  ),
  /* Three marks in formation: who stands where. */
  party: (
    <>
      <path d="M12 3.2 14.4 8h-4.8Z" />
      <circle cx="5.6" cy="14" r="2.4" />
      <circle cx="18.4" cy="14" r="2.4" />
      <circle cx="12" cy="19.2" r="2.4" />
    </>
  ),
  /* A star pulled out of a gate: the draw. */
  summon: (
    <>
      <path d="m12 3 1.9 4.2L18.5 8l-3.4 3.2.9 4.6L12 13.6 8 15.8l.9-4.6L5.5 8l4.6-.8Z" />
      <path d="M6 19.5h12" />
    </>
  ),
  classVanguard: (
    <>
      <path d="M12 3.2 19 6v6.2c0 4-3.4 6.2-7 7.3-3.6-1.1-7-3.3-7-7.3V6Z" />
      <path d="M12 8.5v6" />
    </>
  ),
  classBruiser: (
    <>
      <path d="M4.5 19.5 15 9" />
      <path d="m13 5.5 5.5 5.5-2.6 2.6L10.4 8Z" />
      <path d="m4 17.5 2.5 2.5" />
    </>
  ),
  classTrickster: (
    <>
      <path d="M5 5.5 14.5 15" />
      <path d="M19 5.5 9.5 15" />
      <circle cx="7.5" cy="17.5" r="2.2" />
      <circle cx="16.5" cy="17.5" r="2.2" />
    </>
  ),
  classRanger: (
    <>
      <path d="M5 19 19 5" />
      <path d="M13.5 5H19v5.5" />
      <path d="M7.5 6.5a8.5 8.5 0 0 1 0 11" />
    </>
  ),
  classArcanist: (
    <>
      <circle cx="12" cy="9" r="4.2" />
      <path d="M12 13.2V21" />
      <path d="M9 17.5h6" />
    </>
  ),
  classSupport: (
    <>
      <path d="M12 20.5S4.5 15.8 4.5 10.4A4.2 4.2 0 0 1 12 7.8a4.2 4.2 0 0 1 7.5 2.6c0 5.4-7.5 10.1-7.5 10.1Z" />
    </>
  ),
  /* A struck coin: a disc with a rim and a mark. */
  gold: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  /* A stoppered flask - Arcane Essence is decanted, not minted. */
  essence: (
    <>
      <path d="M10 3.5h4" />
      <path d="M10.8 3.5v5.2L6.6 16a3.2 3.2 0 0 0 2.8 4.8h5.2a3.2 3.2 0 0 0 2.8-4.8l-4.2-7.3V3.5" />
      <path d="M8.2 14.6h7.6" />
    </>
  ),
  /* A four-pointed spark, distinct from the five-pointed summon star. */
  starlight: (
    <>
      <path d="M12 3.5c0 4.7 1.8 6.5 6.5 6.5-4.7 0-6.5 1.8-6.5 6.5 0-4.7-1.8-6.5-6.5-6.5 4.7 0 6.5-1.8 6.5-6.5Z" />
      <path d="M17.5 16.2v4M15.5 18.2h4" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 20, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
