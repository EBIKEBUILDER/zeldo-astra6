import type { CSSProperties } from 'react';
export function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const paths: Record<string, React.ReactNode> = {
    expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></>,
    contract: <><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/></>,
    satchel: <><path d="M5 8h14l2 12H3Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2M4 12l8 3 8-3"/><path d="M10 13v4h4v-4"/></>,
    flame: <><path d="M12 2c1 5-5 7-5 12a5 5 0 0 0 10 0c0-3-2-5-3-7 0 3-1 4-2 5 1-4 1-6 0-10Z"/><path d="M12 13c-2 2-3 3-2 5 1 2 4 1 4-1 0-1-1-2-2-4Z"/></>,
    sword: <><path d="m14 4 6-1-1 6-9 9-4-4Z"/><path d="m4 12 8 8M4 20l4-4M3 21l2-2"/></>,
    sound: <><path d="m11 5-5 4H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></>,
    mute: <><path d="m11 5-5 4H3v6h3l5 4Z"/><path d="m16 9 5 6m0-6-5 6"/></>,
    book: <><path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v15M5 8h4M15 8h4M5 12h4M15 12h4"/></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    heart: <path d="M20.8 4.6c-2.1-2.2-5.6-2.2-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
    gem: <><path d="m12 2 6 5v10l-6 5-6-5V7Z"/><path d="m12 2-2 6v8l2 6m-6-15 4 1h8m-12 9 4-1h8"/></>,
    pin: <><path d="M19 9c0 6-7 12-7 12S5 15 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2.5"/></>,
    reset: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/></>,
    key: <><circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-6-6 3-3m0 6 3-3"/></>,
    check: <path d="m5 12 4 4L20 5"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v2M12 21v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    leaf: <><path d="M20 3C5 1 1 12 7 17S21 15 20 3Z"/><path d="M4 21 16 8M8 16l-1-5m5 1 5 1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name] || paths.flame}</svg>;
}
