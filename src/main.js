import './styles.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import GUI from 'lil-gui'
import fragmentShader from './shaders/fragment.glsl'

// Web Audio Setup
let audioElement;
let audioContext;
let analyser;
let dataArray;
let isAudioPlaying = false;

const gui = new GUI()
const audioParams = {
  uploadMusic: () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (file) {
        if (!audioContext) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)()
          analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          dataArray = new Uint8Array(analyser.frequencyBinCount)
        }
        if (!audioElement) {
          audioElement = new Audio()
          audioElement.crossOrigin = 'anonymous'
          const source = audioContext.createMediaElementSource(audioElement)
          source.connect(analyser)
          analyser.connect(audioContext.destination)
        }
        audioElement.src = URL.createObjectURL(file)
        audioElement.play()
        isAudioPlaying = true
      }
    }
    input.click()
  }
}
gui.add(audioParams, 'uploadMusic').name('Upload & Play Music')

// Setup Webcam Background
const video = document.createElement('video')
video.autoplay = true
video.playsInline = true
video.muted = true
video.style.position = 'fixed'
video.style.top = '0'
video.style.left = '0'
video.style.width = '100vw'
video.style.height = '100vh'
video.style.objectFit = 'cover'
video.style.zIndex = '-1'
video.style.transform = 'scaleX(-1)' // Mirror the video visually
document.body.appendChild(video)

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })
    .then((stream) => {
      video.srcObject = stream
    })
    .catch((error) => {
      console.error('Error accessing webcam:', error)
    })
} else {
  console.error('getUserMedia is not supported by this browser.')
}

// Scene setup
const scene = new THREE.Scene()

// Camera setup
const camera = new THREE.PerspectiveCamera(
  25,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.z = 5

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

// Controls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// MediaPipe Hand Tracking Setup
let handLandmarker
let lastVideoTime = -1

const initializeHandTracker = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  )
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 6
  })
}
initializeHandTracker()

// Create non-indexed BufferGeometry for up to 3 pairs of hands (72 vertices total)
const MAX_PAIRS = 3
const MAX_VERTICES = 24 * MAX_PAIRS
const pointsGeo = new THREE.BufferGeometry()
const positions = new Float32Array(MAX_VERTICES * 3)
const effectIds = new Float32Array(MAX_VERTICES)
pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
pointsGeo.setAttribute('aEffectId', new THREE.BufferAttribute(effectIds, 1))
pointsGeo.setDrawRange(0, 0)

const videoTexture = new THREE.VideoTexture(video)
videoTexture.minFilter = THREE.LinearFilter

