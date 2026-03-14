// src/utils/storage.js
// Gestion de la sauvegarde/chargement de la progression via localStorage

const PREFIX = 'epub_reader_';

/**
 * Sauvegarde la position de lecture (CFI) d'un livre
 * @param {string} bookId - Identifiant unique du livre (ex: hash du nom)
 * @param {string} cfi - EpubCFI de la position courante
 */
export function saveProgress(bookId, cfi) {
  if (!bookId || !cfi) return;
  const key = `${PREFIX}cfi_${bookId}`;
  localStorage.setItem(key, cfi);
  console.log(`[Storage] Saved CFI for "${bookId}":`, cfi);
}

/**
 * Charge la position de lecture sauvegardée d'un livre
 * @param {string} bookId
 * @returns {string|null} - CFI ou null si pas de sauvegarde
 */
export function loadProgress(bookId) {
  if (!bookId) return null;
  const key = `${PREFIX}cfi_${bookId}`;
  const cfi = localStorage.getItem(key);
  console.log(`[Storage] Loaded CFI for "${bookId}":`, cfi);
  return cfi;
}

/**
 * Sauvegarde les préférences utilisateur (fonte, vitesse, voix, etc.)
 */
export function savePreferences(prefs) {
  localStorage.setItem(`${PREFIX}preferences`, JSON.stringify(prefs));
}

/**
 * Charge les préférences utilisateur
 */
export function loadPreferences() {
  try {
    const raw = localStorage.getItem(`${PREFIX}preferences`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Sauvegarde la bibliothèque (liste des livres) dans localStorage
 * Pour les gros fichiers EPUB, le binaire est dans localforage/IndexedDB.
 * Ici on stocke seulement les métadonnées (titre, auteur, id, cover).
 */
export function saveLibraryMeta(books) {
  const meta = books.map(({ id, title, author, coverUrl, lastCfi, addedAt }) => ({
    id, title, author, coverUrl, lastCfi, addedAt,
  }));
  localStorage.setItem(`${PREFIX}library`, JSON.stringify(meta));
}

export function loadLibraryMeta() {
  try {
    const raw = localStorage.getItem(`${PREFIX}library`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Génère un ID simple à partir du nom de fichier
 */
export function generateBookId(filename) {
  return filename.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
}
