import * as THREE from 'three'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

// =============================================================================
// PRE-ALLOCATED MATH OBJECTS (Zero GC pressure)
// =============================================================================
const _unitY = new THREE.Vector3(0, 1, 0)
const _vec = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _quat = new THREE.Quaternion()

// Temporary vectors for feature calculations (avoid allocation in loops)
const _tempVecA = new THREE.Vector3()
const _tempVecB = new THREE.Vector3()

// =============================================================================
// MEDIAPIPE HAND LANDMARK INDICES
// =============================================================================
const WRIST = 0
const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12
const RING_MCP = 13, RING_PIP = 14, RING_DIP = 15, RING_TIP = 16
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20

// Finger joint chains for angle calculations
const FINGER_CHAINS = [
  { name: 'thumb', joints: [THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP] },
  { name: 'index', joints: [INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP] },
  { name: 'middle', joints: [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP] },
  { name: 'ring', joints: [RING_MCP, RING_PIP, RING_DIP, RING_TIP] },
  { name: 'pinky', joints: [PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP] }
]

// =============================================================================
// TEMPORAL HISTORY CONFIGURATION (Paper: 5-frame window)
// =============================================================================
const TEMPORAL_WINDOW = 5
const MAX_VELOCITY = 30.0
const MAX_ACCELERATION = 100.0

// =============================================================================
// PINCH STATE MACHINE
// =============================================================================
const PINCH_STATE = {
  OPEN: 0,
  CANDIDATE: 1,
  CONFIRMED: 2,
  ACTIVE: 3,
  RELEASE_CANDIDATE: 4
}

// Thresholds (normalized by palm size)
const PINCH_THRESHOLD_START = 0.20
const PINCH_THRESHOLD_RELEASE = 0.28

// =============================================================================
// LANDMARK VALIDATION THRESHOLDS
// =============================================================================
const MAX_BONE_LENGTH_CHANGE = 0.5
const MAX_LANDMARK_JUMP = 2.0
const MIN_PALM_SIZE = 0.05
const MAX_PALM_SIZE = 2.5

// =============================================================================
// CIRCULAR BUFFER FOR TEMPORAL HISTORY
// =============================================================================
class CircularBuffer {
  constructor(size) {
    this.size = size
    this.buffer = new Array(size)
    this.index = 0
    this.count = 0
  }

  push(item) {
    this.buffer[this.index] = item
    this.index = (this.index + 1) % this.size
    if (this.count < this.size) this.count++
  }

  get(offset) {
    if (offset >= this.count) return null
    const idx = (this.index - 1 - offset + this.size) % this.size
    return this.buffer[idx]
  }

  clear() {
    this.index = 0
    this.count = 0
  }

  isFull() {
    return this.count === this.size
  }
}

// =============================================================================
// HAND FEATURE STATE (Pre-allocated per hand)
// =============================================================================
class HandFeatureState {
  constructor() {
    // Raw landmark positions (21 x Vector3)
    this.landmarks = Array.from({ length: 21 }, () => new THREE.Vector3())

    // Local coordinate system
    this.palmNormal = new THREE.Vector3()
    this.palmRight = new THREE.Vector3()
    this.palmUp = new THREE.Vector3()
    this.palmCenter = new THREE.Vector3()

    // Normalized landmarks in local coordinate system
    this.localLandmarks = Array.from({ length: 21 }, () => new THREE.Vector3())

    // Geometric features (pre-allocated arrays)
    this.jointAngles = new Float32Array(15)
    this.fingerCurls = new Float32Array(5)
    this.fingerExtensions = new Float32Array(5)
    this.normalizedDistances = new Float32Array(10)

    // Temporal features
    this.velocities = Array.from({ length: 21 }, () => new THREE.Vector3())
    this.avgVelocity = new THREE.Vector3()
    this.velocityMagnitude = 0
    this.velocityVariance = 0
    this.acceleration = new THREE.Vector3()

    // History buffer
    this.history = new CircularBuffer(TEMPORAL_WINDOW)

    // Per-landmark confidence/stability
    this.landmarkStability = new Float32Array(21)
    this.landmarkValid = new Uint8Array(21)

    // Hand state
    this.palmScale = 0
    this.isTracked = false
    this.trackingConfidence = 0
    this.gestureConfidence = 0
    this.orientation = 'unknown'
    this.isLeftHand = false

    // Pinch state machine
    this.pinchState = PINCH_STATE.OPEN
    this.pinchCandidateFrames = 0
    this.releaseCandidateFrames = 0
    this.pinchDistance = 0
    this.pinchConfidence = 0

    // Previous frame data for validation
    this.prevLandmarks = Array.from({ length: 21 }, () => new THREE.Vector3())
    this.prevPalmScale = 0
    this.prevTimestamp = 0

    // Bone lengths (for consistency checking)
    this.boneLengths = new Float32Array(20)
    this.boneLengthsInitialized = false
  }

