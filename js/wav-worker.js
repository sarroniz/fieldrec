// Worker: resamples and encodes off the main thread so the interface doesn't freeze.
importScripts('dsp.js');

self.onmessage = (e) => {
  const { id, samples, inRate, outRate, bitDepth, slices } = e.data;
  try {
    const rate = outRate || inRate;
    const res = FieldrecDSP.resample(samples, inRate, rate);
    const full = FieldrecDSP.encodeWav(res, rate, bitDepth);
    const transfer = [full];
    const sliceBufs = [];
    if (slices && slices.length) {
      const k = rate / inRate;
      for (const [s, end] of slices) {
        const a = Math.max(0, Math.round(s * k));
        const b = Math.min(res.length, Math.round(end * k));
        const buf = FieldrecDSP.encodeWav(res.subarray(a, Math.max(a, b)), rate, bitDepth);
        sliceBufs.push(buf);
        transfer.push(buf);
      }
    }
    self.postMessage({ id, ok: true, full, slices: sliceBufs, outRate: rate, length: res.length }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
