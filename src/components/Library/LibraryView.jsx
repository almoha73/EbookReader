// src/components/Library/LibraryView.jsx
// Vue bibliothèque : grille des livres + import EPUB

import { useRef, useState } from 'react';
import { useReaderStore } from '../../store/readerStore';
import BookCard from './BookCard';
import ePub from 'epubjs';

export default function LibraryView() {
  const { books, addBook, removeBook, openBook, showToast } = useReaderStore();
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  // Génère une teinte de couleur déterministe depuis l'ID du livre
  const getHue = (id) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    return Math.abs(hash) % 360;
  };

  // Convertit une blob URL en base64 data URL (pour la persistance)
  const blobUrlToBase64 = async (blobUrl) => {
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const processEpubFile = async (file) => {
    if (!file?.name?.endsWith('.epub')) {
      showToast('⚠️ Veuillez choisir un fichier .epub');
      return;
    }
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const book = ePub(arrayBuffer);
      const meta = await book.loaded.metadata;

      let coverUrl = null;
      try {
        const blobUrl = await book.coverUrl();
        if (blobUrl) {
          // Convertir en base64 AVANT de détruire le livre (la blob URL est valide jusqu'ici)
          coverUrl = await blobUrlToBase64(blobUrl);
        }
      } catch (e) {}

      book.destroy();

      const bookData = {
        file,
        title: meta?.title || file.name.replace('.epub', ''),
        author: meta?.creator || '',
        coverUrl,
      };
      addBook(bookData);
      showToast(`✅ "${bookData.title}" ajouté à votre bibliothèque`);
    } catch (err) {
      console.error('[Library] Import error:', err);
      showToast('❌ Erreur lors de l\'import du livre');
    } finally {
      setLoading(false);
    }
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(processEpubFile);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(processEpubFile);
  };

  return (
    <div className="animated-bg min-h-screen">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center text-lg shadow-lg">
              📚
            </div>
            <div>
              <h1 className="text-xl font-bold font-display text-white leading-tight">EbookReader</h1>
              <p className="text-xs text-dark-400">Votre liseuse numérique</p>
            </div>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-primary flex items-center gap-2"
            title="Importer un fichier EPUB"
            id="import-epub-btn"
            disabled={loading}
          >
            {loading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            )}
            <span>{loading ? 'Import…' : 'Importer EPUB'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".epub"
            multiple
            className="hidden"
            onChange={handleFileInput}
            id="epub-file-input"
          />
        </div>
      </header>

      {/* ── Contenu principal ────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-8">

        {books.length === 0 ? (
          /* Zone de drop vide */
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center min-h-96 border-2 border-dashed rounded-3xl transition-all duration-300 ${
              dragging
                ? 'border-brand-500 bg-brand-500/10 scale-[1.01]'
                : 'border-white/10 bg-white/2'
            }`}
          >
            <div className="text-6xl mb-4 animate-pulse-slow">📚</div>
            <h2 className="text-2xl font-bold font-display text-white mb-2">
              Votre bibliothèque est vide
            </h2>
            <p className="text-dark-400 text-center max-w-sm mb-6">
              Importez vos fichiers EPUB pour commencer à lire. Glissez-déposez ou cliquez sur le bouton.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary text-base px-6 py-3"
            >
              📂 Choisir un fichier EPUB
            </button>
            <p className="text-xs text-dark-500 mt-4">
              Vos livres sont stockés localement dans votre navigateur
            </p>
          </div>
        ) : (
          <>
            {/* Zone de drop (avec livres existants) */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`mb-6 p-4 border-2 border-dashed rounded-2xl text-center transition-all duration-300 ${
                dragging
                  ? 'border-brand-500 bg-brand-500/10'
                  : 'border-white/5 bg-white/1'
              }`}
            >
              <p className="text-xs text-dark-400">
                Glissez-déposez des fichiers .epub ici pour les ajouter
              </p>
            </div>

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white font-display">
                {books.length} livre{books.length > 1 ? 's' : ''} dans votre bibliothèque
              </h2>
            </div>

            {/* Grille des livres */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {books.map(book => (
                <BookCard
                  key={book.id}
                  book={{ ...book, _hue: getHue(book.id) }}
                  onOpen={(b) => openBook(b)} // openBook est async, s'occupe de charger le File si besoin
                  onRemove={removeBook}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="text-center py-6 text-xs text-dark-500">
        EbookReader • EPUB + Web Speech API • Données stockées localement
      </footer>
    </div>
  );
}
