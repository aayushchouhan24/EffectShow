import * as THREE from 'three'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

// Helper to create a 4-step toon gradient map for authentic comic cel-shading
function createToonGradient() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#444444' // Deep shadow
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = '#777777' // Midtone shadow
  ctx.fillRect(1, 0, 1, 1)
  ctx.fillStyle = '#dddddd' // Light
  ctx.fillRect(2, 0, 1, 1)
  ctx.fillStyle = '#ffffff' // Specular highlight
  ctx.fillRect(3, 0, 1, 1)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  return tex
}

// Factory to create a 3D Hand Mesh structure (21 spheres + connection cylinders)
function createSingleHand3D(scene, baseRadii, connections, skinMat, tipMat) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  // 21 Joint spheres
  const spheres = []
  for (let i = 0; i < 21; i++) {
    const geo = new THREE.SphereGeometry(baseRadii[i], 16, 16)
    const mat = i === 8 ? tipMat : skinMat
    const mesh = new THREE.Mesh(geo, mat)
    group.add(mesh)
    spheres.push(mesh)
  }

  // Connection cylinders
  const cylinders = []
  for (let i = 0; i < connections.length; i++) {
    const [startIdx, endIdx] = connections[i]
    const rStart = baseRadii[startIdx]
    const rEnd = baseRadii[endIdx]

    const geo = new THREE.CylinderGeometry(rEnd, rStart, 1, 16)
    geo.translate(0, 0.5, 0) // Pivot at base
    const mesh = new THREE.Mesh(geo, skinMat)
    group.add(mesh)
    cylinders.push(mesh)
  }
  
  const pos3D = Array.from({length: 21}, () => new THREE.Vector3())

  return { group, spheres, cylinders, pos3D }
}

