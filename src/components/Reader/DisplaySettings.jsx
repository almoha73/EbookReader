// src/components/Reader/DisplaySettings.jsx
// Contrôles d'affichage : taille de police + couleur de surlignage

import { useReaderStore } from '../../store/readerStore';

const FONT_SIZES = [14, 16, 18, 20, 22, 24, 28];

const HIGHLIGHT_COLORS = [
  { label: 'Jaune', value: 'rgba(255, 214, 0, 0.5)' },
  { label: 'Vert menthe', value: 'rgba(63, 185, 80, 0.45)' },
  { label: 'Bleu ciel', value: 'rgba(88, 166, 255, 0.45)' },
  { label: 'Rose', value: 'rgba(255, 80, 150, 0.4)' },
  { label: 'Orange', value: 'rgba(255, 140, 0, 0.5)' },
  { label: 'Violet', value: 'rgba(188, 140, 255, 0.45)' },
];

export default function DisplaySettings({ onFontSizeChange, onHighlightColorChange }) {
  const { preferences, setPreference } = useReaderStore();

  const handleFontSize = (delta) => {
    const sizes = FONT_SIZES;
    const idx = sizes.indexOf(preferences.fontSize);
    const newIdx = Math.max(0, Math.min(sizes.length - 1, idx + delta));
    const newSize = sizes[newIdx];
    setPreference('fontSize', newSize);
    onFontSizeChange?.(newSize);
  };

  const handleHighlightColor = (color) => {
    setPreference('highlightColor', color);
    onHighlightColorChange?.(color);
    // Met à jour la variable CSS globale
    document.documentElement.style.setProperty('--highlight-color', color);
  };

  return (
    <div className="glass mx-2 mb-1 px-4 py-3 rounded-xl border border-white/5">
      <div className="flex flex-wrap gap-6 items-center">

        {/* Taille de police */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-dark-400 font-medium whitespace-nowrap">Taille</span>
          <button
            onClick={() => handleFontSize(-1)}
            className="btn-icon w-8 h-8 text-lg font-bold"
            title="Diminuer la police"
            aria-label="Diminuer la taille de police"
            id="font-decrease-btn"
          >
            A<sub style={{ fontSize: '0.6em' }}>−</sub>
          </button>
          <span className="text-sm text-white font-mono w-8 text-center">
            {preferences.fontSize}
          </span>
          <button
            onClick={() => handleFontSize(1)}
            className="btn-icon w-8 h-8 text-lg font-bold"
            title="Augmenter la police"
            aria-label="Augmenter la taille de police"
            id="font-increase-btn"
          >
            A<sup style={{ fontSize: '0.7em' }}>+</sup>
          </button>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-8 bg-white/10" />

        {/* Couleur de surlignage */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-dark-400 font-medium whitespace-nowrap">Surlignage</span>
          <div className="flex gap-2">
            {HIGHLIGHT_COLORS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => handleHighlightColor(value)}
                className="highlight-swatch relative group"
                style={{ background: value.replace(/[\d.]+\)$/, '0.9)') }}
                title={label}
                aria-label={`Couleur: ${label}`}
              >
                {preferences.highlightColor === value && (
                  <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-8 bg-white/10" />

        {/* Aperçu couleur active */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-400">Aperçu:</span>
          <span
            className="text-sm px-2 py-0.5 rounded"
            style={{ background: preferences.highlightColor }}
          >
            <span className="text-dark-800 font-medium">Texte</span>
          </span>
        </div>

      </div>
    </div>
  );
}
