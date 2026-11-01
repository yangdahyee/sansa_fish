// three.js 에서 실제로 쓰는 파일만 public/vendor/three 로 복사 (Cloudflare 정적 파일로 올라감)
// 사용하는 addon 에서 시작해 상대 경로 import 를 따라가며 필요한 파일을 모은다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'three');
const OUT = path.join(ROOT, 'public', 'vendor', 'three');

const entries = [
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/utils/SkeletonUtils.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
];

const seen = new Set();
function collect(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    collect(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
}
entries.forEach(collect);

fs.rmSync(OUT, { recursive: true, force: true });
for (const rel of seen) {
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), to);
}
console.log(`three.js ${seen.size}개 파일 → public/vendor/three`);