  reset() {
    this.history.clear()
    this.isTracked = false
    this.pinchState = PINCH_STATE.OPEN
    this.pinchCandidateFrames = 0
    this.releaseCandidateFrames = 0
    this.boneLengthsInitialized = false
    this.prevTimestamp = 0
    for (let i = 0; i < 21; i++) {
      this.landmarkStability[i] = 0
      this.landmarkValid[i] = 0
    }
  }
}

// =============================================================================
// GEOMETRIC FEATURE EXTRACTION (Paper-inspired)
// =============================================================================

function calculateAngle(p1, p2, p3, tempA, tempB) {
  tempA.subVectors(p1, p2)
  tempB.subVectors(p3, p2)

  const dot = tempA.dot(tempB)
  const lenA = tempA.length()
  const lenB = tempB.length()

  if (lenA < 0.0001 || lenB < 0.0001) return 0

  const cosAngle = Math.max(-1, Math.min(1, dot / (lenA * lenB)))
  return Math.acos(cosAngle)
}

function extractGeometricFeatures(state) {
  const lm = state.landmarks
  const palmScale = state.palmScale

  if (palmScale < 0.001) return

  const invPalmScale = 1.0 / palmScale

  // Joint Angles
  let angleIdx = 0
  for (const chain of FINGER_CHAINS) {
    const joints = chain.joints
    state.jointAngles[angleIdx++] = calculateAngle(
      lm[WRIST], lm[joints[0]], lm[joints[1]], _tempVecA, _tempVecB
    )
    state.jointAngles[angleIdx++] = calculateAngle(
      lm[joints[0]], lm[joints[1]], lm[joints[2]], _tempVecA, _tempVecB
    )
    state.jointAngles[angleIdx++] = calculateAngle(
      lm[joints[1]], lm[joints[2]], lm[joints[3]], _tempVecA, _tempVecB
    )
  }

  // Finger Curl/Extension
  for (let f = 0; f < 5; f++) {
    const chain = FINGER_CHAINS[f].joints
    const avgAngle = (state.jointAngles[f * 3] + state.jointAngles[f * 3 + 1] + state.jointAngles[f * 3 + 2]) / 3
    state.fingerCurls[f] = 1.0 - (avgAngle / Math.PI)

    const tipToPalm = lm[chain[3]].distanceTo(state.palmCenter) * invPalmScale
    state.fingerExtensions[f] = tipToPalm > 1.2 ? 1.0 : tipToPalm > 0.8 ? 0.5 : 0.0
  }

  // Normalized Distances
  state.normalizedDistances[0] = lm[THUMB_TIP].distanceTo(lm[INDEX_TIP]) * invPalmScale
  state.normalizedDistances[1] = lm[THUMB_TIP].distanceTo(lm[MIDDLE_TIP]) * invPalmScale
  state.normalizedDistances[2] = lm[INDEX_TIP].distanceTo(lm[MIDDLE_TIP]) * invPalmScale
  state.normalizedDistances[3] = lm[THUMB_TIP].distanceTo(lm[PINKY_TIP]) * invPalmScale
  state.normalizedDistances[4] = lm[INDEX_TIP].distanceTo(lm[RING_TIP]) * invPalmScale
  state.normalizedDistances[5] = lm[THUMB_TIP].distanceTo(lm[WRIST]) * invPalmScale
  state.normalizedDistances[6] = lm[INDEX_TIP].distanceTo(lm[WRIST]) * invPalmScale
  state.normalizedDistances[7] = lm[MIDDLE_TIP].distanceTo(lm[WRIST]) * invPalmScale
  state.normalizedDistances[8] = lm[RING_TIP].distanceTo(lm[WRIST]) * invPalmScale
  state.normalizedDistances[9] = lm[PINKY_TIP].distanceTo(lm[WRIST]) * invPalmScale
}

