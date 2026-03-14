// src/components/Toast.jsx
// Notification toast globale

import { useReaderStore } from '../store/readerStore';
import { useEffect, useState } from 'react';

export default function Toast() {
  const { toast } = useReaderStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [toast]);

  if (!toast && !visible) return null;

  return (
    <div className={`toast ${visible && toast ? 'show' : ''}`}>
      {toast}
    </div>
  );
}
