// Files in memory: the bytes the readers of files in memory (fromStep, fromStl, fromDxf, loadFont,
// fromFile, ...) take. Without imports: the kernel-free entries can use it.

/**
 * The contents of a file in memory: a Uint8Array (a Node Buffer is one), another view of an
 * ArrayBuffer (a DataView, a typed array) or an ArrayBuffer itself, as `await file.arrayBuffer()`
 * and `await (await fetch(url)).arrayBuffer()` give it.
 */
export type BytesLike = Uint8Array | ArrayBufferView | ArrayBuffer

/** A Uint8Array over the bytes of `data` (the same memory, not a copy), or null when `data` is no
 * bytes. */
export function _asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) return new Uint8Array(data)
  return null
}