function buildLocalCoordinateSystem(state) {
  const lm = state.landmarks

  state.palmCenter.set(0, 0, 0)
    .add(lm[WRIST])
    .add(lm[INDEX_MCP])
    .add(lm[MIDDLE_MCP])
    .add(lm[RING_MCP])
    .add(lm[PINKY_MCP])
    .multiplyScalar(0.2)

  state.palmRight.subVectors(lm[PINKY_MCP], lm[INDEX_MCP]).normalize()
  state.palmUp.subVectors(lm[MIDDLE_MCP], lm[WRIST]).normalize()
  state.palmNormal.crossVectors(state.palmRight, state.palmUp).normalize()

  const facingCamera = state.palmNormal.z
  if (facingCamera > 0.5) {
    state.orientation = 'palm-facing'
  } else if (facingCamera < -0.5) {
    state.orientation = 'back-facing'
  } else {
    state.orientation = 'side'
  }

  for (let i = 0; i < 21; i++) {
    _tempVecA.subVectors(lm[i], state.palmCenter)
    state.localLandmarks[i].set(
      _tempVecA.dot(state.palmRight),
      _tempVecA.dot(state.palmUp),
      _tempVecA.dot(state.palmNormal)
    )
    if (state.isLeftHand) {
      state.localLandmarks[i].x *= -1
    }
  }
}

// =============================================================================
// TEMPORAL FEATURE EXTRACTION (Paper: 5-frame velocity features)
// =============================================================================

function extractTemporalFeatures(state) {
  if (!state.history.isFull()) {
    for (let i = 0; i < 21; i++) {
      state.velocities[i].set(0, 0, 0)
    }
    state.avgVelocity.set(0, 0, 0)
    state.velocityMagnitude = 0
    state.velocityVariance = 0
    state.acceleration.set(0, 0, 0)
    return
  }

  const current = state.history.get(0)
  const prev = state.history.get(1)
  const oldest = state.history.get(TEMPORAL_WINDOW - 1)

  if (!current || !prev || !oldest) return

  const dt = (current.timestamp - prev.timestamp) / 1000
  const totalDt = (current.timestamp - oldest.timestamp) / 1000

  if (dt < 0.001 || totalDt < 0.001) return

  let totalSpeed = 0
  let speedSqSum = 0

  for (let i = 0; i < 21; i++) {
    _tempVecA.subVectors(current.landmarks[i], prev.landmarks[i])
    state.velocities[i].copy(_tempVecA).divideScalar(dt)

    const speed = state.velocities[i].length()
    if (speed > MAX_VELOCITY) {
      state.velocities[i].multiplyScalar(MAX_VELOCITY / speed)
    }

    totalSpeed += state.velocities[i].length()
    speedSqSum += state.velocities[i].lengthSq()
  }

  state.avgVelocity.set(0, 0, 0)
  for (let i = 0; i < 21; i++) {
    state.avgVelocity.add(state.velocities[i])
  }
  state.avgVelocity.divideScalar(21)
  state.velocityMagnitude = state.avgVelocity.length()

  const avgSpeed = totalSpeed / 21
  state.velocityVariance = (speedSqSum / 21) - (avgSpeed * avgSpeed)

  if (state.history.count >= 2) {
    const prevFrame = state.history.get(1)
    if (prevFrame && prevFrame.avgVelocity) {
      state.acceleration.subVectors(state.avgVelocity, prevFrame.avgVelocity).divideScalar(dt)
      const accelMag = state.acceleration.length()
      if (accelMag > MAX_ACCELERATION) {
        state.acceleration.multiplyScalar(MAX_ACCELERATION / accelMag)
      }
    }
  }
}

// =============================================================================
// LANDMARK VALIDATION
// =============================================================================

