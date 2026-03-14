// src/components/Reader/ReaderView.jsx
// Layout complet de la vue lecteur

import EpubViewer from './EpubViewer';
import { useReaderStore } from '../../store/readerStore';

export default function ReaderView() {
  const { currentBook } = useReaderStore();

  if (!currentBook) return null;

  return (
    <div className="animated-bg h-screen flex flex-col overflow-hidden">
      <EpubViewer book={currentBook} />
    </div>
  );
}
