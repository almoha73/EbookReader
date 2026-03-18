import React, { useState } from 'react';
import { useReaderStore } from '../../store/readerStore';

export default function TocPanel({ chapters, currentIdx, onSelectChapter, onClose }) {
  const { bookmarks, removeBookmark } = useReaderStore();
  const [activeTab, setActiveTab] = useState('toc'); // 'toc' | 'bookmarks'

  if (!chapters || chapters.length === 0) return null;

  const hasTocItems = chapters.some(ch => ch.isToc);
  const displayChapters = hasTocItems ? chapters.filter(c => c.isToc) : chapters;

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-white/10 w-full max-w-sm ml-auto">
      {/* Header */}
      <div className="flex flex-col p-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white/90">Navigation</h2>
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

        {/* Tabs */}
        <div className="flex space-x-2 bg-black/20 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('toc')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${activeTab === 'toc' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
          >
            Chapitres
          </button>
          <button
            onClick={() => setActiveTab('bookmarks')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${activeTab === 'bookmarks' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
          >
            Signets
            {bookmarks.length > 0 && (
              <span className="bg-brand-500/30 text-brand-300 text-[10px] pb-[1px] px-1.5 rounded-full">
                {bookmarks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/20 hover:scrollbar-thumb-white/30">
        <div className="flex flex-col space-y-1">
          {activeTab === 'toc' ? (
            displayChapters.map((chapter) => {
              const isActive = chapter.idx === currentIdx;
              
              // Format title intelligently
              let displayTitle = chapter.title || `Partie ${chapter.idx + 1}`;
              if (displayTitle.length > 50) {
                displayTitle = displayTitle.substring(0, 47) + '...';
              }

              return (
                <button
                  key={`${chapter.href}-${chapter.idx}`}
                  onClick={() => {
                    onSelectChapter(chapter.idx);
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
                    <span className="flex-1 truncate">
                      {displayTitle}
                    </span>
                    {isActive && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0">
                        <path d="M5 12l5 5L20 7"/>
                      </svg>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
             bookmarks.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-10 text-white/40">
                 <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                 </svg>
                 <p className="text-sm px-4 text-center">Aucun signet sauvegardé.</p>
               </div>
             ) : (
               bookmarks.map((bookmark) => {
                 const chapter = chapters.find(c => c.idx === bookmark.chapterIdx);
                 const displayTitle = chapter ? (chapter.title || `Partie ${chapter.idx + 1}`) : `Position sauvegardée`;
                 const dateStr = new Date(bookmark.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

                 return (
                   <div
                     key={bookmark.id}
                     className="flex flex-col px-4 py-3 rounded-xl transition-all duration-200 text-white/70 hover:bg-white/5 hover:text-white group border border-transparent hover:border-white/10"
                   >
                     <div className="flex items-start justify-between gap-3">
                       <button 
                         className="flex-1 text-left"
                         onClick={() => {
                            onSelectChapter(bookmark.chapterIdx);
                            onClose();
                         }}
                       >
                          <div className="font-medium line-clamp-2 leading-tight mb-1">{displayTitle}</div>
                          <div className="text-xs text-white/40 flex items-center justify-between">
                             <span>Lu à {bookmark.progress ? bookmark.progress.toFixed(1) + '%' : '0%'}</span>
                             <span>{dateStr}</span>
                          </div>
                       </button>
                       <button
                         onClick={(e) => { e.stopPropagation(); removeBookmark(bookmark.id); }}
                         className="p-1.5 text-red-400/50 hover:text-red-400 hover:bg-red-400/10 rounded-lg opacity-0 lg:group-hover:opacity-100 transition-all shrink-0"
                         title="Supprimer ce signet"
                       >
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                         </svg>
                       </button>
                     </div>
                   </div>
                 );
               })
             )
          )}
        </div>
      </div>
    </div>
  );
}
