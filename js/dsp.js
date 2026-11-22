// Resampling (Kaiser-windowed sinc) and WAV encoding.
// Used inside the worker (wav-worker.js) and importable in tests.
// Written as a classic script: exposes `FieldrecDSP` on the global scope.

(function (global) {
  'use strict';

  function besselI0(x) {
    let sum = 1, term = 1;
    const q = (x * x) / 4;
    for (let k = 1; k < 50; k++) {
      term *= q / (k * k);
      sum += term;
      if (term < 1e-12 * sum) break;
    }
    return sum;
  }

  function gcd(a, b) { a = Math.round(a); b = Math.round(b); while (b) { [a, b] = [b, a % b]; } return a; }

  // Band-limited resampling.
  // zeroCrossings = 64 and beta = 8 → ~80 dB stopband attenuation;
  // the cutoff sits at 96% of the lower Nyquist so the transition band ends before Nyquist.
  function resample(input, fsIn, fsOut, opts) {
    if (fsIn === fsOut) return input;
    opts = opts || {};
    const zc = opts.zeroCrossings || 64;
    const beta = opts.beta || 8;
    const ratio = fsOut / fsIn;
    const fc = Math.min(1, ratio) * (opts.cutoff || 0.96); // relative to the input Nyquist
    const halfWidth = zc / fc; // in input samples
    const RES = 512; // table points per input sample
    const tableLen = Math.ceil(halfWidth * RES) + 2;
    const table = new Float32Array(tableLen);
    const i0b = besselI0(beta);
    for (let i = 0; i < tableLen; i++) {
      const x = i / RES;
      if (x >= halfWidth) { table[i] = 0; continue; }
      const px = Math.PI * fc * x;
      const sinc = x === 0 ? 1 : Math.sin(px) / px;
      const r = x / halfWidth;
      const w = besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      table[i] = fc * sinc * w;
    }

    const inLen = input.length;
    const outLen = Math.floor(inLen * ratio);
    const out = new Float32Array(outLen);
    const hw = Math.ceil(halfWidth);

    const kernel = (d) => {
      if (d < 0) d = -d;
      const pos = d * RES;
      const i = pos | 0;
      if (i >= tableLen - 1) return 0;
      return table[i] + (table[i + 1] - table[i]) * (pos - i);
    };

    // Fast polyphase path for rational ratios (48000↔44100, 48000→16000, etc.)
    const g = gcd(fsIn, fsOut);
    const L = fsOut / g, M = fsIn / g;
    if (Number.isInteger(L) && Number.isInteger(M) && L <= 2000) {
      const taps = 2 * hw;
      const bank = new Array(L);
      for (let ph = 0; ph < L; ph++) {
        const frac = ph / L;
        const f = new Float32Array(taps);
        for (let j = 0; j < taps; j++) f[j] = kernel(j - hw + 1 - frac);
        bank[ph] = f;
      }
      for (let n = 0; n < outLen; n++) {
        const nm = n * M;
        const center = Math.floor(nm / L);
        const f = bank[nm - center * L];
        const base = center - hw + 1;
        let j0 = 0, j1 = taps;
        if (base < 0) j0 = -base;
        if (base + taps > inLen) j1 = inLen - base;
        let sum = 0;
        for (let j = j0; j < j1; j++) sum += input[base + j] * f[j];
        out[n] = sum;
      }
      return out;
    }

    const step = 1 / ratio;
    for (let n = 0; n < outLen; n++) {
      const t = n * step;
      const center = Math.floor(t);
      let k0 = center - hw + 1;
      let k1 = center + hw;
      if (k0 < 0) k0 = 0;
      if (k1 > inLen - 1) k1 = inLen - 1;
      let sum = 0;
      for (let k = k0; k <= k1; k++) {
        let d = k - t;
        if (d < 0) d = -d;
        const pos = d * RES;
        const i = pos | 0;
        if (i >= tableLen - 1) continue;
        const f = pos - i;
        const w = table[i] + (table[i + 1] - table[i]) * f;
        sum += input[k] * w;
      }
      out[n] = sum;
    }
    return out;
  }

  // Encodes a mono Float32Array as WAV. bitDepth: 16 | 24 | 32 (32 = IEEE float).
  function encodeWav(samples, sampleRate, bitDepth) {
    const isFloat = bitDepth === 32;
    const bytesPer = bitDepth / 8;
    const dataLen = samples.length * bytesPer;
    const fmtLen = isFloat ? 18 : 16;
    const factLen = isFloat ? 12 : 0;
    const headerLen = 12 + (8 + fmtLen) + factLen + 8;
    const buf = new ArrayBuffer(headerLen + dataLen + (dataLen % 2));
    const v = new DataView(buf);
    let p = 0;
    const str = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); };
    const u32 = (x) => { v.setUint32(p, x, true); p += 4; };
    const u16 = (x) => { v.setUint16(p, x, true); p += 2; };

    str('RIFF'); u32(buf.byteLength - 8); str('WAVE');
    str('fmt '); u32(fmtLen);
    u16(isFloat ? 3 : 1); // format
    u16(1); // channels
    u32(sampleRate);
    u32(sampleRate * bytesPer); // byte rate
    u16(bytesPer); // block align
    u16(bitDepth);
    if (isFloat) u16(0); // cbSize
    if (isFloat) { str('fact'); u32(4); u32(samples.length); }
    str('data'); u32(dataLen);

    const n = samples.length;
    if (bitDepth === 16) {
      for (let i = 0; i < n; i++) {
        let s = samples[i];
        s = s > 1 ? 1 : s < -1 ? -1 : s;
        v.setInt16(p, Math.round(s < 0 ? s * 32768 : s * 32767), true);
        p += 2;
      }
    } else if (bitDepth === 24) {
      for (let i = 0; i < n; i++) {
        let s = samples[i];
        s = s > 1 ? 1 : s < -1 ? -1 : s;
        let x = Math.round(s < 0 ? s * 8388608 : s * 8388607);
        if (x < 0) x += 0x1000000;
        v.setUint8(p++, x & 0xff);
        v.setUint8(p++, (x >> 8) & 0xff);
        v.setUint8(p++, (x >> 16) & 0xff);
      }
    } else if (isFloat) {
      for (let i = 0; i < n; i++) { v.setFloat32(p, samples[i], true); p += 4; }
    } else {
      throw new Error('Unsupported bit depth: ' + bitDepth);
    }
    return buf;
  }

  global.FieldrecDSP = { resample, encodeWav, besselI0 };
})(typeof self !== 'undefined' ? self : globalThis);
