export const saveProgress = (bookId, cfi) => {
  if (!bookId || !cfi) return;
  localStorage.setItem(`book_progress_${bookId}`, cfi);
};

export const loadProgress = (bookId) => {
  if (!bookId) return null;
  return localStorage.getItem(`book_progress_${bookId}`);
};
