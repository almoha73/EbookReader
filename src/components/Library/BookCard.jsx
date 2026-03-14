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
      className="book-card glass-card flex flex-col overflow-hidden group animate-fade-in"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Couverture */}
      <div
        className="relative h-52 flex items-center justify-center overflow-hidden"
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
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <span className="text-5xl">📖</span>
            <p className="text-sm font-medium text-white/70 line-clamp-3">{book.title}</p>
          </div>
        )}

        {/* Badge "En cours" */}
        {hasProgress && (
          <div className="absolute top-2 right-2 bg-brand-500/90 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            En cours
          </div>
        )}

        {/* Overlay au survol */}
        <div className={`absolute inset-0 bg-dark-900/70 flex items-center justify-center gap-3 transition-opacity duration-300 ${hovered ? 'opacity-100' : 'opacity-0'}`}>
          <button
            onClick={() => onOpen(book)}
            className="btn-primary text-sm px-4 py-2"
            id={`open-book-${book.id}`}
          >
            {hasProgress ? '▶ Reprendre' : '📖 Lire'}
          </button>
          <button
            onClick={() => onRemove(book.id)}
            className="btn-ghost text-xs px-3 py-2 text-accent-400"
            id={`remove-book-${book.id}`}
            title="Supprimer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Métadonnées */}
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-white line-clamp-2 font-display leading-tight">
          {book.title}
        </h3>
        <p className="text-xs text-dark-400 mt-1 truncate">
          {book.author || 'Auteur inconnu'}
        </p>
        <div className="mt-auto pt-2">
          <p className="text-xs text-dark-500">
            {new Date(book.addedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </p>
        </div>
      </div>
    </div>
  );
}
