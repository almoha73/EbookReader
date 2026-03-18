// src/store/readerStore.js
// État global avec Zustand — le "Context" centralisé de l'application

import { create } from 'zustand';
import { saveProgress, loadProgress, savePreferences, loadPreferences, generateBookId, saveBookmarks, loadBookmarks } from '../utils/storage';
import { saveLibraryMeta, loadLibraryMeta, saveEpubFile, loadEpubFile, removeEpubFile } from '../utils/libraryStorage';

const DEFAULT_PREFS = {
  fontSize: 18,
  highlightColor: 'rgba(255, 214, 0, 0.5)',
  ttsRate: 1.0,
  voice: null,
  theme: 'dark',
};

// ── Chargement initial de la bibliothèque depuis localStorage ──────────────
// Les File objects ne sont pas disponibles après un refresh : on les marque "offline"
// ils seront rechargés depuis IndexedDB à l'ouverture par LibraryView
const _savedMeta = loadLibraryMeta();
const _initialBooks = _savedMeta.map(m => ({
  ...m,
  file: null, // sera chargé depuis IndexedDB quand on ouvre le livre
  _loading: false,
}));

export const useReaderStore = create((set, get) => ({
  // ── Vues ──────────────────────────────────────────────────────────────
  view: 'library',   // 'library' | 'reader'
  setView: (view) => set({ view }),

  // ── Bibliothèque ──────────────────────────────────────────────────────
  books: _initialBooks,
  currentBook: null,

  addBook: (bookData) => {
    const id = generateBookId(bookData.file.name);
    const book = { ...bookData, id, addedAt: Date.now() };
    set(state => {
      const books = [...state.books.filter(b => b.id !== id), book];
      saveLibraryMeta(books);
      return { books };
    });
    // Sauvegarder le binaire EPUB dans IndexedDB
    saveEpubFile(id, bookData.file).catch(console.error);
    return id;
  },

  removeBook: (id) => {
    set(state => {
      const books = state.books.filter(b => b.id !== id);
      saveLibraryMeta(books);
      return { books };
    });
    removeEpubFile(id).catch(console.error);
  },

  // Charge le File depuis IndexedDB si nécessaire puis ouvre le livre
  openBook: async (book) => {
    let fileBook = book;
    if (!book.file) {
      // Récupérer le binaire depuis IndexedDB
      const filename = `${book.id}.epub`;
      const file = await loadEpubFile(book.id, book.title ? `${book.title}.epub` : filename);
      if (!file) {
        get().showToast('❌ Fichier introuvable — réimportez ce livre');
        return;
      }
      fileBook = { ...book, file };
      // Mettre à jour la référence dans le store
      set(state => ({
        books: state.books.map(b => b.id === book.id ? fileBook : b),
      }));
    }
    const bookmarks = loadBookmarks(fileBook.id);
    set({ currentBook: fileBook, view: 'reader', bookmarks });
  },

  closeBook: () => set({ currentBook: null, view: 'library' }),

  // ── État du lecteur ───────────────────────────────────────────────────
  currentChapter: '',
  currentChapterIdx: 0,   // index numérique du chapitre
  epubReady: false,
  contentEl: null,        // référence au <div> de lecture (pas d'iframe)
  bookmarks: [],          // Liste des signets du livre courant

  setCurrentChapter: (chapter) => set({ currentChapter: chapter }),
  setCurrentChapterIdx: (idx) => {
    set({ currentChapterIdx: idx });
    const { currentBook } = get();
    if (currentBook?.id) saveProgress(currentBook.id, `ch${idx}`);
  },
  setEpubReady: (ready) => set({ epubReady: ready }),
  setContentEl: (el) => set({ contentEl: el }),

  getSavedChapterIdx: () => {
    const { currentBook } = get();
    if (!currentBook?.id) return 0;
    const saved = loadProgress(currentBook.id);
    if (!saved) return 0;
    const match = String(saved).match(/^ch(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  },

  addBookmark: (bookmark) => {
    set(state => {
      if (!state.currentBook) return state;
      const bookmarks = [...state.bookmarks, bookmark].sort((a, b) => b.timestamp - a.timestamp); // Plus récents en premier
      saveBookmarks(state.currentBook.id, bookmarks);
      return { bookmarks };
    });
  },

  removeBookmark: (id) => {
    set(state => {
      if (!state.currentBook) return state;
      const bookmarks = state.bookmarks.filter(b => b.id !== id);
      saveBookmarks(state.currentBook.id, bookmarks);
      return { bookmarks };
    });
  },

  // ── État TTS ──────────────────────────────────────────────────────────
  ttsState: 'idle',
  sentences: [],
  sentenceIdx: 0,

  setTtsState: (ttsState) => set({ ttsState }),
  setSentences: (sentences) => set({ sentences }),
  setSentenceIdx: (sentenceIdx) => set({ sentenceIdx }),

  // ── Préférences ───────────────────────────────────────────────────────
  preferences: { ...DEFAULT_PREFS, ...loadPreferences() },

  setPreference: (key, value) => {
    set(state => {
      const preferences = { ...state.preferences, [key]: value };
      savePreferences(preferences);
      return { preferences };
    });
  },

  // ── Notification Toast ────────────────────────────────────────────────
  toast: null,
  showToast: (message, duration = 3000) => {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), duration);
  },
}));