function validateLandmarks(state, timestamp) {
  const lm = state.landmarks

  for (let i = 0; i < 21; i++) {
    state.landmarkValid[i] = 1
  }

  if (!state.boneLengthsInitialized) {
    initializeBoneLengths(state)
    return true
  }

  const dt = (timestamp - state.prevTimestamp) / 1000
  if (dt < 0.001) return true

  let invalidCount = 0

  for (let i = 0; i < 21; i++) {
    const jumpDist = lm[i].distanceTo(state.prevLandmarks[i])
    const maxAllowedJump = MAX_LANDMARK_JUMP + state.velocityMagnitude * dt * 2

    if (jumpDist > maxAllowedJump) {
      state.landmarkValid[i] = 0
      state.landmarkStability[i] = Math.max(0, state.landmarkStability[i] - 0.3)
      invalidCount++

      lm[i].copy(state.prevLandmarks[i])
      if (state.velocities[i].length() < MAX_VELOCITY) {
        lm[i].add(_tempVecA.copy(state.velocities[i]).multiplyScalar(dt))
      }
    } else {
      state.landmarkStability[i] = Math.min(1, state.landmarkStability[i] + 0.1)
    }
  }

  const boneValid = validateBoneLengths(state)
  const validRatio = 1 - (invalidCount / 21)
  const stabilityAvg = state.landmarkStability.reduce((a, b) => a + b, 0) / 21
  state.trackingConfidence = validRatio * 0.6 + stabilityAvg * 0.3 + (boneValid ? 0.1 : 0)

  return invalidCount < 10
}

function initializeBoneLengths(state) {
  const lm = state.landmarks
  let idx = 0

  for (const chain of FINGER_CHAINS) {
    const joints = chain.joints
    state.boneLengths[idx++] = lm[WRIST].distanceTo(lm[joints[0]])
    for (let j = 0; j < joints.length - 1; j++) {
      state.boneLengths[idx++] = lm[joints[j]].distanceTo(lm[joints[j + 1]])
    }
  }

  state.boneLengthsInitialized = true
}

function validateBoneLengths(state) {
  const lm = state.landmarks
  let idx = 0
  let valid = true

  for (const chain of FINGER_CHAINS) {
    const joints = chain.joints

    const baseBone = lm[WRIST].distanceTo(lm[joints[0]])
    if (Math.abs(baseBone - state.boneLengths[idx]) / state.boneLengths[idx] > MAX_BONE_LENGTH_CHANGE) {
      valid = false
    } else {
      state.boneLengths[idx] = state.boneLengths[idx] * 0.9 + baseBone * 0.1
    }
    idx++

    for (let j = 0; j < joints.length - 1; j++) {
      const bone = lm[joints[j]].distanceTo(lm[joints[j + 1]])
      if (Math.abs(bone - state.boneLengths[idx]) / state.boneLengths[idx] > MAX_BONE_LENGTH_CHANGE) {
        valid = false
      } else {
        state.boneLengths[idx] = state.boneLengths[idx] * 0.9 + bone * 0.1
      }
      idx++
    }
  }

  return valid
}

// =============================================================================
// PINCH DETECTION STATE MACHINE (Multi-feature approach from paper)
// =============================================================================

function updatePinchState(state, onPinchCallback, screenPos) {
  const pinchDist = state.normalizedDistances[0]
  state.pinchDistance = pinchDist

  // Simple hysteresis - works immediately without waiting for temporal features
  const isPinching = state.pinchState === PINCH_STATE.ACTIVE

  if (!isPinching) {
    // Check if should start pinching
    if (pinchDist < PINCH_THRESHOLD_START) {
      state.pinchState = PINCH_STATE.ACTIVE

      const element = document.elementFromPoint(screenPos.x, screenPos.y)
      if (element && (element.classList.contains('comic-button') || element.closest('.comic-button'))) {
        onPinchCallback()
      }
    }
  } else {
    // Check if should release
    if (pinchDist > PINCH_THRESHOLD_RELEASE) {
      state.pinchState = PINCH_STATE.OPEN
    }
  }
}

// =============================================================================
// MOTION PREDICTION (Paper: reduces perceived latency)
// =============================================================================

