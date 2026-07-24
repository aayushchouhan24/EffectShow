import React, { useEffect } from 'react'
import { Leva, useControls, folder, button } from 'leva'
import { effectNamesList } from '../effects.js'

export default function SettingsUI({ engineApi }) {
  const { uploadMusic, setBgEffect, updateSettings, updateDebug, getCurrentEffects } = engineApi
  const activeEffects = getCurrentEffects()

  const bgOptions = { "None (Original)": -1 }
  effectNamesList.forEach((name, idx) => { bgOptions[`${idx}: ${name}`] = idx })

  const [, set] = useControls(() => ({
    "Audio": folder({
      "Upload & Play Music": button(() => uploadMusic()),
      "Toggle Mute Music": button(() => engineApi.toggleMute()),
      "Beat Match Sync": { value: true, onChange: (v) => updateSettings('beatMatch', v) }
    }, { collapsed: false }),
    "Settings": folder({
      "Enable Finger Effects": { value: true, onChange: (v) => updateSettings('enableFingers', v) },
      "Max People": { value: 2, min: 1, max: 3, step: 1, onChange: (v) => updateSettings('maxPeople', v) },
      "Finger: Thumb": { value: true, onChange: (v) => updateSettings('fingerThumb', v) },
      "Finger: Index": { value: true, onChange: (v) => updateSettings('fingerIndex', v) },
      "Finger: Middle": { value: true, onChange: (v) => updateSettings('fingerMiddle', v) },
      "Finger: Ring": { value: true, onChange: (v) => updateSettings('fingerRing', v) },
      "Finger: Pinky": { value: true, onChange: (v) => updateSettings('fingerPinky', v) },
      "Enable Pinch Switch": { value: true, onChange: (v) => updateSettings('enablePinchSwitch', v) },
      "Auto Change Effects": { value: false, onChange: (v) => updateSettings('autoChangeEffects', v) },
      "Show Landmarks": { value: false, onChange: (v) => updateDebug('landmarks', v) },
      "Show Quad Wireframes": { value: false, onChange: (v) => updateDebug('wireframes', v) }
    }, { collapsed: false }),
    "Background Effect": folder({
      "Warp Entire Screen (Include Hands/Face)": { value: false, onChange: (v) => updateSettings('globalEffectEnabled', v) },
      "Effect Style": { options: bgOptions, value: -1, onChange: (v) => setBgEffect(v) }
    }, { collapsed: true }),
    "Face Mask": folder({
      "Enable Face Mask": { value: false, onChange: (v) => updateSettings('enableFaceMask', v) },
      "Mask Scale": { value: 1.0, min: 1.0, max: 2.0, step: 0.05, onChange: (v) => updateSettings('faceMaskScale', v) },
      "Effect": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceMaskEffect', v) },
    }, { collapsed: true }),
    "Face Sections": folder({
      "Enable Sections": { value: false, onChange: (v) => updateSettings('enableFaceSections', v) },
      "Forehead": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecForehead', v) },
      "Chin": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecChin', v) },
      "Lips": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecLips', v) },
      "Right Eye": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecEyeR', v) },
      "Left Eye": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecEyeL', v) },
      "Right Cheek": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecCheekR', v) },
      "Left Cheek": { options: bgOptions, value: -1, onChange: (v) => updateSettings('faceSecCheekL', v) }
    }, { collapsed: true }),
    "Active Effects (Pair 1)": folder({
      "Quad 1": { options: bgOptions, value: 0, onChange: (v) => updateSettings('quad0', v) },
      "Quad 2": { options: bgOptions, value: 1, onChange: (v) => updateSettings('quad1', v) },
      "Quad 3": { options: bgOptions, value: 2, onChange: (v) => updateSettings('quad2', v) },
      "Quad 4": { options: bgOptions, value: 3, onChange: (v) => updateSettings('quad3', v) }
    })
  }))

  useEffect(() => {
    // Initial sync
    const initialEffects = getCurrentEffects()
    if (initialEffects && initialEffects.length >= 4) {
      set({
        "Quad 1": initialEffects[0],
        "Quad 2": initialEffects[1],
        "Quad 3": initialEffects[2],
        "Quad 4": initialEffects[3]
      })
    }

    // Subscribe to changes
    if (engineApi && engineApi.setOnEffectsChanged) {
      engineApi.setOnEffectsChanged((newEffects) => {
        if (newEffects && newEffects.length >= 4) {
          set({
            "Quad 1": newEffects[0],
            "Quad 2": newEffects[1],
            "Quad 3": newEffects[2],
            "Quad 4": newEffects[3]
          })
        }
      })
    }
  }, [engineApi, set, getCurrentEffects])

  return (
    <Leva 
      flat 
      fill 
      titleBar={false}
      theme={{ 
        colors: {
          elevation1: '#111111',
          elevation2: '#222222',
          elevation3: '#333333',
          accent1: '#e63946',
          accent2: '#f7d100',
          accent3: '#4cc9f0',
          highlight1: '#f7d100',
          highlight2: '#f7d100',
          highlight3: '#f7d100',
          text: '#ffffff',
          folderWidgetColor: '#f7d100',
          folderTextColor: '#ffffff',
          label: '#ffffff'
        },
        radii: {
          xs: '0px',
          sm: '0px',
          lg: '0px'
        },
        fonts: {
          mono: "'Comic Neue', cursive",
          sans: "'Comic Neue', cursive"
        },
        sizes: { 
          rootWidth: '100%' 
        },
        shadows: {
          level1: 'none',
          level2: 'none'
        },
        borderWidths: {
          folder: '2px',
          input: '2px',
          root: '0px'
        }
      }} 
    />
  )
}
