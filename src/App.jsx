// src/App.jsx
// Routeur principal entre la Bibliothèque et le Lecteur

import { useReaderStore } from './store/readerStore';
import LibraryView from './components/Library/LibraryView';
import ReaderView from './components/Reader/ReaderView';
import Toast from './components/Toast';

export default function App() {
  const { view } = useReaderStore();

  return (
    <div className="h-screen overflow-hidden">
      {/* Transition entre les vues */}
      <div
        className={`h-full transition-all duration-400 ${
          view === 'library' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8 pointer-events-none absolute inset-0'
        }`}
      >
        <LibraryView />
      </div>

      <div
        className={`h-full transition-all duration-400 ${
          view === 'reader' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none absolute inset-0'
        }`}
      >
        <ReaderView />
      </div>

      {/* Toast notification globale */}
      <Toast />
    </div>
  );
}
