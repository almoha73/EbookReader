import React from 'react';
import useReaderStore from './store/useReaderStore';
import FileUploader from './components/FileUploader';
import Reader from './components/Reader';
import ReaderControls from './components/ReaderControls';

function App() {
  const epubUrl = useReaderStore((state) => state.epubUrl);
  const bookId = useReaderStore((state) => state.bookId);

  return (
    <div className="w-full h-full flex flex-col">
      {!epubUrl ? (
        <FileUploader />
      ) : (
        <>
          <ReaderControls />
          <div className="flex-1 relative">
            <Reader epubUrl={epubUrl} bookId={bookId} />
          </div>
        </>
      )}
    </div>
  );
}

export default App;
