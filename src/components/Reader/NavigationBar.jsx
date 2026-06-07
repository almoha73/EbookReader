// src/components/Reader/NavigationBar.jsx
import { useReaderStore } from '../../store/readerStore';

export default function NavigationBar({ title, chapter, onSettings, showSettings, onToggleToc, showToc, onSaveBookmark }) {
  const { closeBook, totalLocations, currentLocation, preferences, setPreference } = useReaderStore();

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
          <div className="progress-track" title={`${progress}% lu sur l'ensemble du livre`}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-label">{progress}%</span>
        </div>
      )}

      {/* Bouton sauvegarder marque-page */}
      <button
        onClick={onSaveBookmark}
        className="btn-icon ml-auto mr-2"
        title="Sauvegarder un signet"
        aria-label="Sauvegarder"
        id="save-bookmark-btn"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* Raccourci Chapitres (TOC) */}
      <button
        onClick={onToggleToc}
        className={`btn-icon mr-2 ${showToc ? 'active text-blue-400' : ''}`}
        title="Table des Matières"
        aria-label="Chapitres"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/>
          <line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/>
          <line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      </button>

      {/* Bouton Mode Audio / Lecture seule */}
      <button
        onClick={() => setPreference('audioMode', !preferences.audioMode)}
        className={`btn-icon mr-2 ${preferences.audioMode ? 'active text-blue-400' : ''}`}
        title={preferences.audioMode ? "Désactiver le Mode Audio (Lecture seule)" : "Activer le Mode Audio"}
        aria-label="Mode Audio"
        id="audio-mode-btn"
      >
        {preferences.audioMode ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        )}
      </button>

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
