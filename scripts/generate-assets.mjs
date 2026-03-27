/**
 * generate-assets.mjs
 * 1. 全ルートのOSRM形状データを取得 → osrm-preload.js
 * 2. サムネイルに必要なOSMタイルを事前ダウンロード → tiles/{z}/{x}/{y}.png
 *
 * 使い方: node scripts/generate-assets.mjs
 * 所要時間: 約5〜15分（OSMポリシー遵守のためレートリミットあり）
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const TILES_DIR = join(ROOT, 'tiles');

const UA = 'DriveKanto/1.0 (github.com/hagidai22kjic-gif/drive-kanto)';
const TILE_DELAY_MS = 150;   // OSM利用ポリシー遵守: ~6req/s 以下
const OSRM_DELAY_MS = 300;
const W = 320, H = 136, TILE = 256;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- タイル計算 ---
function lngLatToTile(lng, lat, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

function calcZoom(lats, lngs) {
  const pad = 0.25;
  const dLat = (Math.max(...lats) - Math.min(...lats)) * (1 + pad * 2) || 0.01;
  const dLng = (Math.max(...lngs) - Math.min(...lngs)) * (1 + pad * 2) || 0.01;
  for (let z = 14; z >= 6; z--) {
    const n = Math.pow(2, z);
    const pxPerDeg = (n * 256) / 360;
    if (dLng * pxPerDeg <= W && dLat * pxPerDeg * 1.4 <= H) return z;
  }
  return 7;
}

function simplifyCoords(coords, maxPts) {
  if (coords.length <= maxPts) return coords;
  const step = (coords.length - 1) / (maxPts - 1);
  return Array.from({length: maxPts}, (_, i) => coords[Math.round(i * step)]);
}

function calcNeededTiles(coords) {
  const lats = coords.map(c => c[1]);
  const lngs = coords.map(c => c[0]);
  const zoom = calcZoom(lats, lngs);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const center = lngLatToTile(centerLng, centerLat, zoom);
  const tilesX = Math.ceil(W / TILE) + 2;
  const tilesY = Math.ceil(H / TILE) + 2;
  const originX = center.x - Math.floor(tilesX / 2);
  const originY = center.y - Math.floor(tilesY / 2);
  const tiles = [];
  for (let ty = originY; ty < originY + tilesY + 1; ty++)
    for (let tx = originX; tx < originX + tilesX + 1; tx++)
      tiles.push({ z: zoom, x: tx, y: ty });
  return tiles;
}

// --- RC データ（index_5.html から抽出）---
const RC = {
"onsen_01":{"start":[35.262,139.152],"end":[35.254,139.02],"via":[[35.234,139.107]]},
"onsen_02":{"start":[36.595,138.85],"end":[36.618,138.596],"via":[[36.567,138.78]]},
"onsen_03":{"start":[37.005,140.039],"end":[37.12,139.97],"via":[[37.11,139.965]]},
"onsen_04":{"start":[36.725,139.69],"end":[36.869,139.676],"via":[[36.795,139.658]]},
"onsen_05":{"start":[35.79,139.25],"end":[35.805,139.103],"via":[[35.815,139.065]]},
"onsen_06":{"start":[35.992,139.086],"end":[35.926,138.892],"via":[[35.96,138.99]]},
"onsen_07":{"start":[36.5800,138.8500],"end":[36.6111,138.7833],"via":[[36.5900,138.7900]]},
"onsen_08":{"start":[36.5000,138.7000],"end":[36.6222,138.5961],"via":[[36.5800,138.6500]]},
"onsen_09":{"start":[37.005,140.039],"end":[37.0889,140.0583],"via":[[37.0700,140.0700]]},
"flower_01":{"start":[36.03,139.755],"end":[36.098,139.823],"via":[[36.05,139.78]]},
"flower_02":{"start":[36.003,139.085],"end":[36.123,139.13],"via":[[35.992,139.086]]},
"flower_03":{"start":[36.39,140.607],"end":[36.333,140.59],"via":[[36.35,140.6]]},
"flower_04":{"start":[36.247,139.543],"end":[36.298,139.523]},
"flower_05":{"start":[35.415,138.87],"end":[35.424,138.681],"via":[[35.476,138.588]]},
"flower_06":{"start":[36.41,139.065],"end":[36.554,139.195],"via":[[36.5,139.18]]},
"flower_07":{"start":[35.7033,139.4269],"end":[35.7100,139.4200]},
"flower_08":{"start":[36.3700,140.5500],"end":[36.4100,140.6000],"via":[[36.3922,140.5853]]},
"sea_01":{"start":[35.3255,139.404],"end":[35.3085,139.5103],"via":[[35.31,139.4812]]},
"sea_02":{"start":[35.268,139.665],"end":[35.272,139.578],"via":[[35.14,139.62],[35.152,139.613]]},
"sea_03":{"start":[34.958,139.755],"end":[35.045,139.88],"via":[[34.94,139.82]]},
"sea_04":{"start":[35.37,140.38],"end":[35.52,140.41]},
"sea_05":{"start":[35.7346,140.8266],"end":[35.708,140.868]},
"sea_06":{"start":[36.313,140.575],"end":[36.35,140.6]},
"sea_07":{"start":[35.097,139.076],"end":[35.11,139.092]},
"sea_08":{"start":[35.5956,140.4285],"end":[35.7218,140.8569],"via":[[35.6356,140.5312]]},
"sea_09":{"start":[35.1600,139.6050],"end":[35.1800,139.6350],"via":[[35.1333,139.6167]]},
"sea_10":{"start":[36.3357,140.5856],"end":[36.2400,140.6500],"via":[[36.3089,140.5756]]},
"wind_01":{"start":[35.236,139.143],"end":[35.21,139.03],"via":[[35.22,139.07]]},
"wind_02":{"start":[35.778,139.01],"end":[35.735,139.07],"via":[[35.765,139.03]]},
"wind_03":{"start":[35.613,139.228],"end":[35.415,138.87],"via":[[35.52,139.06]]},
"wind_04":{"start":[35.205,139.027],"end":[35.245,138.99]},
"wind_05":{"start":[35.146,139.102],"end":[35.215,139.025]},
"wind_06":{"start":[36.341,138.759],"end":[36.345,138.63]},
"wind_07":{"start":[36.745,139.583],"end":[36.74,139.498],"via":[[36.738,139.535]]},
"wind_08":{"start":[36.21,140.08],"end":[36.226,140.105]},
"wind_09":{"start":[35.374,139.133],"end":[35.446,139.173],"via":[[35.41,139.15]]},
"wind_10":{"start":[35.308,139.985],"end":[35.247,140.122],"via":[[35.28,140.05]]},
"wind_11":{"start":[35.5931,139.2325],"end":[35.5358,138.9694],"via":[[35.5600,139.0800]]},
"wind_12":{"start":[35.2800,139.0200],"end":[35.3200,138.9100],"via":[[35.3000,138.9361]]},
"wind_13":{"start":[36.0050,138.9500],"end":[36.0600,138.8500],"via":[[36.0364,138.9178]]},
"wind_14":{"start":[35.0800,139.8200],"end":[34.9300,139.8700],"via":[[35.0000,139.8500]]},
"wind_15":{"start":[35.2600,139.9100],"end":[35.0100,139.9200],"via":[[35.1400,139.9600]]},
"wind_16":{"start":[35.3300,139.9300],"end":[35.2350,139.9600],"via":[[35.2600,139.9000]]},
"wind_17":{"start":[35.4350,139.3200],"end":[35.5581,139.2014],"via":[[35.5000,139.2500]]},
"wind_18":{"start":[36.0200,139.2200],"end":[35.9800,139.0800],"via":[[36.0064,139.1372]]},
"wind_19":{"start":[36.5400,139.7200],"end":[36.6200,139.5500],"via":[[36.5800,139.6500]]},
"wind_20":{"start":[36.3700,139.1000],"end":[36.5500,139.1700],"via":[[36.4500,139.1400]]},
"wind_21":{"start":[36.4800,138.8200],"end":[36.4200,138.9000],"via":[[36.4650,138.8700]]},
"wind_22":{"start":[36.5200,138.5200],"end":[36.5300,138.3500],"via":[[36.5500,138.4000]]},
"shuto_01":{"start":[35.69,139.695],"end":[35.628,139.776],"via":[[35.658,139.765],[35.645,139.76]]},
"shuto_02":{"start":[35.67,139.75],"end":[35.477,139.665],"via":[[35.61,139.78],[35.46,139.65]]},
"shuto_03":{"start":[35.53,139.77],"end":[35.51,139.74]},
"shuto_04":{"start":[35.68,139.79],"end":[35.71,139.81]},
"shuto_05":{"start":[35.6239,139.7775],"end":[35.648,139.879],"via":[[35.638,139.830]]},
"shuto_06":{"start":[35.6700,139.6900],"end":[35.6600,139.7200],"via":[[35.7100,139.7300],[35.6900,139.7800]]},
"circ_01":{"start":[35.3722,138.9275],"end":[35.3722,138.9275]},
"circ_02":{"start":[36.151,139.921],"end":[36.151,139.921]},
"circ_03":{"start":[36.151,139.921],"end":[36.151,139.921]},
"circ_04":{"start":[35.395,140.089],"end":[35.395,140.089]},
"circ_05":{"start":[36.532,140.228],"end":[36.532,140.228]},
"circ_06":{"start":[36.171,139.109],"end":[36.171,139.109]},
"night_01":{"start":[35.6896,139.6921],"end":[35.675,139.72],"via":[[35.658,139.765],[35.629,139.776],[35.46,139.65]]},
"night_02":{"start":[35.632,139.838],"end":[35.625,139.775],"via":[[35.61,139.82]]},
"night_03":{"start":[35.325,139.313],"end":[35.33,139.35]},
"night_04":{"start":[35.45,139.647],"end":[35.455,139.63],"via":[[35.448,139.643]]},
"night_05":{"start":[35.405,140.062],"end":[35.405,140.062]},
"night_06":{"start":[35.521,139.788],"end":[35.4050,139.9656]},
"night_07":{"start":[35.1700,139.6300],"end":[35.2500,139.5800],"via":[[35.1333,139.6167]]},
"mtn_01":{"start":[36.002,138.158],"end":[36.23,138.12],"via":[[36.105,138.165],[36.16,138.13]]},
"mtn_02":{"start":[36.621,138.596],"end":[36.78,138.52],"via":[[36.66,138.525]]},
"mtn_03":{"start":[36.505,139.013],"end":[36.49,138.93],"via":[[36.475,138.89]]},
"mtn_04":{"start":[36.58,138.59],"end":[36.62,138.525]},
"mtn_05":{"start":[36.739,139.508],"end":[36.72,139.47]},
"mtn_06":{"start":[35.34,138.73],"end":[35.36,138.728]},
"mtn_07":{"start":[35.23,138.995],"end":[35.24,138.97]},
"mtn_08":{"start":[37.11,139.965],"end":[37.125,139.96]},
"mtn_09":{"start":[36.795,139.42],"end":[36.78,139.28],"via":[[36.79,139.38]]},
"mtn_10":{"start":[36.78,139.63],"end":[36.82,139.58]},
"mtn_11":{"start":[36.47,138.535],"end":[36.44,138.58]},
"mtn_12":{"start":[36.52,138.55],"end":[36.51,138.62]},
"mtn_13":{"start":[36.7275,139.6050],"end":[36.7778,139.5889],"via":[[36.7500,139.5750]]},
"mtn_14":{"start":[36.5500,138.4800],"end":[36.4500,138.5600],"via":[[36.5000,138.5200]]},
"mtn_15":{"start":[36.6222,138.5961],"end":[36.6800,138.5100],"via":[[36.6600,138.5500]]},
"michi_01":{"start":[35.08,139.845],"end":[34.96,139.955],"via":[[35.02,139.86]]},
"michi_02":{"start":[35.992,139.086],"end":[36.06,139.24],"via":[[36.09,139.18]]},
"michi_03":{"start":[36.72,139.1],"end":[36.59,139.91]},
"michi_04":{"start":[36.19,139.82],"end":[36.57,140.37],"via":[[36.24,139.99]]},
"michi_05":{"start":[35.692,139.325],"end":[35.6,139.25]},
"michi_06":{"start":[35.3500,139.1200],"end":[35.3000,138.9000],"via":[[35.3200,138.9500]]},
"michi_07":{"start":[36.2000,138.8000],"end":[36.2500,138.7600],"via":[[36.2300,138.7800]]},
"dam_01":{"start":[35.7817,139.0422],"end":[35.8300,138.9800],"via":[[35.8100,139.0200]]},
"dam_02":{"start":[35.5581,139.2014],"end":[35.6500,139.1500],"via":[[35.6239,139.1716]]},
"dam_03":{"start":[36.0386,140.3783],"end":[36.1800,140.5200],"via":[[36.1200,140.4500]]},
"dam_04":{"start":[36.7275,139.6050],"end":[36.7750,139.5000],"via":[[36.7500,139.5481]]},
"dam_05":{"start":[36.6111,138.7833],"end":[36.6400,138.7200],"via":[[36.6200,138.7500]]},
"dam_06":{"start":[36.0700,138.2000],"end":[36.1100,138.1400],"via":[[36.0900,138.1700]]},
"sky_01":{"start":[35.2350,139.0933],"end":[35.183,139.046],"via":[[35.210,139.073]]},
"sky_02":{"start":[35.2100,139.0400],"end":[35.1900,139.0100],"via":[[35.2000,139.0200]]},
"sky_03":{"start":[36.7275,139.6050],"end":[36.745,139.514],"via":[[36.740,139.555]]},
"sky_04":{"start":[37.0000,140.0500],"end":[37.1000,139.9800],"via":[[37.0500,140.0200]]},
"sky_05":{"start":[36.7750,139.5481],"end":[36.8600,139.4200],"via":[[36.8200,139.4800]]},
"sento_01":{"start":[35.682,139.787],"end":[35.710,139.814],"via":[[35.695,139.795]]},
"sento_02":{"start":[35.648,139.468],"end":[35.572,139.744],"via":[[35.598,139.600]]},
"sento_03":{"start":[35.456,139.631],"end":[35.509,139.678],"via":[[35.469,139.655]]},
"sento_04":{"start":[35.925,139.485],"end":[36.186,139.386],"via":[[36.050,139.430]]},
"sento_05":{"start":[35.788,139.276],"end":[35.773,139.545],"via":[[35.772,139.378]]},
"sento_06":{"start":[35.319,139.549],"end":[35.360,139.469],"via":[[35.310,139.500]]},
};

// サーキット判定（start == end）
function isCircuit(rc) {
  return rc.start[0] === rc.end[0] && rc.start[1] === rc.end[1];
}

// --- Phase 1: OSRM データ取得 ---
console.log('=== Phase 1: OSRM ルート形状を取得 ===');
const osrmData = {};
const rids = Object.keys(RC).filter(rid => !isCircuit(RC[rid]));

for (let i = 0; i < rids.length; i++) {
  const rid = rids[i];
  const rc = RC[rid];
  const pts = [rc.start, ...(rc.via || []), rc.end];
  const coordStr = pts.map(p => p[1] + ',' + p[0]).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
  process.stdout.write(`[${i+1}/${rids.length}] ${rid} ... `);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (data.code === 'Ok' && data.routes[0]) {
      const simplified = simplifyCoords(data.routes[0].geometry.coordinates, 200);
      osrmData[rid] = simplified;
      process.stdout.write(`OK (${simplified.length}pts)\n`);
    } else {
      process.stdout.write(`SKIP (no route)\n`);
    }
  } catch (e) {
    process.stdout.write(`SKIP (${e.message})\n`);
  }
  await sleep(OSRM_DELAY_MS);
}

// osrm-preload.js を保存
const preloadJs = `// Auto-generated by scripts/generate-assets.mjs\nwindow.OSRM_PRELOAD=${JSON.stringify(osrmData)};`;
writeFileSync(join(ROOT, 'osrm-preload.js'), preloadJs, 'utf-8');
console.log(`\nosrm-preload.js に ${Object.keys(osrmData).length} ルート保存\n`);

// --- Phase 2: 必要タイルを計算 ---
console.log('=== Phase 2: 必要タイルを計算 ===');
const tileSet = new Set();

for (const [rid, rc] of Object.entries(RC)) {
  if (isCircuit(rc)) continue;
  const coords = osrmData[rid]
    ? osrmData[rid]
    : [rc.start, ...(rc.via || []), rc.end].map(p => [p[1], p[0]]);
  const tiles = calcNeededTiles(coords);
  tiles.forEach(t => tileSet.add(`${t.z}/${t.x}/${t.y}`));
}

console.log(`ユニークタイル数: ${tileSet.size}\n`);

// --- Phase 3: タイルをダウンロード ---
console.log('=== Phase 3: タイルをダウンロード ===');
mkdirSync(TILES_DIR, { recursive: true });

const tileList = [...tileSet];
let downloaded = 0, skipped = 0, failed = 0;

for (let i = 0; i < tileList.length; i++) {
  const key = tileList[i];
  const [z, x, y] = key.split('/');
  const dir = join(TILES_DIR, z, x);
  const filePath = join(dir, `${y}.png`);

  if (existsSync(filePath)) { skipped++; continue; }

  mkdirSync(dir, { recursive: true });
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(filePath, buf);
      downloaded++;
    } else {
      failed++;
    }
  } catch (e) {
    failed++;
  }

  if ((i + 1) % 20 === 0 || i === tileList.length - 1) {
    process.stdout.write(`\r  ${i+1}/${tileList.length} (DL:${downloaded} SKIP:${skipped} NG:${failed})`);
  }
  await sleep(TILE_DELAY_MS);
}

console.log('\n\n=== 完了 ===');
console.log(`タイル: ${downloaded}件ダウンロード / ${skipped}件スキップ / ${failed}件失敗`);
console.log(`次のステップ:\n  git add tiles/ osrm-preload.js && git push`);
