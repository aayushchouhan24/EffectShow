import * as THREE from 'three'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

// --- Pre-allocated reusable math objects (zero GC pressure) ---
const _unitY = new THREE.Vector3(0, 1, 0)
const _vec = new THREE.Vector3()
const _startPos = new THREE.Vector3()
const _endPos = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _midpoint = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _mat4 = new THREE.Matrix4()
const _scale = new THREE.Vector3()

// Helper to create a 4-step toon gradient map for authentic comic cel-shading
function createToonGradient() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#444444'
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = '#777777'
  ctx.fillRect(1, 0, 1, 1)
  ctx.fillStyle = '#dddddd'
  ctx.fillRect(2, 0, 1, 1)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(3, 0, 1, 1)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  return tex
}

export async function initHandInteraction(container, onPinch) {
  let handLandmarker
  let video
  let animationFrameId

  // --- Three.js Setup with reduced overhead ---
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100)
  camera.position.z = 3

  const renderer = new THREE.WebGLRenderer({
    antialias: false,             // Perf: unnecessary for overlay canvas
    alpha: true,
    powerPreference: 'high-performance'
  })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)) // Perf: cap at 1.5 instead of 2
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
    color: 0xffb703,
    gradientMap: toonGradient
  })

  const tipMat = new THREE.MeshToonMaterial({
    color: 0xef476f,
    gradientMap: toonGradient
  })

  // --- Shared geometries (unit-sized, scaled via instance matrix) ---
  const sphereGeo = new THREE.SphereGeometry(1, 12, 10)  // Balanced: smooth enough for toon shading
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 10) // Balanced: smooth cylinders
  cylinderGeo.translate(0, 0.5, 0) // Pivot at base

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
    [1, 2], [2, 3], [3, 4],       // Thumb
    [5, 6], [6, 7], [7, 8],       // Index
    [9, 10], [10, 11], [11, 12],  // Middle
    [13, 14], [14, 15], [15, 16], // Ring
    [17, 18], [18, 19], [19, 20], // Pinky
    [0, 1], [0, 5], [0, 9], [0, 13], [0, 17], // Palm Fan
    [1, 5], [5, 9], [9, 13], [13, 17]          // Knuckle Bridges
  ]

  // Finger chains for elongation
  const fingerChains = [
    { base: 1, joints: [2, 3, 4] },
    { base: 5, joints: [6, 7, 8] },
    { base: 9, joints: [10, 11, 12] },
    { base: 13, joints: [14, 15, 16] },
    { base: 17, joints: [18, 19, 20] }
  ]

  // --- InstancedMesh setup (2 draw calls instead of 90) ---
  const HANDS = 2
  const JOINTS_PER_HAND = 21
  const BONES_PER_HAND = connections.length
  const TOTAL_SPHERES = HANDS * JOINTS_PER_HAND   // 42
  const TOTAL_CYLINDERS = HANDS * BONES_PER_HAND   // 48

  const sphereInstances = new THREE.InstancedMesh(sphereGeo, skinMat, TOTAL_SPHERES)
  sphereInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  sphereInstances.count = 0 // Hidden initially
  scene.add(sphereInstances)

  const cylinderInstances = new THREE.InstancedMesh(cylinderGeo, skinMat, TOTAL_CYLINDERS)
  cylinderInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  cylinderInstances.count = 0 // Hidden initially
  scene.add(cylinderInstances)

  // Per-instance color buffer for tip highlighting (index 8 per hand = magenta)
  const sphereColors = new Float32Array(TOTAL_SPHERES * 3)
  const skinColor = new THREE.Color(0xffb703)
  const tipColor = new THREE.Color(0xef476f)

  for (let h = 0; h < HANDS; h++) {
    for (let i = 0; i < JOINTS_PER_HAND; i++) {
      const idx = h * JOINTS_PER_HAND + i
      const color = i === 8 ? tipColor : skinColor
      sphereColors[idx * 3] = color.r
      sphereColors[idx * 3 + 1] = color.g
      sphereColors[idx * 3 + 2] = color.b
    }
  }
  sphereInstances.instanceColor = new THREE.InstancedBufferAttribute(sphereColors, 3)

  // Pre-allocated per-hand 3D positions
  const pos3D = [
    Array.from({ length: 21 }, () => new THREE.Vector3()),
    Array.from({ length: 21 }, () => new THREE.Vector3())
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

  // --- MediaPipe Setup with pinned version ---
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
  )
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2,
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

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }
  })
  video.srcObject = stream
  await new Promise((resolve) => { video.onloadedmetadata = () => resolve() })

  let lastVideoTime = -1
  let pinchDebounce = false
  const hoveredElementsMap = new Map()

  // --- Throttle state ---
  let lastDetectTime = 0
  let lastHitTestTime = 0
  const DETECT_INTERVAL = 33   // ~30fps cap for MediaPipe detection
  const HITTEST_INTERVAL = 66  // ~15fps cap for DOM elementFromPoint

  // Cache last known screen positions for hit-testing between throttled frames
  const cachedScreenPos = [{ x: 0, y: 0 }, { x: 0, y: 0 }]

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
    const now = performance.now()
    let sphereCount = 0
    let cylinderCount = 0

    // --- Throttled MediaPipe detection (~30fps) ---
    const shouldDetect = video.currentTime !== lastVideoTime && (now - lastDetectTime >= DETECT_INTERVAL)

    if (shouldDetect) {
      lastVideoTime = video.currentTime
      lastDetectTime = now
      const results = handLandmarker.detectForVideo(video, now)

      for (let h = 0; h < 2; h++) {
        const handPos = pos3D[h]
        const landmarks = results.landmarks && results.landmarks[h]
        const score = results.handednesses && results.handednesses[h] && results.handednesses[h][0]?.score

        const isValidHand = landmarks && landmarks.length > 0 && (score === undefined || score >= 0.70)

        if (isValidHand) {
          // Project all 21 landmarks to 3D
          for (let i = 0; i < 21; i++) {
            lmTo3D(landmarks[i], handPos[i])
          }

          // Lengthen fingers (extend joints outward by 8% along finger axes)
          const fingerLengthFactor = 1.08
          for (const chain of fingerChains) {
            const basePos = handPos[chain.base]
            for (const jIdx of chain.joints) {
              _vec.subVectors(handPos[jIdx], basePos)
              handPos[jIdx].copy(basePos).add(_vec.multiplyScalar(fingerLengthFactor))
            }
          }

          // Dynamic scale (max of length & width)
          const lenSpan = handPos[0].distanceTo(handPos[9])
          const widthSpan = handPos[5].distanceTo(handPos[17])
          const palmSpan = Math.max(lenSpan, widthSpan * 1.1)

          if (palmSpan < 0.1) {
            // Suspiciously tiny — treat as false positive
            const prevElem = hoveredElementsMap.get(h)
            if (prevElem) {
              prevElem.classList.remove('finger-hover')
              hoveredElementsMap.delete(h)
            }
            continue
          }

          const referenceSpan = 0.7
          const scaleRatio = Math.max(0.4, Math.min(2.5, palmSpan / referenceSpan))

          // --- Update sphere instances ---
          for (let i = 0; i < 21; i++) {
            const instanceIdx = h * JOINTS_PER_HAND + i
            const radius = baseRadii[i] * scaleRatio

            _mat4.compose(
              handPos[i],
              _quat.identity(),
              _scale.set(radius, radius, radius)
            )
            sphereInstances.setMatrixAt(instanceIdx, _mat4)
            sphereCount = Math.max(sphereCount, instanceIdx + 1)
          }

          // --- Update cylinder instances ---
          for (let c = 0; c < connections.length; c++) {
            const [startIdx, endIdx] = connections[c]
            _startPos.copy(handPos[startIdx])
            _endPos.copy(handPos[endIdx])

            _dir.subVectors(_endPos, _startPos)
            const dist = _dir.length()

            const instanceIdx = h * BONES_PER_HAND + c
            const rStart = baseRadii[startIdx] * scaleRatio
            const rEnd = baseRadii[endIdx] * scaleRatio
            const avgRadius = (rStart + rEnd) * 0.5

            if (dist > 0.001) {
              _quat.setFromUnitVectors(_unitY, _dir.normalize())
            } else {
              _quat.identity()
            }

            _mat4.compose(
              _startPos,
              _quat,
              _scale.set(avgRadius, dist, avgRadius)
            )
            cylinderInstances.setMatrixAt(instanceIdx, _mat4)
            cylinderCount = Math.max(cylinderCount, instanceIdx + 1)
          }

          // Cache screen position for throttled hit-testing
          _vec.copy(handPos[8]).project(camera)
          cachedScreenPos[h].x = (_vec.x * 0.5 + 0.5) * container.clientWidth
          cachedScreenPos[h].y = (-(_vec.y * 0.5) + 0.5) * container.clientHeight

          // Pinch detection (thumb tip #4 to index tip #8)
          const pinchDist = handPos[4].distanceTo(handPos[8])
          if (pinchDist < 0.15 && !pinchDebounce) {
            pinchDebounce = true

            const element = document.elementFromPoint(cachedScreenPos[h].x, cachedScreenPos[h].y)
            if (element && (element.classList.contains('comic-button') || element.closest('.comic-button'))) {
              onPinch()
            }

            setTimeout(() => { pinchDebounce = false }, 1000)
          }

        } else {
          // Hide hand — zero out its instances by leaving count below these indices
          const prevElem = hoveredElementsMap.get(h)
          if (prevElem) {
            prevElem.classList.remove('finger-hover')
            hoveredElementsMap.delete(h)
          }
        }
      }

      // Set visible instance counts
      sphereInstances.count = sphereCount
      sphereInstances.instanceMatrix.needsUpdate = true

      cylinderInstances.count = cylinderCount
      cylinderInstances.instanceMatrix.needsUpdate = true
    }

    // --- Throttled DOM hit-test (~15fps) ---
    if (now - lastHitTestTime >= HITTEST_INTERVAL) {
      lastHitTestTime = now

      for (let h = 0; h < 2; h++) {
        // Only run hit-test if this hand has active instances
        const handHasData = (h === 0 && sphereInstances.count > 0) ||
                            (h === 1 && sphereInstances.count > JOINTS_PER_HAND)
        if (!handHasData) {
          const prevElem = hoveredElementsMap.get(h)
          if (prevElem) {
            prevElem.classList.remove('finger-hover')
            hoveredElementsMap.delete(h)
          }
          continue
        }

        const clientX = cachedScreenPos[h].x
        const clientY = cachedScreenPos[h].y

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
      // Dispose GPU resources
      sphereGeo.dispose()
      cylinderGeo.dispose()
      skinMat.dispose()
      tipMat.dispose()
      toonGradient.dispose()
      sphereInstances.dispose()
      cylinderInstances.dispose()
      renderer.dispose()
    }
  }
}