function predictLandmarks(state, predictionMs, outLandmarks) {
  const predictionSec = predictionMs / 1000
  const velocityFactor = Math.min(1, state.velocityMagnitude * 2)
  const adaptivePrediction = predictionSec * (0.3 + velocityFactor * 0.7)

  for (let i = 0; i < 21; i++) {
    outLandmarks[i].copy(state.landmarks[i])

    if (state.landmarkStability[i] > 0.5 && state.velocities[i].length() < MAX_VELOCITY) {
      _tempVecA.copy(state.velocities[i]).multiplyScalar(adaptivePrediction)
      outLandmarks[i].add(_tempVecA)
    }
  }

  clampPredictedPositions(state, outLandmarks)
}

function clampPredictedPositions(state, predictedLm) {
  let boneIdx = 0

  for (const chain of FINGER_CHAINS) {
    const joints = chain.joints

    const baseBone = predictedLm[WRIST].distanceTo(predictedLm[joints[0]])
    const expectedBase = state.boneLengths[boneIdx]
    if (baseBone > expectedBase * 1.3) {
      _tempVecA.subVectors(predictedLm[joints[0]], predictedLm[WRIST]).normalize()
      predictedLm[joints[0]].copy(predictedLm[WRIST]).add(_tempVecA.multiplyScalar(expectedBase * 1.2))
    }
    boneIdx++

    for (let j = 0; j < joints.length - 1; j++) {
      const bone = predictedLm[joints[j]].distanceTo(predictedLm[joints[j + 1]])
      const expected = state.boneLengths[boneIdx]
      if (bone > expected * 1.3) {
        _tempVecA.subVectors(predictedLm[joints[j + 1]], predictedLm[joints[j]]).normalize()
        predictedLm[joints[j + 1]].copy(predictedLm[joints[j]]).add(_tempVecA.multiplyScalar(expected * 1.2))
      }
      boneIdx++
    }
  }
}

// =============================================================================
// ADAPTIVE SMOOTHING (Paper: velocity-based adaptation)
// =============================================================================

function adaptiveSmooth(current, target, velocity, isInitialized) {
  if (!isInitialized) {
    current.copy(target)
    return
  }

  const speed = velocity.length()
  let smoothing
  if (speed > 0.8) {
    smoothing = 0.85
  } else if (speed > 0.3) {
    smoothing = 0.6
  } else if (speed > 0.1) {
    smoothing = 0.45
  } else {
    smoothing = 0.3
  }

  current.lerp(target, smoothing)
}

// =============================================================================
// TOON GRADIENT HELPER
// =============================================================================

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

// =============================================================================
// MAIN EXPORT: initHandInteraction (API unchanged)
// =============================================================================

