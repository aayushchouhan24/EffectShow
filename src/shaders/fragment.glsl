uniform sampler2D uVideo;
uniform vec2 uResolution;
uniform vec2 uVideoSize;
uniform float uTime;
uniform float uAudioLow;
uniform float uAudioMid;
uniform float uAudioHigh;

varying float vEffectId;

// Random 2D helper
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float videoAspect = uVideoSize.x / uVideoSize.y;
  float windowAspect = uResolution.x / uResolution.y;
  
  vec2 videoUv = uv;
  if (windowAspect > videoAspect) {
    float scale = windowAspect / videoAspect;
    videoUv.y = (uv.y - 0.5) / scale + 0.5;
  } else {
    float scale = videoAspect / windowAspect;
    videoUv.x = (uv.x - 0.5) / scale + 0.5;
  }
  videoUv.x = 1.0 - videoUv.x; 
  
  int effect = int(vEffectId + 0.5);
  int uvEffect = effect / 10;      // 0 to 12
  int colorEffect = effect - (uvEffect * 10); // 0 to 9
  
  vec2 effectUv = videoUv;
  
  // UV Distortions (13 Types)
  if (uvEffect == 1) {
      effectUv.y += sin(effectUv.x * 20.0 + uTime * 5.0) * (0.02 + uAudioLow * 0.1);
  } else if (uvEffect == 2) {
      effectUv.x += cos(effectUv.y * 30.0 - uTime * 5.0) * (0.02 + uAudioMid * 0.1);
  } else if (uvEffect == 3) {
      float pixels = 20.0 + uAudioHigh * 100.0;
      effectUv = floor(effectUv * pixels) / pixels;
  } else if (uvEffect == 4) {
      float dist = distance(effectUv, vec2(0.5));
      effectUv += (effectUv - 0.5) * sin(dist * 20.0 - uTime * 10.0) * (0.05 + uAudioLow * 0.2);
  } else if (uvEffect == 5) {
      if (mod(effectUv.y * 50.0 + uTime * 10.0, 2.0) > 1.0) {
          effectUv.x += 0.05 * uAudioHigh;
      }
  } else if (uvEffect == 6) {
      float scanline = sin(effectUv.y * 800.0) * (0.01 + uAudioMid * 0.05);
      effectUv.x += scanline;
  } else if (uvEffect == 7) {
      float angle = distance(effectUv, vec2(0.5)) * (5.0 + uAudioLow * 10.0) - uTime;
      float s = sin(angle), c = cos(angle);
      vec2 diff = effectUv - 0.5;
      effectUv = vec2(diff.x * c - diff.y * s, diff.x * s + diff.y * c) + 0.5;
  } else if (uvEffect == 8) {
      effectUv.x = abs(effectUv.x - 0.5) + 0.5;
  } else if (uvEffect == 9) {
      effectUv.y = abs(effectUv.y - 0.5) + 0.5;
  } else if (uvEffect == 10) {
      effectUv = (effectUv - 0.5) * (1.0 - uAudioLow * 0.5) + 0.5;
  } else if (uvEffect == 11) {
      effectUv.y += abs(sin(effectUv.x * 10.0)) * 0.1 * uAudioMid;
  } else if (uvEffect == 12) {
      float rnd = fract(sin(dot(effectUv.xy, vec2(12.9898,78.233))) * 43758.5453123);
      effectUv += (vec2(rnd) - 0.5) * 0.1 * uAudioHigh;
  }
  
  vec4 baseColor = texture2D(uVideo, effectUv);
  vec4 outColor = baseColor;
  
  // Color Modifiers (10 Types)
  if (colorEffect == 0) {
      outColor.rgb = 1.0 - baseColor.rgb; // Inverted
  } else if (colorEffect == 1) {
      outColor.rgb = baseColor.rgb; // Normal
  } else if (colorEffect == 2) {
      float g = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
      outColor.rgb = vec3(g); // Grayscale
  } else if (colorEffect == 3) {
      float g = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
      outColor.rgb = vec3(g * 1.2, g * 0.9, g * 0.6) + (uAudioMid * 0.2); // Sepia
  } else if (colorEffect == 4) {
      float steps = max(2.0, 3.0 + uAudioHigh * 10.0);
      outColor.rgb = floor(baseColor.rgb * steps) / steps; // Posterize
  } else if (colorEffect == 5) {
      vec3 red = vec3(1.0, 0.0, 0.2);
      vec3 blue = vec3(0.0, 0.5, 1.0);
      outColor.rgb = mix(red, blue, baseColor.r + uAudioLow * 0.5); // Duotone
  } else if (colorEffect == 6) {
      outColor.r = texture2D(uVideo, effectUv + vec2(0.02 * uAudioHigh, 0.0)).r;
      outColor.b = texture2D(uVideo, effectUv - vec2(0.02 * uAudioHigh, 0.0)).b; // RGB Split
  } else if (colorEffect == 7) {
      outColor.rgb = mod(baseColor.rgb + uTime * 0.2 + uAudioMid, 1.0); // Hue Rotate / Psychedelic
  } else if (colorEffect == 8) {
      float edge = distance(baseColor.rgb, texture2D(uVideo, effectUv + vec2(0.005)).rgb);
      outColor.rgb = mix(vec3(0.0), vec3(0.0, 1.0, 0.5), edge * 5.0 + uAudioHigh); // Neon Edge
  } else if (colorEffect == 9) {
      outColor.rgb = pow(abs(baseColor.rgb), vec3(0.5 - clamp(uAudioLow * 0.3, 0.0, 0.4))); // Extreme Contrast
  }
  
  gl_FragColor = vec4(outColor.rgb, 1.0);
}
