import { create } from 'zustand'

const useReaderStore = create((set) => ({
  epubUrl: null,
  bookId: null,
  cfi: null,
  isPlaying: false,
  fontSize: 100, // percentage
  ttsRate: 1.0,
  highlightColor: 'rgba(255, 255, 0, 0.4)',
  
  setEpubUrl: (url) => set({ epubUrl: url }),
  setBookId: (id) => set({ bookId: id }),
  setCfi: (cfi) => set({ cfi }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setFontSize: (size) => set({ fontSize: size }),
  setTtsRate: (rate) => set({ ttsRate: rate }),
  setHighlightColor: (color) => {
    document.documentElement.style.setProperty('--highlight-color', color);
    set({ highlightColor: color });
  }
}))

export default useReaderStore;
