import React from 'react';
import useReaderStore from '../store/useReaderStore';
import { Play, Pause, Square, ZoomIn, ZoomOut } from 'lucide-react';

const ReaderControls = () => {
  const isPlaying = useReaderStore((state) => state.isPlaying);
  const setIsPlaying = useReaderStore((state) => state.setIsPlaying);
  const fontSize = useReaderStore((state) => state.fontSize);
  const setFontSize = useReaderStore((state) => state.setFontSize);
  const ttsRate = useReaderStore((state) => state.ttsRate);
  const setTtsRate = useReaderStore((state) => state.setTtsRate);
  const highlightColor = useReaderStore((state) => state.highlightColor);
  const setHighlightColor = useReaderStore((state) => state.setHighlightColor);

  return (
    <div className="flex flex-wrap items-center justify-between p-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm z-10 sticky top-0">
      
      {/* Playback Controls */}
      <div className="flex items-center space-x-2">
        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          className={`p-2 rounded-full transition-colors ${isPlaying ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'}`}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button 
          onClick={() => setIsPlaying(false)}
          className="p-2 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 transition-colors"
        >
          <Square size={20} />
        </button>

        <div className="flex items-center ml-4 space-x-2">
          <span className="text-xs text-gray-500 font-medium whitespace-nowrap hidden sm:inline">Vitesse: {ttsRate}x</span>
          <input 
            type="range" 
            min="0.5" 
            max="2.0" 
            step="0.1" 
            value={ttsRate}
            onChange={(e) => setTtsRate(parseFloat(e.target.value))}
            className="w-16 sm:w-24 accent-blue-600"
          />
        </div>
      </div>

      {/* Appearance Controls */}
      <div className="flex items-center space-x-4 mt-2 sm:mt-0">
        <div className="flex items-center space-x-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          <button 
            onClick={() => setFontSize(Math.max(50, fontSize - 10))}
            className="p-1.5 text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white transition-colors"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-sm font-medium w-10 text-center text-gray-700 dark:text-gray-200">{fontSize}%</span>
          <button 
            onClick={() => setFontSize(Math.min(300, fontSize + 10))}
            className="p-1.5 text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white transition-colors"
          >
            <ZoomIn size={18} />
          </button>
        </div>

        <div className="flex items-center space-x-2 border-l border-gray-300 dark:border-gray-600 pl-4">
          <input 
            type="color" 
            value={highlightColor.includes('rgba') ? '#ffff00' : highlightColor} 
            onChange={(e) => setHighlightColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border-0 p-0"
            title="Sélecteur de couleur de surlignage"
          />
        </div>
      </div>
    
    </div>
  );
};

export default ReaderControls;
