export const MAX_MODEL_BYTES = 128 * 1024 * 1024;

// Inspect before handing a local file to GLTFLoader: no network resource resolution.
export function inspectVrm(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new Error('文件不是有效的 VRM / GLB。');
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error('文件超过 128 MiB。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('VRM 容器损坏或版本不支持。');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength > buffer.byteLength - 20) throw new Error('VRM 缺少有效的 JSON 数据。');
  let json;
  try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))); }
  catch { throw new Error('VRM 的 JSON 数据无法解析。'); }
  if (!json.extensions?.VRM && !json.extensions?.VRMC_vrm) throw new Error('此文件没有 VRM 人形描述。请打开 .vrm 模型。');
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (item.uri != null && (typeof item.uri !== 'string' || !item.uri.startsWith('data:'))) {
      throw new Error('此模型引用外部素材；请使用贴图与缓冲全部内嵌的 VRM。');
    }
  }
  if (json.extensionsRequired?.some(name => ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'].includes(name))) {
    throw new Error('此试验台尚未接入该模型要求的额外解码器。');
  }
  return json;
}
