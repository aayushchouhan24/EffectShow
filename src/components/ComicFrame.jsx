import React, { useState } from 'react'
import EffectCanvas from './EffectCanvas.jsx'
import SettingsUI from './SettingsUI.jsx'

export default function ComicFrame() {
  const [engineApi, setEngineApi] = useState(null)

  return (
    <div className="comic-bg full-screen-frame">
      <div className="comic-page">
        {/* Main Canvas Panel */}
        <div className="comic-panel canvas-panel shadow-pop">
          <div className="panel-header">CAMERA FEED</div>
          <div className="panel-content">
            <EffectCanvas onEngineReady={setEngineApi} />
          </div>
        </div>

        {/* Settings Panel */}
        <div className="comic-panel settings-panel shadow-pop">
          <div className="panel-header">CONTROLS</div>
          <div className="panel-content settings-content">
            {engineApi ? <SettingsUI engineApi={engineApi} /> : <div className="loading-comic">LOADING...</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
