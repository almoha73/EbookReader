import React from 'react';
import useReaderStore from './store/useReaderStore';
import FileUploader from './components/FileUploader';
import Reader from './components/Reader';
import ReaderControls from './components/ReaderControls';

function App() {
  const epubUrl = useReaderStore((state) => state.epubUrl);
  const bookId = useReaderStore((state) => state.bookId);

  return (
    <div style={{width:'100%', height:'100vh', display:'flex', flexDirection:'column'}}>
      {!epubUrl ? (
        <FileUploader />
      ) : (
        <>
          <ReaderControls />
          <div style={{flex:1, position:'relative', overflow:'hidden'}}>
            <Reader epubUrl={epubUrl} bookId={bookId} />
          </div>
        </>
      )}
    </div>
  );
}

export default App;
