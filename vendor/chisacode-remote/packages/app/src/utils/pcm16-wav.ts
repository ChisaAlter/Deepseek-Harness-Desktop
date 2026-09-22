/** Parsed mono PCM16 samples and sample rate from a WAV buffer */
export interface Pcm16Wav {
  sampleRate: number;
  samples: Int16Array;
}

/**
 * Parses a PCM16 WAV buffer into mono samples
 * @param buffer Raw WAV file bytes
 * @returns Sample rate and mono Int16 samples, or null when the WAV is unsupported
 */
export function parsePcm16Wav(buffer: ArrayBuffer): Pcm16Wav | null {
  if (buffer.byteLength < 44) {
    return null;
  }

  const view = new DataView(buffer);

  function readAscii(offset: number, length: number): string {
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
  }

  if (readAscii(0, 4) !== "RIFF" || readAscii(8, 4) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readAscii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > buffer.byteLength) {
      return null;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
      if (audioFormat !== 1) {
        return null;
      }
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!dataOffset || dataSize <= 0 || sampleRate <= 0 || bitsPerSample !== 16 || channels <= 0) {
    return null;
  }

  const sampleCount = Math.floor(dataSize / 2);
  const interleaved = new Int16Array(buffer, dataOffset, sampleCount);

  if (channels === 1) {
    return {
      sampleRate,
      samples: new Int16Array(interleaved),
    };
  }

  const frameCount = Math.floor(interleaved.length / channels);
  const mono = new Int16Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += interleaved[frame * channels + channel] ?? 0;
    }
    mono[frame] = Math.round(sum / channels);
  }

  return {
    sampleRate,
    samples: mono,
  };
}
