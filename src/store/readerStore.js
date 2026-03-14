// src/store/readerStore.js
// État global avec Zustand — le "Context" centralisé de l'application

import { create } from 'zustand';
import { saveProgress, loadProgress, savePreferences, loadPreferences, generateBookId } from '../utils/storage';

const DEFAULT_PREFS = {
  fontSize: 18,
  highlightColor: 'rgba(255, 214, 0, 0.5)',
  ttsRate: 1.0,
  voice: null,
  theme: 'dark',
};

export const useReaderStore = create((set, get) => ({
  // ── Vues ──────────────────────────────────────────────────────────────
  view: 'library',   // 'library' | 'reader'
  setView: (view) => set({ view }),

  // ── Bibliothèque ──────────────────────────────────────────────────────
  books: [],
  currentBook: null,

  addBook: (bookData) => {
    const id = generateBookId(bookData.file.name);
    const book = { ...bookData, id, addedAt: Date.now() };
    set(state => ({ books: [...state.books.filter(b => b.id !== id), book] }));
    return id;
  },
  removeBook: (id) => set(state => ({ books: state.books.filter(b => b.id !== id) })),
  openBook: (book) => set({ currentBook: book, view: 'reader' }),
  closeBook: () => set({ currentBook: null, view: 'library' }),

  // ── État du lecteur ───────────────────────────────────────────────────
  currentChapter: '',
  currentChapterIdx: 0,   // index numérique du chapitre
  epubReady: false,
  contentEl: null,        // référence au <div> de lecture (pas d'iframe)

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
