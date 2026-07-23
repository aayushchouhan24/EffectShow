import React, { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './components/LandingPage.jsx'
import ComicFrame from './components/ComicFrame.jsx'

export default function App() {
  const [hasStarted, setHasStarted] = useState(() => {
    return sessionStorage.getItem('effectShow_hasStarted') === 'true'
  })

  const handleStart = () => {
    sessionStorage.setItem('effectShow_hasStarted', 'true')
    setHasStarted(true)
  }

  return (
    <div className="app-container">
      <Routes>
        <Route path="/" element={<LandingPage onStart={handleStart} />} />
        <Route path="/app" element={hasStarted ? <ComicFrame /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
