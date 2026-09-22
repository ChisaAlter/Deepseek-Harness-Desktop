/**
 * Pointer-driven WebGL fluid splash (指针特效 · 流体飞溅): a Navier-Stokes
 * dye solver ported from the SplashCursor reference (ayase.cn/motion →
 * ReactBits `SplashCursor`, itself a port of Pavel Dobryakov's MIT WebGL
 * fluid simulation). Pointer motion splats colored dye plus velocity into a
 * low-res sim grid; curl/vorticity/pressure passes make the dye swirl, and
 * the display pass composites it over the page.
 *
 * The sim runs only while mounted by `applyCursorFxLayer` (or the settings
 * preview). Its rAF loop idles out {@link FLUID_IDLE_MS} after the last
 * pointer input and pauses while the document is hidden. `update` re-tunes
 * speed/size/colors live; only an effect switch rebuilds the canvas.
 */

import type { CursorFxConfig, CursorFxHandle } from './cursor-fx.ts'

/** Sim grid short-edge resolution (the long edge scales by aspect). */
const SIM_RESOLUTION = 128
/** Dye texture short-edge resolution. */
const DYE_RESOLUTION = 1440
/** Dye fade rate at speed 100%; scales with the speed slider. */
const BASE_DENSITY_DISSIPATION = 3.5
/** Velocity fade rate; not exposed to the slider. */
const VELOCITY_DISSIPATION = 2
/** Pressure solver decay per iteration. */
const PRESSURE = 0.1
/** Jacobi iterations per frame. */
const PRESSURE_ITERATIONS = 20
/** Vorticity confinement strength. */
const CURL = 3
/** Splat radius at size 100% (percent units divided by 100 below). */
const BASE_SPLAT_RADIUS = 0.2
/** Pointer delta → velocity multiplier at speed 100%. */
const BASE_SPLAT_FORCE = 6000
/** Dye color cycling speed at speed 100%. */
const BASE_COLOR_UPDATE_SPEED = 10
/** Dye brightness multiplier (the reference look keeps dye dim and additive). */
const DYE_INTENSITY = 0.15
/** Idle tail: the loop keeps stepping this long after the last input so the
 *  dye visibly dissipates, then stops until the next pointer event. */
const FLUID_IDLE_MS = 4000

interface Rgb {
  r: number
  g: number
  b: number
}

interface TextureFormat {
  internalFormat: number
  format: number
}

interface GlExtensions {
  formatRGBA: TextureFormat
  formatRG: TextureFormat
  formatR: TextureFormat
  halfFloatTexType: number
  supportLinearFiltering: boolean
}

interface FluidPointer {
  texcoordX: number
  texcoordY: number
  prevTexcoordX: number
  prevTexcoordY: number
  deltaX: number
  deltaY: number
  moved: boolean
  color: Rgb
}

interface FBO {
  texture: WebGLTexture
  fbo: WebGLFramebuffer
  width: number
  height: number
  texelSizeX: number
  texelSizeY: number
  attach: (id: number) => number
}

interface DoubleFBO {
  width: number
  height: number
  texelSizeX: number
  texelSizeY: number
  read: FBO
  write: FBO
  swap: () => void
}

function hexToRGB(hex: string): Rgb {
  const value = hex.replace('#', '')
  return {
    r: (parseInt(value.slice(0, 2), 16) / 255) * DYE_INTENSITY,
    g: (parseInt(value.slice(2, 4), 16) / 255) * DYE_INTENSITY,
    b: (parseInt(value.slice(4, 6), 16) / 255) * DYE_INTENSITY,
  }
}

function HSVtoRGB(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p }
    case 1: return { r: q, g: v, b: p }
    case 2: return { r: p, g: v, b: t }
    case 3: return { r: p, g: q, b: v }
    case 4: return { r: t, g: p, b: v }
    default: return { r: v, g: p, b: q }
  }
}

