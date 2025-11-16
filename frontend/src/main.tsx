
// Minimal polyfills for Node.js globals (if needed by other dependencies)
// Note: We use pure browser crypto (tweetnacl) for encryption, so no heavy polyfills needed
if (typeof window !== 'undefined') {
  // Minimal process polyfill (if needed by other dependencies)
  if (!(window as any).process) {
    (window as any).process = {
      env: {},
      browser: true,
      version: '',
      versions: {},
    }
  }
  ;(window as any).global = window
  ;(globalThis as any).global = globalThis
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { WalletProvider } from './contexts/WalletContext'
import App from './App'
import './styles.css'

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/my-drive', element: <App /> },
  { path: '/shared', element: <App initialTab="shared" /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <RouterProvider router={router} />
    </WalletProvider>
  </React.StrictMode>
)
