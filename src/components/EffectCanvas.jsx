import React, { useEffect, useRef } from 'react'
import { initEngine } from '../core/EffectEngine.js'

export default function EffectCanvas({ onEngineReady }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    
    // Initialize the engine inside the container
    const engineApi = initEngine(containerRef.current)
    
    if (onEngineReady) {
      onEngineReady(engineApi)
    }

    return () => {
      engineApi.destroy()
    }
  }, [])

  return (
    <div 
      ref={containerRef} 
      className="canvas-container"
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    />
  )
}