function supportRenderTextureFormat(
  gl: WebGLRenderingContext,
  internalFormat: number,
  format: number,
  type: number,
): boolean {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
}

function getSupportedFormat(
  gl: WebGLRenderingContext,
  internalFormat: number,
  format: number,
  type: number,
): TextureFormat | null {
  if (supportRenderTextureFormat(gl, internalFormat, format, type)) {
    return { internalFormat, format }
  }
  const gl2 = gl as WebGL2RenderingContext
  if (!('drawBuffers' in gl2)) return null
  switch (internalFormat) {
    case gl2.R16F:
      return getSupportedFormat(gl, gl2.RG16F, gl2.RG, type)
    case gl2.RG16F:
      return getSupportedFormat(gl, gl2.RGBA16F, gl2.RGBA, type)
    default:
      return null
  }
}

/** Acquire a float-renderable GL context, or null (jsdom / headless / no GPU). */
function getWebGLContext(canvas: HTMLCanvasElement): {
  gl: WebGLRenderingContext
  ext: GlExtensions
} | null {
  const params: WebGLContextAttributes = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  }
  let gl = canvas.getContext('webgl2', params) as WebGLRenderingContext | null
  gl ??= canvas.getContext('webgl', params)
  if (gl === null) return null

  const isWebGL2 = 'drawBuffers' in gl
  let supportLinearFiltering = false
  let halfFloat: OES_texture_half_float | null = null
  if (isWebGL2) {
    ;(gl as WebGL2RenderingContext).getExtension('EXT_color_buffer_float')
    supportLinearFiltering = (gl as WebGL2RenderingContext).getExtension('OES_texture_float_linear') !== null
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float')
    supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear') !== null
  }
  const halfFloatTexType = isWebGL2
    ? (gl as WebGL2RenderingContext).HALF_FLOAT
    : (halfFloat?.HALF_FLOAT_OES ?? 0)

  let formatRGBA: TextureFormat | null
  let formatRG: TextureFormat | null
  let formatR: TextureFormat | null
  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext
    formatRGBA = getSupportedFormat(gl, gl2.RGBA16F, gl.RGBA, halfFloatTexType)
    formatRG = getSupportedFormat(gl, gl2.RG16F, gl2.RG, halfFloatTexType)
    formatR = getSupportedFormat(gl, gl2.R16F, gl2.RED, halfFloatTexType)
  } else {
    formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
    formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
    formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
  }
  if (formatRGBA === null || formatRG === null || formatR === null) return null
  return { gl, ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering } }
}

function hashCode(value: string): number {
  if (value.length === 0) return 0
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return hash
}

function addKeywords(source: string, keywords: string[] | null): string {
  if (keywords === null) return source
  return keywords.map(keyword => `#define ${keyword}\n`).join('') + source
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
  keywords: string[] | null = null,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, addKeywords(source, keywords))
  gl.compileShader(shader)
  return shader
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader | null,
  fragmentShader: WebGLShader | null,
): WebGLProgram | null {
  if (vertexShader === null || fragmentShader === null) return null
  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  return program
}

function getUniforms(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
): Record<string, WebGLUniformLocation | null> {
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < uniformCount; i += 1) {
    const info = gl.getActiveUniform(program, i)
    if (info !== null) uniforms[info.name] = gl.getUniformLocation(program, info.name)
  }
  return uniforms
}

/**
 * Mount the fluid sim on a canvas and return its control handle. Coordinates
 * are client-space CSS pixels; the engine maps them through the canvas rect.
 * Fails closed (`null`) without a float-renderable GL context so the caller
 * can leave no DOM residue.
 * @param canvas - target canvas (fullscreen layer or the settings preview).
 * @param config - resolved palette, speed percent, and size percent.
 * @returns the engine handle, or `null` when the sim cannot run.
 */
