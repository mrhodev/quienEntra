/** Íconos de trazo (estilo Fantasy, sin emojis). Heredan el color del texto. */

export type IconName =
  | "ball"
  | "swap"
  | "glove"
  | "injury"
  | "undo"
  | "people"
  | "chart"
  | "settings"
  | "check"
  | "arrowRight"
  | "sync"
  | "offline"
  | "pause"
  | "play"
  | "share"
  | "clock";

const PATHS: Record<IconName, React.ReactNode> = {
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l4 3-1.5 5h-5L8 10z" />
    </>
  ),
  swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  glove: (
    <path d="M7 11V6a1.5 1.5 0 013 0v4m0-5a1.5 1.5 0 013 0v5m0-4a1.5 1.5 0 013 0v5m0-2a1.5 1.5 0 013 0v4a7 7 0 01-7 7h-1a7 7 0 01-6-3.4L4 13a1.5 1.5 0 012.6-1.5L7 12" />
  ),
  injury: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <path d="M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  check: <path d="M5 12l5 5L20 7" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  sync: <path d="M20 11a8 8 0 00-14.3-4.9L4 8m0-4v4h4M4 13a8 8 0 0014.3 4.9L20 16m0 4v-4h-4" />,
  offline: <path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015.5-2.8M19 13a10 10 0 00-3-2M2 9.3A15 15 0 016.6 6.5M22 9.3a15 15 0 00-9.6-4.3" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  share: <path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export function Icon({ name, size = 22, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
