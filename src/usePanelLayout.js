import { useEffect, useRef, useState } from 'react';

// Keep panel dragging, saved widths, and the reader's minimum space together.
export function usePanelLayout({ leftOpen, sidebarOpen }) {
  const [libraryWidth, setLibraryWidth] = useState(
    () => Number(localStorage.getItem('paperlens:libraryWidth')) || 320,
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
      if (resizePanel.current === 'library') {
        setLibraryWidth(Math.max(210, Math.min(440, event.clientX)));
      }
      if (resizePanel.current === 'companion') {
        setCompanionWidth(Math.max(310, Math.min(650, window.innerWidth - event.clientX)));
      }
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
  let chatMinimumWidth = 0;
  if (sidebarOpen) {
    chatMinimumWidth = 310;
  }
  let fittedLibraryWidth;
  if (docked) {
    fittedLibraryWidth = Math.min(
      libraryWidth,
      Math.max(210, workspaceWidth - chatMinimumWidth - 240),
    );
  } else {
    fittedLibraryWidth = libraryWidth;
  }
  let visibleLibraryWidth = 0;
  if (leftOpen) {
    visibleLibraryWidth = fittedLibraryWidth;
  }
  let fittedCompanionWidth;
  if (docked) {
    fittedCompanionWidth = Math.min(
      companionWidth,
      Math.max(310, workspaceWidth - visibleLibraryWidth - 240),
    );
  } else {
    fittedCompanionWidth = companionWidth;
  }
  return { fittedLibraryWidth, fittedCompanionWidth, beginPanelResize };
}
