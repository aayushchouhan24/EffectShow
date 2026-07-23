import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { initHandInteraction } from '../core/HandInteractionEngine.js'

export default function LandingPage({ onStart }) {
  const navigate = useNavigate()
  const engineContainerRef = useRef(null)
  const engineRef = useRef(null)
  const [sensorActive, setSensorActive] = useState(false)
  const [engineStarted, setEngineStarted] = useState(false)
  const [permissionGranted, setPermissionGranted] = useState(false)

  const handleStartEngine = async () => {
    setEngineStarted(true)
    engineRef.current = await initHandInteraction(engineContainerRef.current, () => {
      // Triggered when user pinches START button in 3D mid-air
      if (onStart) onStart()
      navigate('/app')
    })
    setSensorActive(true)
  }

  useEffect(() => {
    // Check if camera permission is already granted
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'camera' }).then(result => {
        if (result.state === 'granted') {
          setPermissionGranted(true)
          handleStartEngine()
        }
      }).catch(err => {
        console.warn('Permissions API error', err)
      })
    }

    return () => {
      if (engineRef.current) engineRef.current.destroy()
    }
  }, [])

  return (
    <div className="landing-page comic-bg">
      {/* 3D Overlay Canvas for Hands */}
      <div 
        ref={engineContainerRef} 
        style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10, pointerEvents: 'none' }} 
      />

      <div className="landing-content">
        {/* Floating Comic Speech Badges */}
        <div className="speech-badge top-left-badge">
          💥 100% WEBCAM DRIVEN
        </div>
        <div className="speech-badge top-right-badge">
          ✨ 2-HAND 3D TRACKING
        </div>

        {/* 3-Column Widescreen Layout */}
        <div className="landing-grid-3col">
          {/* Left Column: Privacy & Safety */}
          <div className="privacy-panel-col">
            
            <div className="privacy-card" style={{ marginBottom: '1.5rem', padding: '1rem', borderColor: '#ef476f', boxShadow: '4px 4px 0px #000000' }}>
              <h3 style={{ color: '#ef476f', fontSize: '1.2rem', marginBottom: '0.5rem' }}>📸 WEBCAM REQUIRED</h3>
              <div className="privacy-item">
                <p style={{ fontSize: '0.9rem', marginBottom: '1rem', lineHeight: '1.4' }}>This site is controlled by your body. You MUST grant camera access to begin.</p>
                {!engineStarted && !permissionGranted && (
                  <button className="comic-button" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={handleStartEngine}>
                    <span className="button-text">📸 ALLOW CAMERA</span>
                  </button>
                )}
              </div>
            </div>

            <div className="privacy-card">
              <h3>🔒 PRIVACY & SAFETY</h3>
              
              <div className="privacy-item">
                <strong>100% ON-DEVICE AI</strong>
                <p>Webcam video is processed locally in your browser memory via GPU WASM tasks. Zero video streams or images ever leave your device.</p>
              </div>

              <div className="privacy-item">
                <strong>NO DATA STORAGE</strong>
                <p>No tracking cookies, analytics recording, or facial data logging. Camera stops instantly when you exit or close the tab.</p>
              </div>

              <div className="privacy-item">
                <strong>OPEN SOURCE AUDITED</strong>
                <p>Built transparently using Google MediaPipe & Three.js libraries.</p>
              </div>
            </div>
          </div>

          {/* Center Column: Hero Title & Action Burst */}
          <div className="center-hero-col">
            <div className="comic-title-container">
              <div className="title-tag">AI GRAPHICS & INTERACTION</div>
              <h1 className="comic-title">POW! EFFECT SHOW</h1>
              <h2 className="comic-subtitle">3D Hand & Face Tracking Playground</h2>
            </div>
            
            <div className="action-burst">
              {/* Removed onClick to disable mouse - enforcing webcam interaction */}
              <button className="comic-button" style={{ pointerEvents: 'auto' }}>
                <span className="button-text">🚀 START SHOW</span>
              </button>
              
              <div className="pinch-instruction-box">
                <span className="pinch-icon">🤏</span>
                <span>Pinch <strong>START</strong> in mid-air to begin!</span>
              </div>

              <div className={`sensor-status-badge ${sensorActive ? 'active' : ''}`}>
                <span className="status-dot"></span>
                <span>{sensorActive ? 'CAMERA & 3D HAND SENSOR ACTIVE' : 'INITIALIZING SENSOR...'}</span>
              </div>
            </div>
          </div>

          {/* Right Column: Features & Open Source */}
          <div className="features-panel-col">
            <div className="comic-panel-box feature-card-1">
              <div className="card-badge">01 // MASK FILTERS</div>
              <h3>🎭 FACE TRACKING</h3>
              <p>Real-time 60FPS face mesh overlay with custom quad wireframes, shaders & reactive masks.</p>
            </div>

            <div className="comic-panel-box feature-card-2">
              <div className="card-badge">02 // 3D GLOVE</div>
              <h3>🖐️ HAND INTERACTION</h3>
              <p>Dual-hand tracking in full 3D space with dynamic depth scaling & mid-air pinch triggers.</p>
            </div>
            
            <div className="comic-panel-box feature-card-3">
              <div className="card-badge">03 // CODE</div>
              <h3>⚡ OPEN SOURCE</h3>
              <p>Built with Three.js & MediaPipe Vision Tasks. Fully interactive in browser!</p>
              <a 
                href="https://github.com/aayushchouhan24" 
                target="_blank" 
                rel="noreferrer" 
                className="github-link-btn"
              >
                ⭐ @aayushchouhan24
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
