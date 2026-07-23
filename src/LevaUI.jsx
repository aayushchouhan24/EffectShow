import React, { useEffect } from 'react'
import { Leva, useControls, folder, button } from 'leva'
import { effectNamesList } from './effects.js'

export function LevaUI({ onUploadMusic, onBgEffectChange, onDebugToggles, onSettingsChange, activeEffects }) {
  const bgOptions = { "None (Original)": -1 }
  effectNamesList.forEach((name, idx) => { bgOptions[`${idx}: ${name}`] = idx })

  const [, set] = useControls(() => ({
    "Audio": folder({
      "Upload & Play Music": button(() => onUploadMusic())
    }),
    "Settings": folder({
      "Enable Finger Effects": { value: true, onChange: (v) => onSettingsChange('enableFingers', v) },
      "Max People": { value: 3, min: 1, max: 3, step: 1, onChange: (v) => onSettingsChange('maxPeople', v) },
      "Finger: Thumb": { value: true, onChange: (v) => onSettingsChange('fingerThumb', v) },
      "Finger: Index": { value: true, onChange: (v) => onSettingsChange('fingerIndex', v) },
      "Finger: Middle": { value: true, onChange: (v) => onSettingsChange('fingerMiddle', v) },
      "Finger: Ring": { value: true, onChange: (v) => onSettingsChange('fingerRing', v) },
      "Finger: Pinky": { value: true, onChange: (v) => onSettingsChange('fingerPinky', v) },
      "Enable Pinch Switch": { value: true, onChange: (v) => onSettingsChange('enablePinchSwitch', v) },
      "Auto Change Effects": { value: false, onChange: (v) => onSettingsChange('autoChangeEffects', v) }
    }),
    "Background": folder({
      "Background Effect": {
        options: bgOptions,
        value: -1,
        onChange: (v) => onBgEffectChange(v)
      }
    }),
    "Face Mask": folder({
      "Enable Face Mask": { value: false, onChange: (v) => onSettingsChange('enableFaceMask', v) },
      "Mask Scale": { value: 1.0, min: 1.0, max: 2.0, step: 0.05, onChange: (v) => onSettingsChange('faceMaskScale', v) },
      "Fill Eyes": { value: false, onChange: (v) => onSettingsChange('fillEyes', v) },
      "Fill Mouth": { value: false, onChange: (v) => onSettingsChange('fillMouth', v) },
      "Randomize Sections": { value: false, onChange: (v) => onSettingsChange('randomizeFace', v) },
      "Mask Effect": {
        options: bgOptions,
        value: -1,
        onChange: (v) => onSettingsChange('faceMaskEffect', v)
      }
    }, { collapsed: true }),
    "Face Sections": folder({
      "Enable Sections": { value: false, onChange: (v) => onSettingsChange('enableFaceSections', v) },
      "Forehead": { options: bgOptions, value: -1, onChange: (v) => onSettingsChange('faceSecForehead', v) },
      "Chin": { options: bgOptions, value: -1, onChange: (v) => onSettingsChange('faceSecChin', v) },
      "Lips": { options: bgOptions, value: -1, onChange: (v) => onSettingsChange('faceSecLips', v) },
      "Right Eye": { options: bgOptions, value: -1, onChange: (v) => onSettingsChange('faceSecEyeR', v) },
      "Left Eye": { options: bgOptions, value: -1, onChange: (v) => onSettingsChange('faceSecEyeL', v) },
    }, { collapsed: true }),
    "Debug Visuals": folder({
      "Show Landmarks": { value: false, onChange: (v) => onDebugToggles('landmarks', v) },
      "Show Quad Wireframes": { value: false, onChange: (v) => onDebugToggles('wireframes', v) }
    }),
    "Active Effects (Pair 1)": folder({
      "Quad 1": { options: bgOptions, value: 0, onChange: (v) => onSettingsChange('quad0', v) },
      "Quad 2": { options: bgOptions, value: 1, onChange: (v) => onSettingsChange('quad1', v) },
      "Quad 3": { options: bgOptions, value: 2, onChange: (v) => onSettingsChange('quad2', v) },
      "Quad 4": { options: bgOptions, value: 3, onChange: (v) => onSettingsChange('quad3', v) }
    })
  }))

  useEffect(() => {
    if (activeEffects && activeEffects.length >= 4) {
      set({
        "Quad 1": activeEffects[0],
        "Quad 2": activeEffects[1],
        "Quad 3": activeEffects[2],
        "Quad 4": activeEffects[3]
      })
    }
  }, [activeEffects, set])

  return <Leva theme={{ sizes: { rootWidth: '400px' } }} />
}
