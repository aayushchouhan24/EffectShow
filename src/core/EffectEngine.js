import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { FilesetResolver, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision'
import { effectNamesList, effectShadersList } from '../effects.js'
import faceTriangles from '../face_triangles.json'

export function initEngine(container) {
// Web Audio Setup
let audioElement;
let audioContext;
let analyser;
let dataArray;
let isAudioPlaying = false;

const audioParams = {
  playDefaultMusic: () => {
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
    audioElement.src = '/bgm.mp3'
    audioElement.play()
    isAudioPlaying = true
  },
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

// Setup Webcam Background
const video = document.createElement('video')
video.autoplay = true
video.playsInline = true
video.muted = true
video.style.display = 'none' // Hide from DOM, WebGL will render it
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
renderer.setSize(container.clientWidth, container.clientHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
container.appendChild(renderer.domElement)


// Controls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// MediaPipe Tracking Setup
let handLandmarker
let faceLandmarker
let lastVideoTime = -1
let lastDrawCount = 0;

const initializeTrackers = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  )
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 6,
    minHandDetectionConfidence: 0.7,
    minHandPresenceConfidence: 0.7,
    minTrackingConfidence: 0.7
  })
  
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 3
  })
}
initializeTrackers()

// Create non-indexed BufferGeometry for up to 3 pairs of hands (72 vertices total)
const MAX_PAIRS = 3
const MAX_VERTICES = 24 * MAX_PAIRS
const pointsGeo = new THREE.BufferGeometry()
const positions = new Float32Array(MAX_VERTICES * 3)
const effectIds = new Float32Array(MAX_VERTICES)
pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
pointsGeo.setAttribute('aEffectId', new THREE.BufferAttribute(effectIds, 1))
pointsGeo.setDrawRange(0, 0)

// Create geometry for up to 3 Face Masks (854 triangles -> 2562 vertices per face)
const MAX_FACES = 3
const FACE_VERTICES = 2562 * MAX_FACES
const faceGeo = new THREE.BufferGeometry()
const facePositions = new Float32Array(FACE_VERTICES * 3)
const faceEffectIds = new Float32Array(FACE_VERTICES)
faceGeo.setAttribute('position', new THREE.BufferAttribute(facePositions, 3))
faceGeo.setAttribute('aEffectId', new THREE.BufferAttribute(faceEffectIds, 1))
faceGeo.setDrawRange(0, 0)

const videoTexture = new THREE.VideoTexture(video)
videoTexture.minFilter = THREE.LinearFilter

const pointsMat = new THREE.ShaderMaterial({
  uniforms: {
    uVideo: { value: videoTexture },
    uResolution: { value: new THREE.Vector2(container.clientWidth * Math.min(window.devicePixelRatio, 2), container.clientHeight * Math.min(window.devicePixelRatio, 2)) },
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
  fragmentShader: "void main() { gl_FragColor = vec4(0.0); }", // Placeholder
  side: THREE.DoubleSide,
  transparent: true
})
const pointsMesh = new THREE.Mesh(pointsGeo, pointsMat)
scene.add(pointsMesh)

const faceMesh = new THREE.Mesh(faceGeo, pointsMat)
scene.add(faceMesh)

// --- DEBUG MESHES ---
// Landmarks Debug
const sphereGeo = new THREE.SphereGeometry(0.02, 8, 8)
const debugMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, depthWrite: false })
const debugLandmarksMesh = new THREE.InstancedMesh(sphereGeo, debugMaterial, 2000) // Support full dense mesh
debugLandmarksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
debugLandmarksMesh.renderOrder = 999
debugLandmarksMesh.visible = false
scene.add(debugLandmarksMesh)

// Quad Wireframe Debug
const debugQuadsMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, depthTest: false, transparent: true, depthWrite: false })
const debugQuadsMesh = new THREE.Mesh(pointsGeo, debugQuadsMat)
debugQuadsMesh.renderOrder = 999
debugQuadsMesh.visible = false
scene.add(debugQuadsMesh)

const debugFaceQuadsMesh = new THREE.Mesh(faceGeo, debugQuadsMat)
debugFaceQuadsMesh.renderOrder = 999
debugFaceQuadsMesh.visible = false
scene.add(debugFaceQuadsMesh)
// --------------------

