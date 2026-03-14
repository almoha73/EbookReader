// src/main.jsx
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Note: StrictMode désactivé car il double-invoque les effets en dev,
// ce qui crée deux renditions epub.js simultanées et casse la navigation.
createRoot(document.getElementById('root')).render(
  <App />
)
