// src/utils/libraryStorage.js
// Persistance de la bibliothèque : métadonnées en localStorage, binaires EPUB en IndexedDB

import localforage from 'localforage';

const META_KEY = 'epub_reader_library';

const epubStore = localforage.createInstance({
  name: 'EbookReader',
  storeName: 'epub_files',
});

// Sauvegarde les métadonnées de la bibliothèque (sans les File objects)
export function saveLibraryMeta(books) {
  const meta = books.map(({ id, title, author, coverUrl, addedAt }) => ({
    id, title, author, coverUrl, addedAt,
  }));
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// Charge les métadonnées
export function loadLibraryMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Sauvegarde le binaire EPUB dans IndexedDB
export async function saveEpubFile(id, file) {
  try {
    const buffer = await file.arrayBuffer();
    await epubStore.setItem(id, buffer);
  } catch (e) {
    console.error('[LibraryStorage] Erreur sauvegarde EPUB:', e);
  }
}

// Charge le binaire EPUB depuis IndexedDB et le retourne en File
export async function loadEpubFile(id, filename) {
  try {
    const buffer = await epubStore.getItem(id);
    if (!buffer) return null;
    return new File([buffer], filename || `${id}.epub`, { type: 'application/epub+zip' });
  } catch (e) {
    console.error('[LibraryStorage] Erreur chargement EPUB:', e);
    return null;
  }
}

// Supprime un livre de IndexedDB
export async function removeEpubFile(id) {
  try {
    await epubStore.removeItem(id);
  } catch (_) {}
}