export function mountFluidCursor(canvas: HTMLCanvasElement, config: CursorFxConfig): CursorFxHandle | null {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return null
  const context = getWebGLContext(canvas)
  if (context === null) return null
  const { gl, ext } = context

  let palette = config.colors.length > 0 ? config.colors.map(hexToRGB) : null
  let splatRadius = BASE_SPLAT_RADIUS * (config.size / 100)
  let splatForce = BASE_SPLAT_FORCE * (config.speed / 100)
  let densityDissipation = BASE_DENSITY_DISSIPATION * (config.speed / 100)
  let colorUpdateSpeed = BASE_COLOR_UPDATE_SPEED * (config.speed / 100)
  const shading = ext.supportLinearFiltering

  const pointer: FluidPointer = {
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    moved: false,
    color: { r: 0, g: 0, b: 0 },
  }

  const generateColor = (): Rgb => {
    const c = palette !== null && palette.length > 0
      ? palette[Math.floor(Math.random() * palette.length)]
      : undefined
    if (c !== undefined) return { r: c.r, g: c.g, b: c.b }
    const hsv = HSVtoRGB(Math.random(), 1.0, 1.0)
    return { r: hsv.r * DYE_INTENSITY, g: hsv.g * DYE_INTENSITY, b: hsv.b * DYE_INTENSITY }
  }

  const baseVertexShader = compileShader(gl, gl.VERTEX_SHADER, `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `)

  const copyShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
  `)

  const clearShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
  `)

  const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        #ifdef SHADING
            vec3 lc = texture2D(uTexture, vL).rgb;
            vec3 rc = texture2D(uTexture, vR).rgb;
            vec3 tc = texture2D(uTexture, vT).rgb;
            vec3 bc = texture2D(uTexture, vB).rgb;

            float dx = length(rc) - length(lc);
            float dy = length(tc) - length(bc);

            vec3 n = normalize(vec3(dx, dy, length(texelSize)));
            vec3 l = vec3(0.0, 0.0, 1.0);

            float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
            c *= diffuse;
        #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    }
  `

  const splatShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
  `)

  const advectionShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
        #ifdef MANUAL_FILTERING
            vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
            vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
            vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
            vec4 result = texture2D(uSource, coord);
        #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }
  `, ext.supportLinearFiltering ? null : ['MANUAL_FILTERING'])

  const divergenceShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;

        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `)

  const curlShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
  `)

  const vorticityShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `)

  const pressureShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `)

  const gradientSubtractShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `)

  const blit = (() => {
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
    const elemBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elemBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(0)
    return (target: FBO | null): void => {
      if (target === null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      } else {
        gl.viewport(0, 0, target.width, target.height)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
    }
  })()

  class Program {
    program: WebGLProgram | null
    uniforms: Record<string, WebGLUniformLocation | null>

    constructor(vertexShader: WebGLShader | null, fragmentShader: WebGLShader | null) {
      this.program = createProgram(gl, vertexShader, fragmentShader)
      this.uniforms = this.program !== null ? getUniforms(gl, this.program) : {}
    }

    bind(): void {
      if (this.program !== null) gl.useProgram(this.program)
    }
  }

  class Material {
    vertexShader: WebGLShader | null
    fragmentShaderSource: string
    programs: Record<number, WebGLProgram | null>
    activeProgram: WebGLProgram | null
    uniforms: Record<string, WebGLUniformLocation | null>

    constructor(vertexShader: WebGLShader | null, fragmentShaderSource: string) {
      this.vertexShader = vertexShader
      this.fragmentShaderSource = fragmentShaderSource
      this.programs = {}
      this.activeProgram = null
      this.uniforms = {}
    }

    setKeywords(keywords: string[]): void {
      let hash = 0
      for (const keyword of keywords) hash += hashCode(keyword)
      let program = this.programs[hash]
      if (program == null) {
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords)
        program = createProgram(gl, this.vertexShader, fragmentShader)
        this.programs[hash] = program
      }
      if (program === this.activeProgram) return
      if (program !== null) this.uniforms = getUniforms(gl, program)
      this.activeProgram = program
    }

    bind(): void {
      if (this.activeProgram !== null) gl.useProgram(this.activeProgram)
    }
  }

  function createFBO(
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): FBO {
    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id: number) {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        return id
      },
    }
  }

  function createDoubleFBO(
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): DoubleFBO {
    const first = createFBO(w, h, internalFormat, format, type, param)
    const second = createFBO(w, h, internalFormat, format, type, param)
    return {
      width: w,
      height: h,
      texelSizeX: first.texelSizeX,
      texelSizeY: first.texelSizeY,
      read: first,
      write: second,
      swap() {
        const tmp = this.read
        this.read = this.write
        this.write = tmp
      },
    }
  }

  function getResolution(resolution: number): { width: number; height: number } {
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    const aspectRatio = w / h
    const aspect = aspectRatio < 1 ? 1 / aspectRatio : aspectRatio
    const min = Math.round(resolution)
    const max = Math.round(resolution * aspect)
    return w > h ? { width: max, height: min } : { width: min, height: max }
  }

  const copyProgram = new Program(baseVertexShader, copyShader)
  const clearProgram = new Program(baseVertexShader, clearShader)
  const splatProgram = new Program(baseVertexShader, splatShader)
  const advectionProgram = new Program(baseVertexShader, advectionShader)
  const divergenceProgram = new Program(baseVertexShader, divergenceShader)
  const curlProgram = new Program(baseVertexShader, curlShader)
  const vorticityProgram = new Program(baseVertexShader, vorticityShader)
  const pressureProgram = new Program(baseVertexShader, pressureShader)
  const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader)
  const displayMaterial = new Material(baseVertexShader, displayShaderSource)
  displayMaterial.setKeywords(shading ? ['SHADING'] : [])

  let dye: DoubleFBO | undefined
  let velocity: DoubleFBO | undefined
  let divergence: FBO | undefined
  let curl: FBO | undefined
  let pressure: DoubleFBO | undefined

  function resizeFBO(
    target: FBO,
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): FBO {
    const next = createFBO(w, h, internalFormat, format, type, param)
    copyProgram.bind()
    if (copyProgram.uniforms.uTexture) gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
    blit(next)
    return next
  }

  function resizeDoubleFBO(
    target: DoubleFBO,
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): DoubleFBO {
    if (target.width === w && target.height === h) return target
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param)
    target.write = createFBO(w, h, internalFormat, format, type, param)
    target.width = w
    target.height = h
    target.texelSizeX = 1 / w
    target.texelSizeY = 1 / h
    return target
  }

  function initFramebuffers(): void {
    const simRes = getResolution(SIM_RESOLUTION)
    const dyeRes = getResolution(DYE_RESOLUTION)
    const texType = ext.halfFloatTexType
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST
    gl.disable(gl.BLEND)

    dye = dye === undefined
      ? createDoubleFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, texType, filtering)
      : resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, texType, filtering)
    velocity = velocity === undefined
      ? createDoubleFBO(simRes.width, simRes.height, ext.formatRG.internalFormat, ext.formatRG.format, texType, filtering)
      : resizeDoubleFBO(velocity, simRes.width, simRes.height, ext.formatRG.internalFormat, ext.formatRG.format, texType, filtering)
    divergence = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST)
    curl = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST)
    pressure = createDoubleFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST)
  }

  const scaleByPixelRatio = (input: number): number => Math.floor(input * (window.devicePixelRatio || 1))

  function resizeCanvas(): boolean {
    const width = Math.max(1, scaleByPixelRatio(canvas.clientWidth))
    const height = Math.max(1, scaleByPixelRatio(canvas.clientHeight))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      return true
    }
    return false
  }

  function splat(x: number, y: number, dx: number, dy: number, color: Rgb): void {
    if (velocity === undefined || dye === undefined) return
    splatProgram.bind()
    if (splatProgram.uniforms.uTarget) gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
    if (splatProgram.uniforms.aspectRatio) gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height)
    if (splatProgram.uniforms.point) gl.uniform2f(splatProgram.uniforms.point, x, y)
    if (splatProgram.uniforms.color) gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0)
    if (splatProgram.uniforms.radius) {
      const aspectRatio = canvas.width / canvas.height
      const radius = aspectRatio > 1 ? (splatRadius / 100) * aspectRatio : splatRadius / 100
      gl.uniform1f(splatProgram.uniforms.radius, radius)
    }
    blit(velocity.write)
    velocity.swap()
    if (splatProgram.uniforms.uTarget) gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0))
    if (splatProgram.uniforms.color) gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b)
    blit(dye.write)
    dye.swap()
  }

  function step(dt: number): void {
    if (velocity === undefined || dye === undefined
      || divergence === undefined || curl === undefined || pressure === undefined) return
    gl.disable(gl.BLEND)

    curlProgram.bind()
    if (curlProgram.uniforms.texelSize) {
      gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    if (curlProgram.uniforms.uVelocity) gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(curl)

    vorticityProgram.bind()
    if (vorticityProgram.uniforms.texelSize) {
      gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    if (vorticityProgram.uniforms.uVelocity) gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
    if (vorticityProgram.uniforms.uCurl) gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1))
    if (vorticityProgram.uniforms.curl) gl.uniform1f(vorticityProgram.uniforms.curl, CURL)
    if (vorticityProgram.uniforms.dt) gl.uniform1f(vorticityProgram.uniforms.dt, dt)
    blit(velocity.write)
    velocity.swap()

    divergenceProgram.bind()
    if (divergenceProgram.uniforms.texelSize) {
      gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    if (divergenceProgram.uniforms.uVelocity) gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(divergence)

    clearProgram.bind()
    if (clearProgram.uniforms.uTexture) gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
    if (clearProgram.uniforms.value) gl.uniform1f(clearProgram.uniforms.value, PRESSURE)
    blit(pressure.write)
    pressure.swap()

    pressureProgram.bind()
    if (pressureProgram.uniforms.texelSize) {
      gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    if (pressureProgram.uniforms.uDivergence) gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0))
    for (let i = 0; i < PRESSURE_ITERATIONS; i += 1) {
      if (pressureProgram.uniforms.uPressure) gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
      blit(pressure.write)
      pressure.swap()
    }

    gradientSubtractProgram.bind()
    if (gradientSubtractProgram.uniforms.texelSize) {
      gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    if (gradientSubtractProgram.uniforms.uPressure) {
      gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
    }
    if (gradientSubtractProgram.uniforms.uVelocity) {
      gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
    }
    blit(velocity.write)
    velocity.swap()

    advectionProgram.bind()
    if (advectionProgram.uniforms.texelSize) {
      gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    if (!ext.supportLinearFiltering && advectionProgram.uniforms.dyeTexelSize) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    const velocityId = velocity.read.attach(0)
    if (advectionProgram.uniforms.uVelocity) gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
    if (advectionProgram.uniforms.uSource) gl.uniform1i(advectionProgram.uniforms.uSource, velocityId)
    if (advectionProgram.uniforms.dt) gl.uniform1f(advectionProgram.uniforms.dt, dt)
    if (advectionProgram.uniforms.dissipation) {
      gl.uniform1f(advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION)
    }
    blit(velocity.write)
    velocity.swap()

    if (!ext.supportLinearFiltering && advectionProgram.uniforms.dyeTexelSize) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY)
    }
    if (advectionProgram.uniforms.uVelocity) gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
    if (advectionProgram.uniforms.uSource) gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1))
    if (advectionProgram.uniforms.dissipation) {
      gl.uniform1f(advectionProgram.uniforms.dissipation, densityDissipation)
    }
    blit(dye.write)
    dye.swap()
  }

  function render(): void {
    if (dye === undefined) return
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.BLEND)
    displayMaterial.bind()
    if (shading && displayMaterial.uniforms.texelSize) {
      gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight)
    }
    if (displayMaterial.uniforms.uTexture) {
      gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0))
    }
    blit(null)
  }

  let lastUpdateTime = Date.now()
  let colorUpdateTimer = 0
  let lastInputAt = Date.now()
  let frame = 0
  let disposed = false

  function calcDeltaTime(): number {
    const now = Date.now()
    const dt = Math.min((now - lastUpdateTime) / 1000, 0.016666)
    lastUpdateTime = now
    return dt
  }

  function updateFrame(): void {
    if (disposed) return
    frame = 0
    const dt = calcDeltaTime()
    if (resizeCanvas()) initFramebuffers()
    colorUpdateTimer += dt * colorUpdateSpeed
    if (colorUpdateTimer >= 1) {
      colorUpdateTimer = colorUpdateTimer % 1
      pointer.color = generateColor()
    }
    if (pointer.moved) {
      pointer.moved = false
      splat(pointer.texcoordX, pointer.texcoordY,
        pointer.deltaX * splatForce, pointer.deltaY * splatForce, pointer.color)
    }
    step(dt)
    render()
    // Idle tail: keep stepping while dye visibly dissipates, then park the
    // loop until the next pointer event wakes it.
    if (Date.now() - lastInputAt <= FLUID_IDLE_MS) {
      frame = requestAnimationFrame(updateFrame)
    }
  }

  function wake(): void {
    lastInputAt = Date.now()
    if (disposed || frame !== 0) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    frame = requestAnimationFrame(updateFrame)
  }

  function onVisibilityChange(): void {
    if (disposed) return
    if (document.visibilityState === 'hidden') {
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    } else if (Date.now() - lastInputAt <= FLUID_IDLE_MS && frame === 0) {
      frame = requestAnimationFrame(updateFrame)
    }
  }

  function correctDeltaX(delta: number): number {
    const aspectRatio = canvas.width / canvas.height
    return aspectRatio < 1 ? delta * aspectRatio : delta
  }

  function correctDeltaY(delta: number): number {
    const aspectRatio = canvas.width / canvas.height
    return aspectRatio > 1 ? delta / aspectRatio : delta
  }

  function toTexcoord(x: number, y: number): { tx: number; ty: number } {
    const rect = canvas.getBoundingClientRect()
    const posX = scaleByPixelRatio(x - rect.left)
    const posY = scaleByPixelRatio(y - rect.top)
    return { tx: posX / canvas.width, ty: 1 - posY / canvas.height }
  }

  resizeCanvas()
  initFramebuffers()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    update(next: CursorFxConfig): void {
      palette = next.colors.length > 0 ? next.colors.map(hexToRGB) : null
      splatRadius = BASE_SPLAT_RADIUS * (next.size / 100)
      splatForce = BASE_SPLAT_FORCE * (next.speed / 100)
      densityDissipation = BASE_DENSITY_DISSIPATION * (next.speed / 100)
      colorUpdateSpeed = BASE_COLOR_UPDATE_SPEED * (next.speed / 100)
    },
    pointerMove(x: number, y: number): void {
      const { tx, ty } = toTexcoord(x, y)
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.texcoordX = tx
      pointer.texcoordY = ty
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
      wake()
    },
    pointerDown(x: number, y: number): void {
      const { tx, ty } = toTexcoord(x, y)
      pointer.texcoordX = tx
      pointer.texcoordY = ty
      const color = generateColor()
      color.r *= 10
      color.g *= 10
      color.b *= 10
      splat(tx, ty, 10 * (Math.random() - 0.5), 30 * (Math.random() - 0.5), color)
      wake()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