const pointsMat = new THREE.ShaderMaterial({
  uniforms: {
    uVideo: { value: videoTexture },
    uResolution: { value: new THREE.Vector2(window.innerWidth * Math.min(window.devicePixelRatio, 2), window.innerHeight * Math.min(window.devicePixelRatio, 2)) },
    uVideoSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uAudioLow: { value: 0 },
    uAudioMid: { value: 0 },
    uAudioHigh: { value: 0 }
  },
  vertexShader: `
    attribute float aEffectId;
    varying float vEffectId;
    void main() {
      vEffectId = aEffectId;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: fragmentShader,
  side: THREE.DoubleSide,
  transparent: true
})
const pointsMesh = new THREE.Mesh(pointsGeo, pointsMat)

scene.add(pointsMesh)

let currentEffects = new Array(4 * MAX_PAIRS).fill(0)
let lastRandomizeTime = 0
let lastPinchTime = 0

// Resize handler
const handleResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
}
window.addEventListener('resize', handleResize)

// Animation loop
const clock = new THREE.Clock()
const animate = () => {
  requestAnimationFrame(animate)

  pointsMat.uniforms.uTime.value = clock.getElapsedTime()
  
  if (isAudioPlaying && analyser) {
    analyser.getByteFrequencyData(dataArray)
    let low = 0, mid = 0, high = 0;
    for(let i=0; i<42; i++) low += dataArray[i];
    for(let i=42; i<85; i++) mid += dataArray[i];
    for(let i=85; i<128; i++) high += dataArray[i];
    pointsMat.uniforms.uAudioLow.value = low / (42 * 255)
    pointsMat.uniforms.uAudioMid.value = mid / (43 * 255)
    pointsMat.uniforms.uAudioHigh.value = high / (43 * 255)
  }

  // Hand tracking update
  if (handLandmarker && video.readyState >= 2) {
    let startTimeMs = performance.now()
    
    // Randomize effects every 5 seconds natively
    if (startTimeMs - lastRandomizeTime > 5000) {
      for (let i = 0; i < currentEffects.length; i++) {
        currentEffects[i] = Math.floor(Math.random() * 130)
      }
      lastRandomizeTime = startTimeMs
    }

    if (lastVideoTime !== video.currentTime) {
      lastVideoTime = video.currentTime
      const results = handLandmarker.detectForVideo(video, startTimeMs)
      
      const videoWidth = video.videoWidth
      const videoHeight = video.videoHeight
      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight
      
      if (videoWidth && videoHeight) {
        pointsMat.uniforms.uVideoSize.value.set(videoWidth, videoHeight)
        const pixelRatio = renderer.getPixelRatio()
        pointsMat.uniforms.uResolution.value.set(windowWidth * pixelRatio, windowHeight * pixelRatio)
      }

      const videoAspect = videoWidth / videoHeight
      const windowAspect = windowWidth / windowHeight
      
      let scale = 1
      if (windowAspect > videoAspect) {
        scale = windowWidth / videoWidth
      } else {
        scale = windowHeight / videoHeight
      }
      
      const displayedWidth = videoWidth * scale
      const displayedHeight = videoHeight * scale
      
      const offsetX = (windowWidth - displayedWidth) / 2
      const offsetY = (windowHeight - displayedHeight) / 2
      
      if (results.landmarks && results.landmarks.length > 0) {
        const fingersData = [
          { tip: 4, pip: 3 },   
          { tip: 8, pip: 6 },   
          { tip: 12, pip: 10 }, 
          { tip: 16, pip: 14 }, 
          { tip: 20, pip: 18 }  
        ]
        
        const numHands = results.landmarks.length
        
        // Pinch Detection to randomize shaders
        let pinchDetected = false;
        for(let h=0; h<numHands; h++) {
            const hand = results.landmarks[h]
            const thumb = hand[4]
            const index = hand[8]
            const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z)
            if (dist < 0.05) pinchDetected = true;
        }
        
        if (pinchDetected && startTimeMs - lastPinchTime > 500) {
            for (let i = 0; i < currentEffects.length; i++) {
                currentEffects[i] = Math.floor(Math.random() * 130)
            }
            lastPinchTime = startTimeMs
            lastRandomizeTime = startTimeMs
        }

        const numPairs = Math.min(MAX_PAIRS, Math.max(1, Math.ceil(numHands / 2)))
        
        const positions = pointsGeo.attributes.position.array
        const effectIds = pointsGeo.attributes.aEffectId.array
        let vertCount = 0
        
        for (let pairIdx = 0; pairIdx < numPairs; pairIdx++) {
          const h1Idx = pairIdx * 2
          const h2Idx = (pairIdx * 2 + 1) < numHands ? (pairIdx * 2 + 1) : h1Idx
          
          const rawPoints = new Array(10).fill(null)
          
          const extractHand = (handData, offsetIndex) => {
            if (!handData) return;
            const wrist = handData[0]
            fingersData.forEach((finger, i) => {
              const tipLm = handData[finger.tip]
              const pipLm = handData[finger.pip]
              
              const distTip = Math.hypot(tipLm.x - wrist.x, tipLm.y - wrist.y, tipLm.z - wrist.z)
              const distPip = Math.hypot(pipLm.x - wrist.x, pipLm.y - wrist.y, pipLm.z - wrist.z)
              const isOpen = distTip > distPip * 1.1
              
              if (isOpen) {
                const px = windowWidth - (offsetX + tipLm.x * displayedWidth)
                const py = offsetY + tipLm.y * displayedHeight
                
                const ndcX = (px / windowWidth) * 2 - 1
                const ndcY = -(py / windowHeight) * 2 + 1
                
                const vector = new THREE.Vector3(ndcX, ndcY, 0.5)
                vector.unproject(camera)
                vector.sub(camera.position).normalize()
                
                const pos = new THREE.Vector3().copy(camera.position).add(vector.clone().multiplyScalar(5))
                pos.add(vector.clone().multiplyScalar(tipLm.z * 15))
                
                rawPoints[offsetIndex + i] = pos
              }
            })
          }
          
          extractHand(results.landmarks[h1Idx], 0)
          extractHand(results.landmarks[h2Idx], 5)

          const quadDefs = [
            [0, 1, 6, 5], // Quad 1: Thumb to Index
            [1, 2, 7, 6], // Quad 2: Index to Middle
            [2, 3, 8, 7], // Quad 3: Middle to Ring
            [3, 4, 9, 8]  // Quad 4: Ring to Pinky
          ]
          
          quadDefs.forEach((quad, qIndex) => {
            let p0 = rawPoints[quad[0]]
            let p1 = rawPoints[quad[1]]
            let p2 = rawPoints[quad[2]]
            let p3 = rawPoints[quad[3]]
            
            let validCount = (p0?1:0) + (p1?1:0) + (p2?1:0) + (p3?1:0)
            
            if (validCount >= 3) {
              if (!p0) p0 = p1 || p3;
              if (!p1) p1 = p0 || p2;
              if (!p2) p2 = p1 || p3;
              if (!p3) p3 = p2 || p0;
              
              const addVertex = (p) => {
                positions[vertCount * 3] = p.x
                positions[vertCount * 3 + 1] = p.y
                positions[vertCount * 3 + 2] = p.z
                effectIds[vertCount] = currentEffects[pairIdx * 4 + qIndex]
                vertCount++
              }
              // Triangle 1
              addVertex(p0)
              addVertex(p1)
              addVertex(p2)
              // Triangle 2
              addVertex(p0)
              addVertex(p2)
              addVertex(p3)
            }
          })
        }

        pointsGeo.setDrawRange(0, vertCount)
        pointsGeo.attributes.position.needsUpdate = true
        pointsGeo.attributes.aEffectId.needsUpdate = true
      } else {
        pointsGeo.setDrawRange(0, 0)
      }
    }
  }

  controls.update()
  renderer.render(scene, camera)
}

animate()
