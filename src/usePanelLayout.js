import { useEffect, useRef, useState } from 'react';

// Keep panel dragging, saved widths, and the reader's minimum space together.
export function usePanelLayout({ leftOpen, sidebarOpen }) {
  const [libraryWidth, setLibraryWidth] = useState(
    () => Number(localStorage.getItem('paperlens:libraryWidth')) || 255,
  );
  const [companionWidth, setCompanionWidth] = useState(
    () => Number(localStorage.getItem('paperlens:companionWidth')) || 420,
  );
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth);
  const resizePanel = useRef(null);
  useEffect(() => {
    localStorage.setItem('paperlens:libraryWidth', String(libraryWidth));
  }, [libraryWidth]);
  useEffect(() => {
    localStorage.setItem('paperlens:companionWidth', String(companionWidth));
  }, [companionWidth]);
  useEffect(() => {
    const move = (event) => {
      if (resizePanel.current === 'library')
        setLibraryWidth(Math.max(210, Math.min(440, event.clientX)));
      if (resizePanel.current === 'companion')
        setCompanionWidth(Math.max(310, Math.min(650, window.innerWidth - event.clientX)));
    };
    const finish = () => {
      resizePanel.current = null;
      document.body.classList.remove('resizing-panels');
    };
    const resize = () => setWorkspaceWidth(window.innerWidth);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const beginPanelResize = (panel, event) => {
    event.preventDefault();
    resizePanel.current = panel;
    document.body.classList.add('resizing-panels');
  };
  const docked = workspaceWidth > 750;
  const fittedLibraryWidth = docked
    ? Math.min(libraryWidth, Math.max(210, workspaceWidth - (sidebarOpen ? 310 : 0) - 240))
    : libraryWidth;
  const fittedCompanionWidth = docked
    ? Math.min(
        companionWidth,
        Math.max(310, workspaceWidth - (leftOpen ? fittedLibraryWidth : 0) - 240),
      )
    : companionWidth;
  return { fittedLibraryWidth, fittedCompanionWidth, beginPanelResize };
}
