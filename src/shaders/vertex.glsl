varying vec2 vUv;
uniform float uTime;

void main() {
  vec3 pos = position;
  pos.z += sin(pos.x * 5.0 + uTime) * 0.1;
  pos.z += sin(pos.y * 5.0 + uTime) * 0.1;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  vUv = uv;
}
