import { describe, expect, it } from "vitest";
import { parsePcm16Wav } from "@/utils/pcm16-wav";

interface BuildWavInput {
  channels?: number;
  sampleRate?: number;
  samples: number[];
}

function buildPcm16Wav(input: BuildWavInput): ArrayBuffer {
  const channels = input.channels ?? 1;
  const sampleRate = input.sampleRate ?? 24000;
  const bytesPerSample = 2;
  const dataSize = input.samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeAscii(offset: number, value: string): void {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  input.samples.forEach((sample, index) => {
    view.setInt16(44 + index * bytesPerSample, sample, true);
  });

  return buffer;
}

describe("parsePcm16Wav", () => {
  it("parses mono PCM16 wav data", () => {
    const buffer = buildPcm16Wav({
      sampleRate: 16000,
      samples: [100, -200, 300],
    });

    const parsed = parsePcm16Wav(buffer);

    expect(parsed).not.toBeNull();
    expect(parsed?.sampleRate).toBe(16000);
    expect(Array.from(parsed?.samples ?? [])).toEqual([100, -200, 300]);
  });

  it("downmixes multichannel PCM16 wav data to mono", () => {
    const buffer = buildPcm16Wav({
      channels: 2,
      samples: [1000, -1000, 3000, 1000],
    });

    const parsed = parsePcm16Wav(buffer);

    expect(parsed).not.toBeNull();
    expect(Array.from(parsed?.samples ?? [])).toEqual([0, 2000]);
  });

  it("rejects non-wav payloads", () => {
    const buffer = new TextEncoder().encode("not-a-wav").buffer;

    expect(parsePcm16Wav(buffer)).toBeNull();
  });
});
