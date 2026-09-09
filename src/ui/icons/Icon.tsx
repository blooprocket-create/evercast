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
