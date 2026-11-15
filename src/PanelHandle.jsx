import React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

export default function PanelHandle({ edge, open, label, onClick, style }) {
  const horizontal = edge === 'top';
  const Arrow = horizontal
    ? open
      ? ChevronUp
      : ChevronDown
    : edge === 'left'
      ? open
        ? ChevronLeft
        : ChevronRight
      : open
        ? ChevronRight
        : ChevronLeft;
  const action = `${open ? 'Hide' : 'Show'} ${label}`;
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
        viewBox={horizontal ? '0 0 96 24' : '0 0 24 96'}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={
            horizontal
              ? 'M0 0 C24 0 20 23 48 23 C76 23 72 0 96 0 Z'
              : 'M0 0 C0 24 23 20 23 48 C23 76 0 72 0 96 Z'
          }
        />
      </svg>
      <Arrow size={11} aria-hidden="true" />
    </button>
  );
}
