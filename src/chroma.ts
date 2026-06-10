/**
 * Processador de chroma key em WebGL2 — todo o ajuste de pixel roda na GPU.
 * Shader baseado na técnica clássica de distância de crominância (YUV),
 * com suavização de borda e supressão de reflexo (spill).
 */

export interface ChromaSettings {
  enabled: boolean
  /** cor-chave em RGB 0–255 */
  key: [number, number, number]
  /** 0–1: raio de corte na crominância */
  similarity: number
  /** 0–1: largura da rampa de transparência na borda */
  smoothness: number
  /** 0–1: alcance da supressão de reflexo da cor-chave */
  spill: number
  /** 0–1: erosão da borda do matte para remover o halo/franja restante */
  halo: number
}

export const DEFAULT_SETTINGS: ChromaSettings = {
  enabled: true,
  key: [0, 255, 0],
  similarity: 0.054,
  smoothness: 0.202,
  spill: 0.225,
  halo: 0.312,
}

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  // flip vertical: ImageBitmap chega com a linha 0 no topo
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec3 u_key;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
uniform float u_halo;
uniform vec2 u_texel;
uniform int u_enabled;
in vec2 v_uv;
out vec4 o;

vec2 rgb2uv(vec3 c) {
  return vec2(
    c.r * -0.169 + c.g * -0.331 + c.b *  0.5,
    c.r *  0.5   + c.g * -0.419 + c.b * -0.081
  );
}

float matte(vec3 c) {
  float dist = distance(rgb2uv(c), rgb2uv(u_key));
  return pow(clamp((dist - u_similarity) / max(u_smoothness, 1e-4), 0.0, 1.0), 1.5);
}

void main() {
  vec4 px = texture(u_tex, v_uv);
  if (u_enabled == 0) { o = px; return; }

  float alpha = matte(px.rgb);

  // remoção de halo: erode o matte usando o mínimo dos vizinhos,
  // encolhendo a borda e descartando a franja contaminada pelo fundo
  if (u_halo > 0.0) {
    vec2 t = u_texel * (u_halo * 6.0);
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2( t.x, 0.0)).rgb));
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2(-t.x, 0.0)).rgb));
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2(0.0,  t.y)).rgb));
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2(0.0, -t.y)).rgb));
    vec2 d = t * 0.7071;
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2( d.x,  d.y)).rgb));
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2(-d.x,  d.y)).rgb));
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2( d.x, -d.y)).rgb));
    alpha = min(alpha, matte(texture(u_tex, v_uv + vec2(-d.x, -d.y)).rgb));
  }

  float base = distance(rgb2uv(px.rgb), rgb2uv(u_key)) - u_similarity;
  float spillMask = pow(clamp(base / max(u_spill, 1e-4), 0.0, 1.0), 1.5);

  float gray = dot(px.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 rgb = mix(vec3(gray), px.rgb, spillMask);

  o = vec4(rgb, alpha * px.a);
}`

export class ChromaProcessor {
  readonly canvas = document.createElement('canvas')
  private gl: WebGL2RenderingContext
  private uKey: WebGLUniformLocation
  private uSim: WebGLUniformLocation
  private uSmooth: WebGLUniformLocation
  private uSpill: WebGLUniformLocation
  private uHalo: WebGLUniformLocation
  private uTexel: WebGLUniformLocation
  private uEnabled: WebGLUniformLocation

  constructor() {
    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      alpha: true,
    })
    if (!gl) throw new Error('WebGL2 indisponível neste navegador')
    this.gl = gl

    const prog = gl.createProgram()!
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Erro no shader: ' + gl.getShaderInfoLog(sh))
      }
      gl.attachShader(prog, sh)
    }
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Erro ao linkar programa: ' + gl.getProgramInfoLog(prog))
    }
    gl.useProgram(prog)

    // quad fullscreen
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.uKey = gl.getUniformLocation(prog, 'u_key')!
    this.uSim = gl.getUniformLocation(prog, 'u_similarity')!
    this.uSmooth = gl.getUniformLocation(prog, 'u_smoothness')!
    this.uSpill = gl.getUniformLocation(prog, 'u_spill')!
    this.uHalo = gl.getUniformLocation(prog, 'u_halo')!
    this.uTexel = gl.getUniformLocation(prog, 'u_texel')!
    this.uEnabled = gl.getUniformLocation(prog, 'u_enabled')!
  }

  /**
   * Renderiza um frame com as configurações atuais e retorna o canvas interno
   * (desenhe-o em outro lugar com drawImage logo em seguida).
   */
  render(src: ImageBitmap, s: ChromaSettings): HTMLCanvasElement {
    const { gl } = this
    if (this.canvas.width !== src.width || this.canvas.height !== src.height) {
      this.canvas.width = src.width
      this.canvas.height = src.height
    }
    gl.viewport(0, 0, src.width, src.height)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)

    gl.uniform3f(this.uKey, s.key[0] / 255, s.key[1] / 255, s.key[2] / 255)
    gl.uniform1f(this.uSim, s.similarity)
    gl.uniform1f(this.uSmooth, s.smoothness)
    gl.uniform1f(this.uSpill, s.spill)
    gl.uniform1f(this.uHalo, s.halo)
    gl.uniform2f(this.uTexel, 1 / src.width, 1 / src.height)
    gl.uniform1i(this.uEnabled, s.enabled ? 1 : 0)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }
}
