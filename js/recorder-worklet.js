// AudioWorklet: copies microphone audio (channel 0) into blocks and posts them to the main thread.
// Each block carries its peak (for the meter) and the context frame at which it ends.
const BLOCK = 2048; // multiple of 128 → a block always fills at the end of a render quantum

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.pos = 0;
    this.peak = 0;
    this.clipped = false;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0]) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i];
        this.buf[this.pos++] = v;
        const a = v < 0 ? -v : v;
        if (a > this.peak) this.peak = a;
        if (a >= 0.999) this.clipped = true;
        if (this.pos === BLOCK) {
          // currentFrame is the start of this quantum; the block ends at the last sample's frame + 1
          const endFrame = currentFrame + i + 1;
          this.port.postMessage(
            { samples: this.buf, peak: this.peak, clipped: this.clipped, endFrame },
            [this.buf.buffer]
          );
          this.buf = new Float32Array(BLOCK);
          this.pos = 0;
          this.peak = 0;
          this.clipped = false;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
