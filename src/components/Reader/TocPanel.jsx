import React from 'react';

export default function TocPanel({ chapters, currentIdx, onSelectChapter, onClose }) {
  if (!chapters || chapters.length === 0) return null;

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-white/10 w-full max-w-sm ml-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <h2 className="text-lg font-semibold text-white/90">Table des Matières</h2>
        <button
          onClick={onClose}
          className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          title="Fermer"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Liste des chapitres */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30">
        <div className="flex flex-col space-y-1">
          {chapters.map((chapter, idx) => {
            const isActive = idx === currentIdx;
            
            // Format title intelligently
            let displayTitle = chapter.title || `Chapitre ${idx + 1}`;
            // Clean up potentially long raw filenames if no title present
            if (displayTitle.length > 50) {
              displayTitle = displayTitle.substring(0, 47) + '...';
            }

            return (
              <button
                key={`${chapter.href}-${idx}`}
                onClick={() => {
                  onSelectChapter(idx);
                  onClose();
                }}
                className={`
                  text-left px-4 py-3 rounded-xl transition-all duration-200
                  ${isActive 
                    ? 'bg-blue-500/20 text-blue-300 font-medium' 
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono opacity-50 w-6 text-right ${isActive ? 'text-blue-300' : ''}`}>
                    {idx + 1}
                  </span>
                  <span className="flex-1 truncate">
                    {displayTitle}
                  </span>
                  {isActive && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                      <path d="M5 12l5 5L20 7"/>
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
