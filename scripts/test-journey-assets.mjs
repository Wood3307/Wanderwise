import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = relative => fs.readFileSync(path.join(root, relative))
const glb = relative => {
  const bytes = read(relative), length = bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  return { bytes, document: JSON.parse(bytes.subarray(20, 20 + length)), binary: bytes.subarray(28 + length) }
}
const original = glb('public/models/garden/jacaranda-mature.glb')
const variant = glb('public/models/garden/jacaranda-journey.glb')
for (const key of ['meshes', 'nodes', 'accessors', 'materials', 'scenes', 'scene'])
  assert.deepEqual(variant.document[key], original.document[key], `${key} remains exactly unchanged`)
const viewBytes = (model, index) => {
  const view = model.document.bufferViews[index]
  return model.binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)
}
const decoderDirectory = path.join(root, 'public/models/garden/draco/')
const module = { exports: {} }
new Function('module', 'exports', 'require', '__dirname', read('public/models/garden/draco/draco_wasm_wrapper.js').toString())(
  module, module.exports, createRequire(import.meta.url), decoderDirectory,
)
const draco = await module.exports({ wasmBinary: read('public/models/garden/draco/draco_decoder.wasm') })
let triangles = 0
for (const mesh of variant.document.meshes) {
  for (const primitive of mesh.primitives) {
    const extension = primitive.extensions.KHR_draco_mesh_compression
    const compressed = viewBytes(variant, extension.bufferView)
    assert.ok(compressed.equals(viewBytes(original, extension.bufferView)), `${mesh.name} compressed bytes unchanged`)
    const decoder = new draco.Decoder(), buffer = new draco.DecoderBuffer(), decoded = new draco.Mesh()
    buffer.Init(compressed, compressed.length)
    assert.ok(decoder.DecodeBufferToMesh(buffer, decoded).ok(), `${mesh.name} actually decodes`)
    triangles += decoded.num_faces()
    assert.equal(decoded.num_faces() * 3, variant.document.accessors[primitive.indices].count)
    draco.destroy(decoded); draco.destroy(buffer); draco.destroy(decoder)
  }
}
assert.equal(triangles, 438168)
for (const image of variant.document.images) {
  assert.equal(image.mimeType, 'image/webp')
  const bytes = viewBytes(variant, image.bufferView)
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF')
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP')
}
assert.ok(variant.document.extensionsRequired.includes('EXT_texture_webp'))
assert.ok(variant.bytes.length < 7_000_000)
// The committed mapping is available in a fresh checkout; builder reports are ignored.
const report = { textures: JSON.parse(read('public/models/garden/journey-textures/url-mapping.json')) }
const night = report.textures.find(item => item.sourceUrl.includes('milkyway'))
const fixedFiles = [
  'public/textures/kloppenheim_06_puresky_1k.hdr',
  ...['sandstone-blocks.jpg', 'sandstone-blocks-normal.jpg', 'sandstone-blocks-rough.jpg',
    'monet-parliament.jpg', 'monet-waterloo.jpg', 'turner-venice.jpg'].map(name => `src/features/journeys/scene/assets/${name}`),
]
const fixedBytes = fixedFiles.reduce((sum, file) => sum + read(file).length, 0)
const decoderBytes = ['draco_wasm_wrapper.js', 'draco_decoder.wasm'].reduce((sum, file) => sum + read(`public/models/garden/draco/${file}`).length, 0)
for (const item of report.textures) assert.equal(read(`public${item.url}`).length, item.afterBytes)
const dayTextureBytes = report.textures.reduce((sum, item) => sum + item.afterBytes, 0) - night.afterBytes
const dayWithHero = dayTextureBytes + fixedBytes + decoderBytes + variant.bytes.length
assert.ok(dayWithHero <= 12_000_000, `cold day with tree ${dayWithHero} <= 12 MB`)
const budget = {
  result: 'passed', triangles, geometryByteIdentical: true, treeBytes: variant.bytes.length,
  assetsOnly: true, excludes: ['application JavaScript/CSS/fonts/API responses', 'other routes visited earlier'],
  dayWithHero, dayWithoutHero: dayTextureBytes + fixedBytes,
  nightWithoutHero: dayTextureBytes + fixedBytes + night.afterBytes,
  oldDayWithHero: report.textures.reduce((sum, item) => sum + item.beforeBytes, 0) - night.beforeBytes + fixedBytes + decoderBytes + original.bytes.length,
  fixedBytes, decoderBytes,
}
fs.mkdirSync(path.join(root, 'artifacts/journey-assets'), { recursive: true })
fs.writeFileSync(path.join(root, 'artifacts/journey-assets/budget-report.json'), JSON.stringify(budget, null, 2) + '\n')
console.log(JSON.stringify(budget, null, 2))
