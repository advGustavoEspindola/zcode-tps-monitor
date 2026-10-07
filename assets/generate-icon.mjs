#!/usr/bin/env node
// Gera o ícone do plugin assets/icon.png (256×256, supersamostragem 4× para antisserrilhado).
// Implementação pura em Node, sem dependências: desenha as formas com SDF (campo de distância com sinal)
// e codifica o PNG com zlib.
// Uso: node assets/generate-icon.mjs [caminho de saída] [tamanho]
//   node assets/generate-icon.mjs                # assets/icon.png 256px
//   node assets/generate-icon.mjs preview 32     # prévia em tamanho pequeno (verifica a legibilidade em 16~32px)

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const OUT = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : path.join(path.dirname(url.fileURLToPath(import.meta.url)), "icon.png");
const SIZE = Number(process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : process.argv[3]) || 256;
const SS = 4; // fator de supersamostragem
const W = SIZE * SS;

// ---------- SDFs básicos ----------
const sdRoundedRect = (px, py, cx, cy, hx, hy, r) => {
  const dx = Math.abs(px - cx) - (hx - r), dy = Math.abs(py - cy) - (hy - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdSegment = (px, py, ax, ay, bx, by, r) => {
  const abx = bx - ax, aby = by - ay, apx = px - ax, apy = py - ay;
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  return Math.hypot(apx - abx * t, apy - aby * t) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
// Arco de anel: em graus, coordenadas de tela (y para baixo), ângulo cresce no sentido horário, 0° = leste
function sdArc(px, py, cx, cy, R, halfW, a0, a1) {
  const dx = px - cx, dy = py - cy;
  const dist = Math.abs(Math.hypot(dx, dy) - R) - halfW;
  const norm = (a) => {
    let x = a % 360;
    if (x < 0) x += 360;
    return x;
  };
  let d = norm(a1 - a0), t = norm(px === 0 && py === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI - a0);
  return t >= 0 && t <= d ? dist : Math.hypot(dx, dy) - R - halfW + 1e9 * 0; // a distância do ponto extremo fora do arco é aproximada pela diferença de raios
}
function arcDist(px, py, cx, cy, R, halfW, a0, a1) {
  const dx = px - cx, dy = py - cy;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const norm = (a) => ((a % 360) + 360) % 360;
  const sweep = norm(a1 - a0) || 360;
  const rel = norm(ang - a0);
  if (rel <= sweep) return Math.abs(Math.hypot(dx, dy) - R) - halfW;
  // Fora do intervalo do arco: pega a menor distância até os dois pontos extremos (as pontas do arco)
  const rad = (d) => (d * Math.PI) / 180;
  const e0 = [cx + R * Math.cos(rad(a0)), cy + R * Math.sin(rad(a0))];
  const e1 = [cx + R * Math.cos(rad(a1)), cy + R * Math.sin(rad(a1))];
  const dEnd = (e) => Math.max(Math.hypot(px - e[0], py - e[1]) - halfW, Math.abs(Math.hypot(px - cx, py - cy) - R) - halfW - 1e9);
  // Tampa circular da ponta: um círculo de raio halfW centrado no ponto extremo, intersectando a faixa anelar; simplificado como o círculo da ponta
  const cap = (e) => Math.hypot(px - e[0], py - e[1]) - halfW;
  return Math.min(cap(e0), cap(e1), dEnd(e0), dEnd(e1));
}

// ---------- Paleta de cores ----------
const mix = (c1, c2, t) => c1.map((v, i) => v + (c2[i] - v) * t);
const BG_TOP = [47, 84, 235];     // #2F54EB índigo
const BG_BOT = [13, 20, 66];      // #0D1442 azul-noite
const TRACK = [255, 255, 255];
const GLOW = [34, 211, 238];      // #22D3EE ciano
const FAST = [74, 222, 128];      // #4ADE80 verde
const WHITE = [255, 255, 255];

// ---------- Parâmetros da cena (descritos no sistema de coordenadas 256, multiplicados por SS ao desenhar) ----------
// S precisa ser convertido para a tela de supersamostragem: W = SIZE×SS, logo S = W/256 (e não SIZE/256,
// caso contrário o conteúdo seria desenhado só no quarto superior esquerdo da tela, com o resto transparente —
// a causa raiz do "ícone encolhido no canto superior esquerdo").
const S = W / 256;
const C = [128, 124];              // centro do mostrador (centralizado horizontalmente)
const R = 64;                      // raio do arco
const RING = 13;                   // meia-largura do anel
const A0 = 135, SWEEP = 270;       // início embaixo à esquerda, 270° no sentido horário
const PROG = 0.72;                 // proporção do progresso (alta velocidade)
const NEEDLE_A = A0 + SWEEP * PROG;

function coverage(px, py) {
  // Fundo: quadrado arredondado + gradiente diagonal + brilho suave no topo
  const bg = sdRoundedRect(px, py, 128 * S, 128 * S, 124 * S, 124 * S, 56 * S);
  const g = Math.min(1, Math.max(0, (px / W) * 0.55 + (py / W) * 0.45));
  let col = mix(BG_TOP, BG_BOT, g);
  const glow = Math.max(0, 1 - Math.hypot(px - 88 * S, py - 52 * S) / (170 * S));
  col = mix(col, [90, 130, 255], glow * 0.25);

  const aa = 0.8 * SS; // faixa de transição de 1px na resolução de saída
  const cov = (d) => Math.min(1, Math.max(0, 0.5 - d / (aa * 2)));

  // Trilho do mostrador (branco semitransparente, claro o bastante para garantir que o círculo inteiro fique visível)
  const track = arcDist(px, py, C[0] * S, C[1] * S, R * S, RING * S, A0, A0 + SWEEP);
  const tCov = cov(track);
  if (tCov > 0) col = mix(col, TRACK, tCov * 0.30);

  // Arco de progresso: gradiente ciano→verde + leve brilho externo
  const a1 = A0 + SWEEP * PROG;
  const prog = arcDist(px, py, C[0] * S, C[1] * S, R * S, RING * S, A0, a1);
  const pCov = cov(prog);
  if (pCov > 0) {
    const t = Math.min(1, Math.max(0, ((Math.atan2(py - C[1] * S, px - C[0] * S) * 180) / Math.PI - A0 + 360) % 360 / (SWEEP * PROG)));
    col = mix(col, mix(GLOW, FAST, t), pCov);
  }
  const halo = Math.max(0, 1 - Math.max(0, prog - RING * S) / (18 * S));
  if (halo > 0 && prog > 0) col = mix(col, GLOW, halo * halo * 0.15);

  // Ponteiro: branco, com ponta arredondada; termina do lado interno do arco, deixando um vão
  const nA = (NEEDLE_A * Math.PI) / 180;
  const tip = [C[0] * S + (R - RING - 9) * S * Math.cos(nA), C[1] * S + (R - RING - 9) * S * Math.sin(nA)];
  const needle = sdSegment(px, py, C[0] * S, C[1] * S, tip[0], tip[1], 7 * S);
  const nCov = cov(needle);
  if (nCov > 0) col = mix(col, WHITE, nCov);

  // Eixo central: círculo branco + ponto colorido no centro
  const hub = sdCircle(px, py, C[0] * S, C[1] * S, 12 * S);
  const hCov = cov(hub);
  if (hCov > 0) col = mix(col, WHITE, hCov);
  const hubDot = sdCircle(px, py, C[0] * S, C[1] * S, 5 * S);
  const dCov = cov(hubDot);
  if (dCov > 0) col = mix(col, BG_TOP, dCov);

  const bgCov = cov(bg);
  return { col, a: bgCov };
}

// ---------- Renderização + redução por caixa 4× ----------
const px = new Float64Array(W * W * 3);
const al = new Float64Array(W * W);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const { col, a } = coverage(x + 0.5, y + 0.5);
    const i = (y * W + x) * 3;
    px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
    al[y * W + x] = a;
  }
}
const n = SIZE, out = Buffer.alloc(n * n * 4);
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const si = ((y * SS + dy) * W + x * SS + dx) * 3, sa = al[(y * SS + dy) * W + x * SS + dx];
      r += px[si] * sa; g += px[si + 1] * sa; b += px[si + 2] * sa; a += sa;
    }
    const o = (y * n + x) * 4;
    out[o] = a ? Math.round(r / a) : 0;
    out[o + 1] = a ? Math.round(g / a) : 0;
    out[o + 2] = a ? Math.round(b / a) : 0;
    out[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

// ---------- Codificação PNG ----------
const crcTable = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
ihdr[8] = 8; ihdr[9] = 6; // RGBA 8 bits
const raw = Buffer.alloc((n * 4 + 1) * n);
for (let y = 0; y < n; y++) {
  raw[y * (n * 4 + 1)] = 0;
  out.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`OK ${OUT} ${n}x${n} ${png.length} bytes`);
