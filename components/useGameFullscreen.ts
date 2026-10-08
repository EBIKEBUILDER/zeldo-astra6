'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Native fullscreen when available, with the same uncluttered layout on iOS. */
export function useGameFullscreen() {
  const shell = useRef<HTMLDivElement>(null);
  const native = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const changed = () => {
      if (native.current && document.fullscreenElement !== shell.current) {
        native.current = false;
        setFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const enter = useCallback(async () => {
    setFullscreen(true);
    if (!shell.current?.requestFullscreen) return;
    native.current = true;
    try { await shell.current.requestFullscreen({ navigationUI: 'hide' }); }
    catch { native.current = false; /* The header-free view also works without native fullscreen. */ }
  }, []);

  const exit = useCallback(async () => {
    if (document.fullscreenElement === shell.current && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { /* Keep the exit control available if the browser refuses. */ }
      if (document.fullscreenElement === shell.current) return;
    }
    native.current = false;
    setFullscreen(false);
  }, []);

  return { shell, fullscreen, enter, exit };
}
