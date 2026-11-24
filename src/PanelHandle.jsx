import React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

export default function PanelHandle({ edge, open, label, onClick, style }) {
  const horizontal = edge === 'top';
  let Arrow = ChevronLeft;
  if (horizontal && open) {
    Arrow = ChevronUp;
  } else if (horizontal) {
    Arrow = ChevronDown;
  } else if (edge === 'left' && !open) {
    Arrow = ChevronRight;
  } else if (edge !== 'left' && open) {
    Arrow = ChevronRight;
  }

  let verb = 'Show';
  if (open) {
    verb = 'Hide';
  }
  const action = `${verb} ${label}`;
  let viewBox = '0 0 24 96';
  let path = 'M0 0 C0 24 23 20 23 48 C23 76 0 72 0 96 Z';
  if (horizontal) {
    viewBox = '0 0 96 24';
    path = 'M0 0 C24 0 20 23 48 23 C76 23 72 0 96 0 Z';
  }
  return (
    <button
      className={`panel-handle panel-handle-${edge}`}
      style={style}
      onClick={onClick}
      type="button"
      aria-label={action}
      aria-expanded={open}
      title={action}
    >
      <svg
        className="panel-handle-shape"
        viewBox={viewBox}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
      <Arrow size={11} aria-hidden="true" />
    </button>
  );
}
