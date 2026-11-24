import React, { useEffect, useState } from 'react';
import { Palette, X, Check, Moon, Sun } from 'lucide-react';
import './appearance.css';
import { THEMES, FONTS, fontStack, DEFAULT_THEME, DEFAULT_FONT } from './appearanceSettings.js';
import { useAppearance } from './useAppearance.js';

export default function Appearance({ embedded = false, hidden = false }) {
  const getEmbeddedClassName = () => {
    if (embedded) {
      return ' embedded';
    }
    return '';
  };

  const getEmbeddedRole = () => {
    if (embedded) {
      return 'region';
    }
    return 'dialog';
  };

  const renderTabFonts = () => {
    if (tab === 'fonts') {
      return (
        <div role="tabpanel" id="appearance-fonts" aria-labelledby="font-tab">
          <div className="font-preview-sentence">
            <strong>{FONTS[choice.font]}</strong>
            <p>A clearer way to read, think, and connect ideas.</p>
            <span>0123456789 · Aa Bb Cc · α β θ</span>
          </div>
          <div className="font-choice-grid">
            {Object.entries(FONTS).map(([id, name]) => {
              const getChoiceFontIdClassName = () => {
                if (choice.font === id) {
                  return 'selected';
                }
                return '';
              };
              return (
                <button
                  key={id}
                  className={`font-choice ${getChoiceFontIdClassName()}`}
                  aria-pressed={choice.font === id}
                  onClick={() => setChoice((current) => ({ ...current, font: id }))}
                  style={{ fontFamily: fontStack(id) }}
                >
                  <span>Aa</span>
                  <strong>{name}</strong>
                  {choice.font === id && <Check size={13} />}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    return (
      <div
        className="appearance-grid"
        role="tabpanel"
        id="appearance-colors"
        aria-labelledby="color-tab"
      >
        {THEMES.map((itemTheme) => {
          const getThemeIdItemThemeIdClassName = () => {
            if (theme.id === itemTheme.id) {
              return 'selected';
            }
            return '';
          };
          return (
            <button
              key={itemTheme.id}
              className={`appearance-card ${getThemeIdItemThemeIdClassName()}`}
              aria-pressed={theme.id === itemTheme.id}
              onClick={() =>
                setChoice((current) => {
                  const getItemThemeIdMidnightOnClick = () => {
                    if (itemTheme.id === 'midnight') {
                      return 'dark';
                    }
                    return 'light';
                  };

                  const getItemThemeIdMidnightOnClick2 = () => {
                    if (itemTheme.id === 'midnight') {
                      return true;
                    }
                    return current.pdfDark;
                  };

                  const getItemThemeIdMidnightOnClick3 = () => {
                    if (itemTheme.id === 'midnight') {
                      return current.lightTheme;
                    }
                    return itemTheme.id;
                  };
                  return {
                    ...current,
                    theme: itemTheme.id,
                    mode: getItemThemeIdMidnightOnClick(),
                    pdfDark: getItemThemeIdMidnightOnClick2(),
                    lightTheme: getItemThemeIdMidnightOnClick3(),
                  };
                })
              }
              style={{
                '--card-accent': itemTheme.accent,
                '--card-bg': itemTheme.bg,
                '--card-panel': itemTheme.panel,
                '--card-ink': itemTheme.ink,
                '--card-font': `"${FONTS[choice.font]}"`,
              }}
            >
              <div className="appearance-mini">
                <aside>
                  <i />
                  <i />
                  <i />
                </aside>
                <div>
                  <span>Read deeper.</span>
                  <em>A little more clarity.</em>
                  <b>
                    Explain passage <span>↗</span>
                  </b>
                </div>
                {theme.id === itemTheme.id && <Check size={15} className="appearance-check" />}
              </div>
              <strong>{itemTheme.name}</strong>
              <small>{itemTheme.note.split(' · ').slice(0, 2).join(' · ')}</small>
            </button>
          );
        })}
      </div>
    );
  };

  const renderEmbedded = () => {
    if (embedded) {
      return (
        <span className="appearance-applied">
          <Check size={14} /> Changes apply immediately
        </span>
      );
    }
    return (
      <button onClick={() => setOpen(false)}>
        Keep this look <Check size={14} />
      </button>
    );
  };

  const [open, setOpen] = useState(embedded);
  const [tab, setTab] = useState('fonts');
  const { choice, setChoice, theme } = useAppearance();
  useEffect(() => {
    if (!open || embedded) {
      return;
    }
    const close = (event) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [open]);
  return (
    <>
      {!embedded && !hidden && (
        <button
          className="icon-button appearance-trigger"
          title="Try fonts and colors"
          aria-label="Appearance"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Palette size={18} />
        </button>
      )}
      {open && !hidden && (
        <section
          className={`appearance-gallery${getEmbeddedClassName()}`}
          role={getEmbeddedRole()}
          aria-label="Appearance preview"
        >
          <header>
            <div>
              <h2>Appearance</h2>
            </div>
            {!embedded && (
              <button
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="Close appearance"
              >
                <X size={19} />
              </button>
            )}
          </header>
          <div className="appearance-mode-row">
            <label htmlFor="color-mode">Color mode</label>
            <select
              id="color-mode"
              value={choice.mode}
              onChange={(event) =>
                setChoice((current) => {
                  const getEventTargetValueLightOnChange = () => {
                    if (event.target.value === 'light') {
                      return current.pdfDark;
                    }
                    return true;
                  };
                  return {
                    ...current,
                    mode: event.target.value,
                    pdfDark: getEventTargetValueLightOnChange(),
                  };
                })
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
          <label className="pdf-dark-option">
            <input
              type="checkbox"
              checked={choice.pdfDark}
              onChange={(event) =>
                setChoice((current) => ({ ...current, pdfDark: event.target.checked }))
              }
            />{' '}
            Dark PDF pages in dark mode
          </label>
          <p>Font and color choices are saved on this computer.</p>
          <div className="appearance-tabs" role="tablist" aria-label="Appearance options">
            <button
              role="tab"
              aria-selected={tab === 'fonts'}
              aria-controls="appearance-fonts"
              id="font-tab"
              onClick={() => setTab('fonts')}
            >
              Fonts · {Object.keys(FONTS).length}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'colors'}
              aria-controls="appearance-colors"
              id="color-tab"
              onClick={() => setTab('colors')}
            >
              Colors · {THEMES.length}
            </button>
          </div>
          {renderTabFonts()}
          <p className="appearance-footnote">
            Saved on this computer. PDF darkening is display-only; exports keep the original colors.
          </p>
          <footer>
            <button
              onClick={() =>
                setChoice({
                  theme: DEFAULT_THEME,
                  lightTheme: DEFAULT_THEME,
                  font: DEFAULT_FONT,
                  mode: 'light',
                  pdfDark: true,
                })
              }
            >
              Reset appearance
            </button>
            {renderEmbedded()}
          </footer>
        </section>
      )}
    </>
  );
}

export function DarkModeButton() {
  const getDarkTitle = () => {
    if (dark) {
      return 'Switch to light mode';
    }
    return 'Switch to dark mode';
  };

  const getDarkAriaLabel = () => {
    if (dark) {
      return 'Switch to light mode';
    }
    return 'Switch to dark mode';
  };

  const renderDark = () => {
    if (dark) {
      return <Sun size={18} />;
    }
    return <Moon size={18} />;
  };

  const { choice, setChoice, theme } = useAppearance();
  const dark = theme.id === 'midnight';
  return (
    <button
      className="icon-button"
      title={getDarkTitle()}
      aria-label={getDarkAriaLabel()}
      aria-pressed={dark}
      onClick={() => {
        const getDarkOnClick = () => {
          if (dark) {
            return 'light';
          }
          return 'dark';
        };

        const getDarkOnClick2 = () => {
          if (dark) {
            return choice.pdfDark;
          }
          return true;
        };
        return setChoice({
          ...choice,
          mode: getDarkOnClick(),
          pdfDark: getDarkOnClick2(),
        });
      }}
    >
      {renderDark()}
    </button>
  );
}