export async function initHandInteraction(container, onPinch) {
  let handLandmarker
  let video
  let animationFrameId

  // Three.js Setup
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100)
  camera.position.z = 3

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.style.pointerEvents = 'none'
  renderer.domElement.classList.add('hand-canvas')
  container.appendChild(renderer.domElement)

  // Rich pop-art 3D lighting
  scene.add(new THREE.AmbientLight(0xfff0dd, 0.9))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  keyLight.position.set(2, 3, 4)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x7799bb, 0.6)
  fillLight.position.set(-3, -1, 2)
  scene.add(fillLight)

  // Toon Gradient Map for cel-shading
  const toonGradient = createToonGradient()

  // Materials
  const skinMat = new THREE.MeshToonMaterial({
    color: 0xffb703, // Vibrant comic gold/skin tone
    gradientMap: toonGradient
  })

  const tipMat = new THREE.MeshToonMaterial({
    color: 0xef476f, // Magenta pink for cursor / index tip
    gradientMap: toonGradient
  })

  // 21 Joint sphere radii (at scaleRatio = 1.0)
  const baseRadii = [
    0.14,                                    // 0: Wrist
    0.11, 0.085, 0.07, 0.05,                 // 1-4: Thumb
    0.095, 0.075, 0.06, 0.045,               // 5-8: Index
    0.095, 0.075, 0.06, 0.045,               // 9-12: Middle
    0.09, 0.07, 0.055, 0.04,                 // 13-16: Ring
    0.08, 0.065, 0.05, 0.035                 // 17-20: Pinky
  ]

  // Connections (Fingers + Volumetric Palm Frame)
  const connections = [
    // Thumb
    [1, 2], [2, 3], [3, 4],
    // Index
    [5, 6], [6, 7], [7, 8],
    // Middle
    [9, 10], [10, 11], [11, 12],
    // Ring
    [13, 14], [14, 15], [15, 16],
    // Pinky
    [17, 18], [18, 19], [19, 20],
    // Palm Fan (Wrist to Finger Bases)
    [0, 1], [0, 5], [0, 9], [0, 13], [0, 17],
    // Knuckle Bridges
    [1, 5], [5, 9], [9, 13], [13, 17]
  ]

  // Finger chains for elongation
  const fingerChains = [
    { base: 1, joints: [2, 3, 4] },
    { base: 5, joints: [6, 7, 8] },
    { base: 9, joints: [10, 11, 12] },
    { base: 13, joints: [14, 15, 16] },
    { base: 17, joints: [18, 19, 20] }
  ]

  // Create 2 3D Hand Objects (Support 2 Hands simultaneously)
  const hand3DList = [
    createSingleHand3D(scene, baseRadii, connections, skinMat, tipMat),
    createSingleHand3D(scene, baseRadii, connections, skinMat, tipMat)
  ]

  // Convert MediaPipe landmark to 3D world position
  const handZ = -1
  const distFromCamera = camera.position.z - handZ
  const frustumHalfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distFromCamera
  let frustumHalfW = frustumHalfH * camera.aspect

  const lmTo3D = (l, outVec) => {
    outVec.set(
      (1 - l.x - 0.5) * 2 * frustumHalfW,
      -(l.y - 0.5) * 2 * frustumHalfH,
      -l.z * 2 + handZ
    )
  }

  const _unitY = new THREE.Vector3(0, 1, 0)
  const _vec = new THREE.Vector3() // Pre-allocated vector for zero-allocation math

  // MediaPipe Setup with high confidence thresholds to eliminate false detections
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm')
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2, // Support 2 hands simultaneously
    minHandDetectionConfidence: 0.70,
    minHandPresenceConfidence: 0.70,
    minTrackingConfidence: 0.70
  })

  video = document.createElement('video')
  video.autoplay = true
  video.className = 'webcam-preview'
  container.appendChild(video)
  video.playsInline = true
  video.muted = true

  const stream = await navigator.mediaDevices.getUserMedia({ video: true })
  video.srcObject = stream
  await new Promise((resolve) => { video.onloadedmetadata = () => resolve() })

  let lastVideoTime = -1
  let pinchDebounce = false
  let hoveredElementsMap = new Map() // Track hovered element per hand

  const handleResize = () => {
    if (!container) return
    const width = container.clientWidth
    const height = container.clientHeight
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    frustumHalfW = frustumHalfH * camera.aspect
  }
  window.addEventListener('resize', handleResize)

  const renderLoop = () => {
    // 1. Process Video Frames (updates at webcam frame rate, typically 30fps)
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const results = handLandmarker.detectForVideo(video, performance.now())

      // Process up to 2 detected hands
      for (let h = 0; h < 2; h++) {
        const hand3D = hand3DList[h]
        const landmarks = results.landmarks && results.landmarks[h]
        const score = results.handednesses && results.handednesses[h] && results.handednesses[h][0]?.score

        // Strict validation: must have landmarks AND high confidence score (>= 0.70)
        const isValidHand = landmarks && landmarks.length > 0 && (score === undefined || score >= 0.70)

        if (isValidHand) {
          hand3D.group.visible = true

          for (let i = 0; i < 21; i++) {
            lmTo3D(landmarks[i], hand3D.pos3D[i])
          }

          // Lengthen fingers (extend joints outward by 8% along finger axes)
          const fingerLengthFactor = 1.08
          for (const chain of fingerChains) {
            const basePos = hand3D.pos3D[chain.base]
            for (const jIdx of chain.joints) {
              _vec.subVectors(hand3D.pos3D[jIdx], basePos)
              hand3D.pos3D[jIdx].copy(basePos).add(_vec.multiplyScalar(fingerLengthFactor))
            }
          }

          // Dynamic scale calculation (max of length & width so hand scale never collapses when flat/tilted)
          const lenSpan = hand3D.pos3D[0].distanceTo(hand3D.pos3D[9])
          const widthSpan = hand3D.pos3D[5].distanceTo(hand3D.pos3D[17])
          const palmSpan = Math.max(lenSpan, widthSpan * 1.1)

          // Sanity check: if palmSpan is suspiciously tiny, treat as invalid false detection
          if (palmSpan < 0.1) {
            hand3D.group.visible = false
            const prevElem = hoveredElementsMap.get(h)
            if (prevElem) {
              prevElem.classList.remove('finger-hover')
              hoveredElementsMap.delete(h)
            }
            continue
          }

          const referenceSpan = 0.7
          const scaleRatio = Math.max(0.4, Math.min(2.5, palmSpan / referenceSpan))
          
          // Update joint spheres
          for (let i = 0; i < 21; i++) {
            hand3D.spheres[i].position.copy(hand3D.pos3D[i])
            hand3D.spheres[i].scale.setScalar(scaleRatio)
          }

          // Update bone & palm cylinders
          for (let i = 0; i < connections.length; i++) {
            const [startIdx, endIdx] = connections[i]
            const startPos = hand3D.pos3D[startIdx]
            const endPos = hand3D.pos3D[endIdx]

            _vec.subVectors(endPos, startPos)
            const dist = _vec.length()

            hand3D.cylinders[i].position.copy(startPos)
            hand3D.cylinders[i].scale.set(scaleRatio, dist, scaleRatio)

            if (dist > 0.001) {
              hand3D.cylinders[i].quaternion.setFromUnitVectors(_unitY, _vec.normalize())
            }
          }
          
          // Mid-Air Finger Hover Simulation on ALL UI Elements
          const screenPos = _vec.copy(hand3D.pos3D[8]).project(camera)
          const clientX = (screenPos.x * 0.5 + 0.5) * container.clientWidth
          const clientY = (-(screenPos.y * 0.5) + 0.5) * container.clientHeight

          const element = document.elementFromPoint(clientX, clientY)

          const hoverTarget = element ? (
            element.closest('.comic-button, .comic-panel-box, .privacy-card, .pinch-instruction-box, .github-link-btn, button, a') || element
          ) : null

          const prevElem = hoveredElementsMap.get(h)
          if (prevElem && prevElem !== hoverTarget) {
            prevElem.classList.remove('finger-hover')
            hoveredElementsMap.delete(h)
          }

          if (hoverTarget && hoverTarget !== document.body && hoverTarget !== container && !hoverTarget.classList.contains('hand-canvas')) {
            hoverTarget.classList.add('finger-hover')
            hoveredElementsMap.set(h, hoverTarget)
          }

          // Pinch detection (thumb tip #4 to index tip #8)
          const pinchDist = hand3D.pos3D[4].distanceTo(hand3D.pos3D[8])
          if (pinchDist < 0.15 && !pinchDebounce) {
            pinchDebounce = true

            if (element && (element.classList.contains('comic-button') || element.closest('.comic-button'))) {
              onPinch()
            }

            setTimeout(() => { pinchDebounce = false }, 1000)
          }
          
        } else {
          // Hide hand if not detected or low confidence
          hand3D.group.visible = false
          const prevElem = hoveredElementsMap.get(h)
          if (prevElem) {
            prevElem.classList.remove('finger-hover')
            hoveredElementsMap.delete(h)
          }
        }
      }
    }

    renderer.render(scene, camera)
    animationFrameId = requestAnimationFrame(renderLoop)
  }

  renderLoop()

  return {
    destroy: () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      hoveredElementsMap.forEach(elem => elem.classList.remove('finger-hover'))
      hoveredElementsMap.clear()
      stream.getTracks().forEach(track => track.stop())
      if (handLandmarker) handLandmarker.close()
      if (video && video.parentNode) video.parentNode.removeChild(video)
      container.removeChild(renderer.domElement)
    }
  }
}