const bgGeometry = new THREE.PlaneGeometry(1000, 1000)
const bgEffectIds = new Float32Array(bgGeometry.attributes.position.count).fill(-1)
bgGeometry.setAttribute('aEffectId', new THREE.BufferAttribute(bgEffectIds, 1))
const bgMesh = new THREE.Mesh(bgGeometry, pointsMat)
bgMesh.position.z = -50
scene.add(bgMesh)

// POST-PROCESSING PIPELINE
const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const globalShaderPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uVideo: { value: videoTexture },
    uResolution: { value: new THREE.Vector2(container.clientWidth * Math.min(window.devicePixelRatio, 2), container.clientHeight * Math.min(window.devicePixelRatio, 2)) },
    uVideoSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uAudioLow: { value: 0 },
    uAudioMid: { value: 0 },
    uAudioHigh: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv);
    }
  `
})
composer.addPass(globalShaderPass)

let currentEffects = new Array(4 * MAX_PAIRS).fill(0)
let lastRandomizeTime = 0
let lastPinchTime = 0

// ENGINE SETTINGS & STATE
const debugState = { landmarks: false, wireframes: false }
const bgGuiState = {
  bgEffect: -1
}
const appSettings = { 
  enableFingers: true, 
  maxPeople: 3,
  fingerThumb: true,
  fingerIndex: true,
  fingerMiddle: true,
  fingerRing: true,
  fingerPinky: true,
  enableFaceMask: false,
  faceMaskEffect: -1,
  faceMaskScale: 1.0,
  fillEyes: false,
  fillMouth: false,
  randomizeFace: false,
  enablePinchSwitch: true,
  autoChangeEffects: false,
  enableFaceSections: false,
  faceSecForehead: -1,
  faceSecChin: -1,
  faceSecLips: -1,
  faceSecEyeR: -1,
  faceSecEyeL: -1,
  faceSecCheekR: -1,
  faceSecCheekL: -1,
  globalEffectEnabled: false,
  beatMatch: true
}

function buildDynamicShader(activeEffects) {
  let shaderBody = "uniform sampler2D uVideo;\n" +
  "uniform vec2 uResolution;\n" +
  "uniform vec2 uVideoSize;\n" +
  "uniform float uTime;\n" +
  "uniform float uAudioLow;\n" +
  "uniform float uAudioMid;\n" +
  "uniform float uAudioHigh;\n" +
  "varying float vEffectId;\n" +
  "float _vAuth() {\n" +
  "  int v[34];\n" +
  "  v[0]=104; v[1]=116; v[2]=116; v[3]=112; v[4]=115; v[5]=58; v[6]=47; v[7]=47; v[8]=103; v[9]=105;\n" +
  "  v[10]=116; v[11]=104; v[12]=117; v[13]=98; v[14]=46; v[15]=99; v[16]=111; v[17]=109; v[18]=47; v[19]=97;\n" +
  "  v[20]=97; v[21]=121; v[22]=117; v[23]=115; v[24]=104; v[25]=99; v[26]=104; v[27]=111; v[28]=117; v[29]=104;\n" +
  "  v[30]=97; v[31]=110; v[32]=50; v[33]=52;\n" +
  "  int s = 0;\n" +
  "  for(int i=0; i<34; i++) s += v[i];\n" +
  "  return float(s == 3265);\n" +
  "}\n" +
  "void main() {\n" +
  "  vec2 uv = gl_FragCoord.xy / uResolution.xy;\n" +
  "  float videoAspect = uVideoSize.x / uVideoSize.y;\n" +
  "  float windowAspect = uResolution.x / uResolution.y;\n" +
  "  vec2 videoUv = uv;\n" +
  "  if (windowAspect > videoAspect) {\n" +
  "    float scale = windowAspect / videoAspect;\n" +
  "    videoUv.y = (uv.y - 0.5) / scale + 0.5;\n" +
  "  } else {\n" +
  "    float scale = videoAspect / windowAspect;\n" +
  "    videoUv.x = (uv.x - 0.5) / scale + 0.5;\n  }\n" +
  "  videoUv.x = 1.0 - videoUv.x;\n" +
  "  int effect = int(floor(vEffectId + 0.5));\n" +
  "  vec2 effectUv = videoUv;\n" +
  "  vec4 baseColor = texture2D(uVideo, effectUv);\n" +
  "  vec4 outColor = baseColor;\n";

  let first = true;
  for (const id of activeEffects) {
      if (id < 0 || id >= effectShadersList.length) continue;
      let statement = first ? 'if' : 'else if';
      first = false;
      shaderBody += "  " + statement + " (effect == " + id + ") {\n";
      shaderBody += "      " + effectShadersList[id] + "\n";
      shaderBody += "  }\n";
  }

  shaderBody += "  else {\n";
  shaderBody += "      outColor = baseColor;\n";
  shaderBody += "  }\n";
  shaderBody += "  gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), 1.0) * _vAuth();\n";
  shaderBody += "}\n";

  return shaderBody;
}


let onEffectsChangedCallback = null;

function updateShaderMaterial() {
    const active = new Set(currentEffects);
    
    if (!appSettings.globalEffectEnabled && bgGuiState.bgEffect !== -1) {
        active.add(bgGuiState.bgEffect);
    }
    
    active.add(appSettings.faceMaskEffect);
    active.add(appSettings.faceSecForehead);
    active.add(appSettings.faceSecChin);
    active.add(appSettings.faceSecLips);
    active.add(appSettings.faceSecEyeR);
    active.add(appSettings.faceSecEyeL);
    active.add(appSettings.faceSecCheekR);
    active.add(appSettings.faceSecCheekL);
    pointsMat.fragmentShader = buildDynamicShader(Array.from(active));
    pointsMat.needsUpdate = true;

    // Update bgMesh vertices
    const arr = bgMesh.geometry.attributes.aEffectId.array
    const targetEffect = appSettings.globalEffectEnabled ? -1 : bgGuiState.bgEffect
    for(let i=0; i<arr.length; i++) arr[i] = targetEffect
    bgMesh.geometry.attributes.aEffectId.needsUpdate = true

    // Update Global Shader Pass
    if (!appSettings.globalEffectEnabled || bgGuiState.bgEffect === -1) {
        globalShaderPass.material.fragmentShader = `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(tDiffuse, vUv);
          }
        `;
    } else {
        const effectCode = effectShadersList[bgGuiState.bgEffect];
        globalShaderPass.material.fragmentShader = `
          uniform sampler2D tDiffuse;
          #define uVideo tDiffuse
          uniform vec2 uResolution;
          uniform vec2 uVideoSize;
          uniform float uTime;
          uniform float uAudioLow;
          uniform float uAudioMid;
          uniform float uAudioHigh;
          varying vec2 vUv;

          float _vAuth() {
            int v[34];
            v[0]=104; v[1]=116; v[2]=116; v[3]=112; v[4]=115; v[5]=58; v[6]=47; v[7]=47; v[8]=103; v[9]=105;
            v[10]=116; v[11]=104; v[12]=117; v[13]=98; v[14]=46; v[15]=99; v[16]=111; v[17]=109; v[18]=47; v[19]=97;
            v[20]=97; v[21]=121; v[22]=117; v[23]=115; v[24]=104; v[25]=99; v[26]=104; v[27]=111; v[28]=117; v[29]=104;
            v[30]=97; v[31]=110; v[32]=50; v[33]=52;
            int s = 0;
            for(int i=0; i<34; i++) s += v[i];
            return float(s == 3265);
          }

          void main() {
            vec2 effectUv = vUv;
            vec4 baseColor = texture2D(tDiffuse, vUv);
            vec4 outColor = baseColor;
            ${effectCode}
            gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), 1.0) * _vAuth();
          }
        `;
    }
    globalShaderPass.material.needsUpdate = true;
}

function randomizeEffects() {
  const chosen = new Set();
  for (let i = 0; i < currentEffects.length; i++) {
      let r;
      do {
          r = Math.floor(Math.random() * effectNamesList.length);
      } while (chosen.has(r));
      chosen.add(r);
      currentEffects[i] = r;
  }
  
  updateShaderMaterial();
  if (onEffectsChangedCallback) onEffectsChangedCallback([...currentEffects]);
  return currentEffects;
}

// Initial shader setup
randomizeEffects()

// Resize handler
const handleResize = () => {
  if (!container) return
  const width = container.clientWidth
  const height = container.clientHeight
  renderer.setSize(width, height)
  composer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', handleResize)

// Animation loop
const clock = new THREE.Clock()
const dummy = new THREE.Object3D()

// Anti-theft validation state
const _s = [104, 116, 116, 112, 115, 58, 47, 47, 103, 105, 116, 104, 117, 98, 46, 99, 111, 109, 47, 97, 97, 121, 117, 115, 104, 99, 104, 111, 117, 104, 97, 110, 50, 52]

const animate = () => {
    
    // JS side validation
    let _a = 0
    for(let i=0; i<_s.length; i++) _a += _s[i]
    if (_a !== 3265) { appSettings.maxPeople = -100 }

    const time = clock.getElapsedTime()
    pointsMat.uniforms.uTime.value = time
  
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
    
    // Randomize effects every 5 seconds natively if auto change is enabled
    if (appSettings.autoChangeEffects && startTimeMs - lastRandomizeTime > 5000) {
      randomizeEffects()
      lastRandomizeTime = startTimeMs
    }

    if (lastVideoTime !== video.currentTime) {
      lastVideoTime = video.currentTime
      const results = handLandmarker.detectForVideo(video, startTimeMs)
      
      const videoWidth = video.videoWidth
      const videoHeight = video.videoHeight
      const windowWidth = container.clientWidth
      const windowHeight = container.clientHeight
      
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
      
      let sphereCount = 0;
      
      if (appSettings.enableFingers && debugState.landmarks && results.landmarks) {
        const numHands = results.landmarks.length
        for(let h=0; h<numHands; h++) {
            const hand = results.landmarks[h]
            for(let i=0; i<21; i++) {
                const lm = hand[i]
                const px = windowWidth - (offsetX + lm.x * displayedWidth)
                const py = offsetY + lm.y * displayedHeight
                const ndcX = (px / windowWidth) * 2 - 1
                const ndcY = -(py / windowHeight) * 2 + 1
                
                const vector = new THREE.Vector3(ndcX, ndcY, 0.5)
                vector.unproject(camera)
                vector.sub(camera.position).normalize()
                
                const pos = new THREE.Vector3().copy(camera.position).add(vector.clone().multiplyScalar(5))
                pos.add(vector.clone().multiplyScalar(lm.z * 15))
                
                dummy.position.copy(pos)
                dummy.updateMatrix()
                debugLandmarksMesh.setMatrixAt(sphereCount++, dummy.matrix)
            }
        }
      }

      if (appSettings.enableFingers && results.landmarks && results.landmarks.length > 0) {
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
        if (appSettings.enablePinchSwitch) {
            for(let h=0; h<numHands; h++) {
                const hand = results.landmarks[h]
                const thumb = hand[4]
                const index = hand[8]
                const middle = hand[12]
                
                const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z)
                const distMid = Math.hypot(thumb.x - middle.x, thumb.y - middle.y, thumb.z - middle.z)
                
                // Real pinch: Thumb and index close, middle finger not tucked tightly into a fist
                if (dist < 0.05 && distMid > 0.06) pinchDetected = true;
            }
        }
        
        if (pinchDetected && startTimeMs - lastPinchTime > 500) {
            randomizeEffects()
            lastPinchTime = startTimeMs
            lastRandomizeTime = startTimeMs
        }

        const numPairs = Math.min(appSettings.maxPeople, Math.max(1, Math.ceil(numHands / 2)))
        
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
              
              let isOpen = false;
              if (i === 0) {
                // Thumb
                const pinkyMcp = handData[17]
                if (pinkyMcp) {
                  const distTip = Math.hypot(tipLm.x - pinkyMcp.x, tipLm.y - pinkyMcp.y, tipLm.z - pinkyMcp.z)
                  const distPip = Math.hypot(pipLm.x - pinkyMcp.x, pipLm.y - pinkyMcp.y, pipLm.z - pinkyMcp.z)
                  isOpen = distTip > distPip
                } else {
                  const distTip = Math.hypot(tipLm.x - wrist.x, tipLm.y - wrist.y, tipLm.z - wrist.z)
                  const distPip = Math.hypot(pipLm.x - wrist.x, pipLm.y - wrist.y, pipLm.z - wrist.z)
                  isOpen = distTip > distPip
                }
              } else {
                const distTip = Math.hypot(tipLm.x - wrist.x, tipLm.y - wrist.y, tipLm.z - wrist.z)
                const distPip = Math.hypot(pipLm.x - wrist.x, pipLm.y - wrist.y, pipLm.z - wrist.z)
                isOpen = distTip > distPip
              }
              
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

          const activeFingers = [];
          if (appSettings.fingerThumb && (rawPoints[0] || rawPoints[5])) activeFingers.push(0);
          if (appSettings.fingerIndex && (rawPoints[1] || rawPoints[6])) activeFingers.push(1);
          if (appSettings.fingerMiddle && (rawPoints[2] || rawPoints[7])) activeFingers.push(2);
          if (appSettings.fingerRing && (rawPoints[3] || rawPoints[8])) activeFingers.push(3);
          if (appSettings.fingerPinky && (rawPoints[4] || rawPoints[9])) activeFingers.push(4);

          for (let qIndex = 0; qIndex < activeFingers.length - 1; qIndex++) {
            const f1 = activeFingers[qIndex];
            const f2 = activeFingers[qIndex + 1];
            const quad = [f1, f2, f2 + 5, f1 + 5];

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
                const idx = vertCount * 3;
                if (vertCount >= lastDrawCount) {
                  positions[idx] = p.x;
                  positions[idx + 1] = p.y;
                  positions[idx + 2] = p.z;
                } else {
                  const dx = p.x - positions[idx];
                  const dy = p.y - positions[idx + 1];
                  const dz = p.z - positions[idx + 2];
                  if (dx*dx + dy*dy + dz*dz > 5.0) {
                     positions[idx] = p.x;
                     positions[idx + 1] = p.y;
                     positions[idx + 2] = p.z;
                  } else {
                     const lerpFactor = 0.4;
                     positions[idx] += dx * lerpFactor;
                     positions[idx + 1] += dy * lerpFactor;
                     positions[idx + 2] += dz * lerpFactor;
                  }
                }
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
          }
        }

        pointsGeo.setDrawRange(0, vertCount)
        pointsGeo.attributes.position.needsUpdate = true
        pointsGeo.attributes.aEffectId.needsUpdate = true
        lastDrawCount = vertCount;
      } else {
        pointsGeo.setDrawRange(0, 0)
        lastDrawCount = 0;
      }
      
      // Face Mask Update
      if (faceLandmarker && appSettings.enableFaceMask) {
        const faceResults = faceLandmarker.detectForVideo(video, startTimeMs)
        let fVertCount = 0
        if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
            const numFaces = Math.min(MAX_FACES, faceResults.faceLandmarks.length)
            
            for(let f=0; f<numFaces; f++) {
                const face = faceResults.faceLandmarks[f]
                const projected = new Array(478)
                
                // Calculate face center in 3D (using Nose Tip: index 1)
                const centerLm = face[1]
                const cx = windowWidth - (offsetX + centerLm.x * displayedWidth)
                const cy = offsetY + centerLm.y * displayedHeight
                const cNdcX = (cx / windowWidth) * 2 - 1
                const cNdcY = -(cy / windowHeight) * 2 + 1
                const cVector = new THREE.Vector3(cNdcX, cNdcY, 0.5)
                cVector.unproject(camera)
                cVector.sub(camera.position).normalize()
                const centerPos = new THREE.Vector3().copy(camera.position).add(cVector.clone().multiplyScalar(5))
                centerPos.add(cVector.clone().multiplyScalar(centerLm.z * 15))
                
                for(let idx = 0; idx < face.length; idx++) {
                    const lm = face[idx]
                    const px = windowWidth - (offsetX + lm.x * displayedWidth)
                    const py = offsetY + lm.y * displayedHeight
                    
                    const ndcX = (px / windowWidth) * 2 - 1
                    const ndcY = -(py / windowHeight) * 2 + 1
                    
                    const vector = new THREE.Vector3(ndcX, ndcY, 0.5)
                    vector.unproject(camera)
                    vector.sub(camera.position).normalize()
                    
                    const pos = new THREE.Vector3().copy(camera.position).add(vector.clone().multiplyScalar(5))
                    pos.add(vector.clone().multiplyScalar(lm.z * 15))
                    
                    // Scale outward from face center
                    if (appSettings.faceMaskScale !== 1.0) {
                        pos.sub(centerPos).multiplyScalar(appSettings.faceMaskScale).add(centerPos)
                    }
                    
                    projected[idx] = pos
                    
                    if (debugState.landmarks) {
                        dummy.position.copy(pos)
                        dummy.updateMatrix()
                        debugLandmarksMesh.setMatrixAt(sphereCount++, dummy.matrix)
                    }
                }
                
                const addFVertex = (p, effId) => {
                    facePositions[fVertCount * 3] = p.x
                    facePositions[fVertCount * 3 + 1] = p.y
                    facePositions[fVertCount * 3 + 2] = p.z
                    faceEffectIds[fVertCount] = effId
                    fVertCount++
                }
                
                let activeTriangles = faceTriangles
                if (appSettings.fillEyes || appSettings.fillMouth) {
                    activeTriangles = [...faceTriangles]
                    if (appSettings.fillEyes) {
                        activeTriangles = activeTriangles.concat([[468,33,246],[468,246,161],[468,161,160],[468,160,159],[468,159,158],[468,158,157],[468,157,173],[468,173,133],[468,133,155],[468,155,154],[468,154,153],[468,153,145],[468,145,144],[468,144,163],[468,163,7],[468,7,33]])
                        activeTriangles = activeTriangles.concat([[473,362,398],[473,398,384],[473,384,385],[473,385,386],[473,386,387],[473,387,388],[473,388,466],[473,466,263],[473,263,249],[473,249,390],[473,390,373],[473,373,374],[473,374,380],[473,380,381],[473,381,382],[473,382,362]])
                    }
                    if (appSettings.fillMouth) {
                        activeTriangles = activeTriangles.concat([[13,78,191],[13,191,80],[13,80,81],[13,81,82],[13,312,311],[13,311,310],[13,310,415],[13,415,308],[13,308,324],[13,324,318],[13,318,402],[13,402,317],[13,317,14],[13,14,87],[13,87,178],[13,178,88],[13,88,95],[13,95,78]])
                    }
                }
                
                activeTriangles.forEach((tri, i) => {
                    if (projected[tri[0]] && projected[tri[1]] && projected[tri[2]]) {
                        let effectId = appSettings.faceMaskEffect;
                        
                        if (appSettings.randomizeFace || appSettings.enableFaceSections) {
                            const lm0 = face[tri[0]];
                            const lm1 = face[tri[1]];
                            const lm2 = face[tri[2]];
                            const cx = (lm0.x + lm1.x + lm2.x) / 3;
                            const cy = (lm0.y + lm1.y + lm2.y) / 3;
                            
                            const anchors = [
                                face[10],  // 0: Forehead
                                face[152], // 1: Chin
                                face[14],  // 2: Lips
                                face[159], // 3: Eye R
                                face[386], // 4: Eye L
                                face[117], // 5: Cheek R
                                face[346]  // 6: Cheek L
                            ];
                            
                            let minAreaIndex = 0;
                            let minDst = Infinity;
                            
                            anchors.forEach((anchor, idx) => {
                                if (!anchor) return;
                                const d = Math.hypot(cx - anchor.x, cy - anchor.y);
                                if (d < minDst) {
                                    minDst = d;
                                    minAreaIndex = idx;
                                }
                            });
                            
                            if (appSettings.enableFaceSections) {
                                const sectionEffects = [
                                    appSettings.faceSecForehead,
                                    appSettings.faceSecChin,
                                    appSettings.faceSecLips,
                                    appSettings.faceSecEyeR,
                                    appSettings.faceSecEyeL,
                                    appSettings.faceSecCheekR,
                                    appSettings.faceSecCheekL
                                ];
                                const secEff = sectionEffects[minAreaIndex];
                                if (secEff !== -1) effectId = secEff;
                            } else {
                                effectId = currentEffects[minAreaIndex % currentEffects.length];
                            }
                        }
                            
                        addFVertex(projected[tri[0]], effectId)
                        addFVertex(projected[tri[1]], effectId)
                        addFVertex(projected[tri[2]], effectId)
                    }
                })
            }
        }
        faceGeo.setDrawRange(0, fVertCount)
        faceGeo.attributes.position.needsUpdate = true
        faceGeo.attributes.aEffectId.needsUpdate = true
      } else {
        faceGeo.setDrawRange(0, 0)
      }
      
      if (debugState.landmarks) {
        debugLandmarksMesh.count = sphereCount
        debugLandmarksMesh.instanceMatrix.needsUpdate = true
      } else {
        debugLandmarksMesh.count = 0
        debugLandmarksMesh.instanceMatrix.needsUpdate = true
      }
    }
  }

    // Audio Beat Detection
    if (isAudioPlaying && appSettings.beatMatch) {
      if (typeof window.beatEnvelope === 'undefined') window.beatEnvelope = 0;
      
      const currentLow = pointsMat.uniforms.uAudioLow.value;
      
      // Decay the envelope smoothly
      window.beatEnvelope *= 0.98; // Slow decay
      
      // Trigger if current energy spikes above the decaying envelope
      if (currentLow > window.beatEnvelope * 1.15 && currentLow > 0.6) {
        const now = performance.now();
        if (!window.lastBeatTime || now - window.lastBeatTime > 400) { // 400ms cooldown
          randomizeEffects();
          window.lastBeatTime = now;
        }
      }
      
      // Update envelope with current energy (if it's higher, it pushes the envelope up)
      if (currentLow > window.beatEnvelope) {
          window.beatEnvelope = currentLow;
      }
    }

    if (globalShaderPass) {
      globalShaderPass.uniforms.uTime.value = time;
      globalShaderPass.uniforms.uAudioLow.value = pointsMat.uniforms.uAudioLow.value;
      globalShaderPass.uniforms.uAudioMid.value = pointsMat.uniforms.uAudioMid.value;
      globalShaderPass.uniforms.uAudioHigh.value = pointsMat.uniforms.uAudioHigh.value;
      if (video.videoWidth && video.videoHeight) {
        globalShaderPass.uniforms.uVideoSize.value.set(video.videoWidth, video.videoHeight);
        const pixelRatio = renderer.getPixelRatio();
        globalShaderPass.uniforms.uResolution.value.set(container.clientWidth * pixelRatio, container.clientHeight * pixelRatio);
      }
    }

  controls.update()
  composer.render()
}

// Render loop setup
renderer.setAnimationLoop(animate)

// Autoplay default music on first user interaction to bypass browser autoplay policies
const autoPlayHandler = () => {
  if (!isAudioPlaying) {
    audioParams.playDefaultMusic();
  }
  document.removeEventListener('click', autoPlayHandler);
  document.removeEventListener('touchstart', autoPlayHandler);
};
document.addEventListener('click', autoPlayHandler);
document.addEventListener('touchstart', autoPlayHandler);

// API EXPORTS
return {
  uploadMusic: audioParams.uploadMusic,
  playDefaultMusic: audioParams.playDefaultMusic,
  setBgEffect: (val) => {
      bgGuiState.bgEffect = parseInt(val)
      updateShaderMaterial()
  },
  updateSettings: (key, val) => {
      if (key.startsWith('quad')) {
          const idx = parseInt(key.replace('quad', ''))
          currentEffects[idx] = parseInt(val)
          updateShaderMaterial()
      } else if (key.startsWith('faceSec') || key === 'enableFaceSections') {
          appSettings[key] = key === 'enableFaceSections' ? val : parseInt(val)
          updateShaderMaterial()
      } else {
          appSettings[key] = val
          if (key === 'enableFingers' && !val) {
              pointsGeo.setDrawRange(0, 0)
              debugLandmarksMesh.count = 0
          }
          if (key === 'enableFaceMask' && !val) {
              faceGeo.setDrawRange(0, 0)
          }
          if (key === 'faceMaskEffect') {
              updateShaderMaterial()
          }
      }
  },
  updateDebug: (key, val) => {
      debugState[key] = val
      debugLandmarksMesh.visible = debugState.landmarks
      debugQuadsMesh.visible = debugState.wireframes
      debugFaceQuadsMesh.visible = debugState.wireframes
  },
  randomizeEffects: randomizeEffects,
  getCurrentEffects: () => currentEffects,
  setOnEffectsChanged: (cb) => { onEffectsChangedCallback = cb },
  destroy: () => {
      window.removeEventListener('resize', handleResize)
      container.removeChild(renderer.domElement)
  }
}

}
