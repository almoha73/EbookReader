// src/components/Library/BookCard.jsx
import { useState } from 'react';
import { useReaderStore } from '../../store/readerStore';
import { loadProgress } from '../../utils/storage';

export default function BookCard({ book, onOpen, onRemove }) {
  const [hovered, setHovered] = useState(false);
  const savedCfi = loadProgress(book.id);
  const hasProgress = !!savedCfi;

  return (
    <div
      className="book-card glass-card flex flex-col overflow-hidden group animate-fade-in relative cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(book)}
    >
      {/* Couverture */}
      <div
        className="relative aspect-[2/3] w-full flex items-center justify-center overflow-hidden"
        style={{
          background: book.coverUrl
            ? 'transparent'
            : `linear-gradient(135deg, hsl(${book._hue || 220}, 60%, 25%), hsl(${(book._hue || 220) + 40}, 50%, 15%))`
        }}
      >
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={`Couverture: ${book.title}`}
            className="w-full h-full object-cover shadow-inner"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-white/60 drop-shadow-md">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
            </svg>
            <p className="text-sm font-semibold text-white/80 line-clamp-4 font-display leading-snug drop-shadow-sm">{book.title}</p>
          </div>
        )}

        {/* Badge "En cours" */}
        {hasProgress && (
          <div className="absolute top-2 right-2 bg-brand-500/90 text-white text-xs font-bold px-2 py-0.5 rounded-full z-10 shadow-md">
            En cours
          </div>
        )}

        {/* Bouton de suppression (toujours accessible) */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(book.id); }}
          className="absolute top-2 left-2 bg-dark-900/60 hover:bg-accent-500/90 text-white rounded-full w-7 h-7 flex items-center justify-center backdrop-blur-md z-10 transition-colors opacity-80 hover:opacity-100 shadow-md"
          title="Supprimer"
        >
          ✕
        </button>

        {/* Overlay au survol (caché sur mobile car clic direct) */}
        <div className={`hidden sm:flex absolute inset-0 bg-dark-900/70 items-center justify-center transition-opacity duration-300 pointer-events-none ${hovered ? 'opacity-100' : 'opacity-0'}`}>
          <div className="btn-primary text-sm px-4 py-2 pointer-events-auto">
            {hasProgress ? '▶ Reprendre' : '📖 Lire'}
          </div>
        </div>
      </div>

      {/* Métadonnées */}
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-white line-clamp-2 font-display leading-tight">
          {book.title}
        </h3>
        <p className="text-xs text-white/70 mt-1 truncate">
          {book.author || 'Auteur inconnu'}
        </p>
        <div className="mt-auto pt-2">
          <p className="text-xs text-white/50">
            {new Date(book.addedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </p>
        </div>
      </div>
    </div>
  );
}
