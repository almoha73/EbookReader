import React from 'react';
import useReaderStore from '../store/useReaderStore';

const FileUploader = () => {
  const setEpubUrl = useReaderStore((state) => state.setEpubUrl);
  const setBookId = useReaderStore((state) => state.setBookId);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type !== 'application/epub+zip' && !file.name.endsWith('.epub')) {
        alert('Veuillez sélectionner un fichier EPUB valide.');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target.result;
        const id = `${file.name}_${file.size}`;
        setBookId(id);
        setEpubUrl(arrayBuffer);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center border border-gray-200 dark:border-gray-700">
        <h1 className="text-2xl font-bold mb-6">Lecteur EPUB React</h1>
        <p className="mb-8 text-gray-500 dark:text-gray-400">Sélectionnez un fichier .epub pour commencer la lecture.</p>
        
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors inline-block shadow-md">
          Ouvrir un livre
          <input 
            type="file" 
            accept=".epub,application/epub+zip" 
            className="hidden" 
            onChange={handleFileUpload} 
          />
        </label>
      </div>
    </div>
  );
};

export default FileUploader;
