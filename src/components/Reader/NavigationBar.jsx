// src/components/Reader/NavigationBar.jsx
import { useReaderStore } from '../../store/readerStore';

export default function NavigationBar({ title, chapter, onSettings, showSettings }) {
  const { closeBook, totalLocations, currentLocation } = useReaderStore();

  const progress = totalLocations > 0
    ? Math.round((currentLocation / totalLocations) * 100)
    : 0;

  return (
    <header className="reader-header">
      {/* Bouton retour */}
      <button
        onClick={closeBook}
        className="btn-icon"
        title="Retour à la bibliothèque"
        aria-label="Retour"
        id="back-to-library"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      {/* Titre + Chapitre */}
      <div className="header-title">
        <h1 className="book-title">{title}</h1>
        {chapter && <p className="chapter-name">{chapter}</p>}
      </div>

      {/* Progression */}
      {totalLocations > 0 && (
        <div className="progress-wrap">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-label">{progress}%</span>
        </div>
      )}

      {/* Bouton Paramètres */}
      <button
        onClick={onSettings}
        className={`btn-icon ${showSettings ? 'active' : ''}`}
        title="Paramètres d'affichage"
        aria-label="Paramètres"
        id="settings-btn"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </header>
  );
}