export async function initHandInteraction(container, onPinch) {
  let handLandmarker
  let video
  let animationFrameId

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100)
  camera.position.z = 3

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance'
  })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.domElement.style.pointerEvents = 'none'
  renderer.domElement.classList.add('hand-canvas')
  container.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0xfff0dd, 0.9))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8)
  keyLight.position.set(2, 3, 4)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x7799bb, 0.6)
  fillLight.position.set(-3, -1, 2)
  scene.add(fillLight)

  const toonGradient = createToonGradient()

  const skinMat = new THREE.MeshToonMaterial({
    color: 0xffb703,
    gradientMap: toonGradient
  })

  const tipMat = new THREE.MeshToonMaterial({
    color: 0xef476f,
    gradientMap: toonGradient
  })

  function createSingleHand3D(scene, baseRadii, connections, skinMat, tipMat) {
    const group = new THREE.Group()
    group.visible = false
    scene.add(group)

    const spheres = []
    for (let i = 0; i < 21; i++) {
      const geo = new THREE.SphereGeometry(baseRadii[i], 16, 16)
      const mat = i === INDEX_TIP ? tipMat : skinMat
      const mesh = new THREE.Mesh(geo, mat)
      group.add(mesh)
      spheres.push(mesh)
    }

    const cylinders = []
    for (let i = 0; i < connections.length; i++) {
      const [startIdx, endIdx] = connections[i]
      const rStart = baseRadii[startIdx]
      const rEnd = baseRadii[endIdx]

      const geo = new THREE.CylinderGeometry(rEnd, rStart, 1, 16)
      geo.translate(0, 0.5, 0)
      const mesh = new THREE.Mesh(geo, skinMat)
      group.add(mesh)
      cylinders.push(mesh)
    }

    return { group, spheres, cylinders }
  }

  const baseRadii = [
    0.14,
    0.11, 0.085, 0.07, 0.05,
    0.095, 0.075, 0.06, 0.045,
    0.095, 0.075, 0.06, 0.045,
    0.09, 0.07, 0.055, 0.04,
    0.08, 0.065, 0.05, 0.035
  ]

  // Connections: fingers + knuckle bridges only (quads, no triangles)
  const connections = [
    [1, 2], [2, 3], [3, 4],       // Thumb
    [5, 6], [6, 7], [7, 8],       // Index
    [9, 10], [10, 11], [11, 12],  // Middle
    [13, 14], [14, 15], [15, 16], // Ring
    [17, 18], [18, 19], [19, 20], // Pinky
    [0, 1], [0, 5], [0, 9], [0, 13], [0, 17],  // Wrist to all MCPs
    [1, 5], [5, 9], [9, 13], [13, 17]  // Knuckle bridges
  ]

  const fingerChains = [
    { base: 1, joints: [2, 3, 4] },
    { base: 5, joints: [6, 7, 8] },
    { base: 9, joints: [10, 11, 12] },
    { base: 13, joints: [14, 15, 16] },
    { base: 17, joints: [18, 19, 20] }
  ]

  const hands = [
    createSingleHand3D(scene, baseRadii, connections, skinMat, tipMat),
    createSingleHand3D(scene, baseRadii, connections, skinMat, tipMat)
  ]

  const handStates = [new HandFeatureState(), new HandFeatureState()]

  const pos3D = [
    Array.from({ length: 21 }, () => new THREE.Vector3()),
    Array.from({ length: 21 }, () => new THREE.Vector3())
  ]

  const predictedPos3D = [
    Array.from({ length: 21 }, () => new THREE.Vector3()),
    Array.from({ length: 21 }, () => new THREE.Vector3())
  ]

  const targetPos3D = [
    Array.from({ length: 21 }, () => new THREE.Vector3()),
    Array.from({ length: 21 }, () => new THREE.Vector3())
  ]

  const handInitialized = [false, false]

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
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  })

  video = document.createElement('video')
  video.autoplay = true
  video.className = 'webcam-preview'
  container.appendChild(video)
  video.playsInline = true
  video.muted = true

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 60 } }
  })
  video.srcObject = stream
  await new Promise((resolve) => { video.onloadedmetadata = () => resolve() })

  let lastVideoTime = -1
  const hoveredElementsMap = new Map()

  let lastHitTestTime = 0
  const HITTEST_INTERVAL = 66

  const cachedScreenPos = [{ x: 0, y: 0 }, { x: 0, y: 0 }]

  const PREDICTION_MS = 10

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

    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime

      hands[0].group.visible = false
      hands[1].group.visible = false

      let results = {}
      try {
        results = handLandmarker.detectForVideo(video, now)
      } catch (e) {
        // HandLandmarker not ready
      }

      for (let h = 0; h < 2; h++) {
        const handPos = pos3D[h]
        const state = handStates[h]
        const landmarks = results.landmarks && results.landmarks[h]
        const handedness = results.handedness && results.handedness[h]

        const isValidHand = landmarks && landmarks.length === 21

        if (isValidHand) {
          const targetPos = targetPos3D[h]

          if (handedness && handedness.length > 0) {
            state.isLeftHand = handedness[0].categoryName === 'Left'
          }

          for (let i = 0; i < 21; i++) {
            lmTo3D(landmarks[i], targetPos[i])
          }

          const fingerLengthFactor = 1.08
          for (const chain of fingerChains) {
            const basePos = targetPos[chain.base]
            for (const jIdx of chain.joints) {
              _vec.subVectors(targetPos[jIdx], basePos)
              targetPos[jIdx].copy(basePos).add(_vec.multiplyScalar(fingerLengthFactor))
            }
          }

          for (let i = 0; i < 21; i++) {
            state.landmarks[i].copy(targetPos[i])
          }

          const lenSpan = state.landmarks[WRIST].distanceTo(state.landmarks[MIDDLE_MCP])
          const widthSpan = state.landmarks[INDEX_MCP].distanceTo(state.landmarks[PINKY_MCP])
          state.palmScale = Math.max(lenSpan, widthSpan * 1.1)

          if (state.palmScale < MIN_PALM_SIZE || state.palmScale > MAX_PALM_SIZE) {
            const prevElem = hoveredElementsMap.get(h)
            if (prevElem) {
              prevElem.classList.remove('finger-hover')
              hoveredElementsMap.delete(h)
            }
            state.reset()
            continue
          }

          const valid = validateLandmarks(state, now)
          if (!valid) {
            state.reset()
            handInitialized[h] = false
            continue
          }

          buildLocalCoordinateSystem(state)
          extractGeometricFeatures(state)

          const historyEntry = {
            landmarks: state.landmarks.map(v => v.clone()),
            timestamp: now,
            palmScale: state.palmScale,
            avgVelocity: state.avgVelocity.clone()
          }
          state.history.push(historyEntry)

          extractTemporalFeatures(state)

          if (!handInitialized[h]) {
            for (let i = 0; i < 21; i++) {
              handPos[i].copy(targetPos[i])
            }
            handInitialized[h] = true
          } else {
            for (let i = 0; i < 21; i++) {
              adaptiveSmooth(handPos[i], targetPos[i], state.velocities[i], true)
            }
          }

          predictLandmarks(state, PREDICTION_MS, predictedPos3D[h])

          const renderPos = predictedPos3D[h]

          const referenceSpan = 0.7
          const scaleRatio = Math.max(0.4, Math.min(2.5, state.palmScale / referenceSpan))

          hands[h].group.visible = true
          state.isTracked = true
          const { spheres, cylinders } = hands[h]

          for (let i = 0; i < 21; i++) {
            spheres[i].position.copy(renderPos[i])
            spheres[i].scale.set(scaleRatio * 1.5, scaleRatio * 1.5, scaleRatio * 1.5)
          }

          for (let c = 0; c < connections.length; c++) {
            const [startIdx, endIdx] = connections[c]
            const start = renderPos[startIdx]
            const end = renderPos[endIdx]

            _dir.subVectors(end, start)
            const dist = _dir.length()

            if (dist > 0.001) {
              cylinders[c].position.copy(start)
              _quat.setFromUnitVectors(_unitY, _dir.normalize())
              cylinders[c].quaternion.copy(_quat)
              cylinders[c].scale.set(scaleRatio * 1.5, dist, scaleRatio * 1.5)
              cylinders[c].visible = true
            } else {
              cylinders[c].visible = false
            }
          }

          _vec.copy(renderPos[INDEX_TIP]).project(camera)
          cachedScreenPos[h].x = (_vec.x * 0.5 + 0.5) * container.clientWidth
          cachedScreenPos[h].y = (-(_vec.y * 0.5) + 0.5) * container.clientHeight

          updatePinchState(state, onPinch, cachedScreenPos[h])

          for (let i = 0; i < 21; i++) {
            state.prevLandmarks[i].copy(state.landmarks[i])
          }
          state.prevPalmScale = state.palmScale
          state.prevTimestamp = now

        } else {
          state.reset()
          handInitialized[h] = false
          const prevElem = hoveredElementsMap.get(h)
          if (prevElem) {
            prevElem.classList.remove('finger-hover')
            hoveredElementsMap.delete(h)
          }
        }
      }
    }

    if (now - lastHitTestTime >= HITTEST_INTERVAL) {
      lastHitTestTime = now

      for (let h = 0; h < 2; h++) {
        const handHasData = hands[h].group.visible
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
      for (let h = 0; h < 2; h++) {
        hands[h].spheres.forEach(s => s.geometry.dispose())
        hands[h].cylinders.forEach(c => c.geometry.dispose())
      }
      skinMat.dispose()
      tipMat.dispose()
      toonGradient.dispose()
      renderer.dispose()
    }
  }
}
