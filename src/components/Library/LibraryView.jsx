// src/components/Library/LibraryView.jsx
// Vue bibliothèque : grille des livres + import EPUB

import { useRef, useState } from 'react';
import { useReaderStore } from '../../store/readerStore';
import BookCard from './BookCard';
import { convertTxtToEpub, convertFb2ToEpub } from '../../utils/fileConverter';
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
    let finalFile = file;

    if (file?.name?.toLowerCase().endsWith('.txt')) {
      const confirmConv = window.confirm(`Le fichier "${file.name}" est un fichier texte brut.\nVoulez-vous le convertir en livre (EPUB) pour le lire ?`);
      if (!confirmConv) return;
      
      setLoading(true);
      showToast('⚙️ Conversion TXT vers EPUB en cours...');
      try {
        finalFile = await convertTxtToEpub(file);
      } catch (e) {
        console.error(e);
        setLoading(false);
        showToast('❌ Échec de la conversion TXT');
        return;
      }
    } else if (file?.name?.toLowerCase().endsWith('.fb2')) {
      const confirmConv = window.confirm(`Le fichier "${file.name}" est au format FB2.\nVoulez-vous le convertir en livre (EPUB) pour le lire ?`);
      if (!confirmConv) return;

      setLoading(true);
      showToast('⚙️ Conversion FB2 vers EPUB en cours...');
      try {
        finalFile = await convertFb2ToEpub(file);
      } catch (e) {
        console.error(e);
        setLoading(false);
        showToast("❌ Échec de la conversion. Le fichier FB2 n'est peut-être pas valide.");
        return;
      }
    }

    if (!finalFile?.name?.toLowerCase().endsWith('.epub')) {
      showToast('⚠️ Veuillez choisir un fichier .epub, .txt ou .fb2');
      return;
    }
    setLoading(true);
    try {
      const arrayBuffer = await finalFile.arrayBuffer();
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

      // Indispensable : attendre que TOUS les processus internes d'epub.js (navigation, etc) 
      // soient terminés AVANT de détruire l'objet, sinon des promesses orphelines 
      // plantent en essayant de lire this.loading.navigation qui a été effacé par destroy()
      await book.ready.catch(() => {});
      book.destroy();

      const bookData = {
        file: finalFile,
        title: meta?.title || finalFile.name.replace(/\.epub$/i, ''),
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

  const handleRemoveBook = (id) => {
    const book = books.find(b => b.id === id);
    if (!book) return;
    if (window.confirm(`Voulez-vous vraiment supprimer "${book.title}" de votre bibliothèque ?\nCette action est irréversible.`)) {
      removeBook(id);
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
    <div className="animated-bg min-h-full">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center text-lg shadow-lg">
              📚
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold font-display text-white leading-tight">EbookReader</h1>
              <p className="text-[10px] sm:text-xs text-white/60">Votre liseuse numérique</p>
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
            <span className="hidden sm:inline">{loading ? 'Import…' : 'Importer EPUB, TXT, FB2'}</span>
            <span className="sm:hidden">{loading ? 'Import…' : 'Importer'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="*/*"
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
            <p className="text-white/60 text-center max-w-sm mb-6">
              Importez vos fichiers pour commencer à lire. Glissez-déposez ou cliquez sur le bouton.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary text-base px-6 py-3"
            >
              📂 Choisir un fichier (EPUB, TXT, FB2)
            </button>
            <p className="text-xs text-white/50 mt-4">
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
              <p className="text-xs text-white/60">
                Glissez-déposez des fichiers ici pour les ajouter (.epub, .txt, .fb2)
              </p>
            </div>

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white font-display">
                {books.length} livre{books.length > 1 ? 's' : ''} dans votre bibliothèque
              </h2>
            </div>

            {/* Grille des livres */}
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
              {books.map(book => (
                <BookCard
                  key={book.id}
                  book={{ ...book, _hue: getHue(book.id) }}
                  onOpen={(b) => openBook(b)} // openBook est async, s'occupe de charger le File si besoin
                  onRemove={handleRemoveBook}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="text-center py-6 text-xs text-white/40">
        EbookReader • EPUB + Web Speech API • Données stockées localement
      </footer>
    </div>
  );
}
