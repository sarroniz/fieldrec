// AudioWorklet: copia el audio del micrófono (canal 0) en bloques y los envía al hilo principal.
// Cada bloque lleva su pico (para el medidor) y el número de frame del contexto en que termina.
const BLOCK = 2048; // múltiplo de 128 → el bloque siempre se llena al final de un quantum

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
          // currentFrame es el inicio de este quantum; el bloque termina en el frame del último sample + 1
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
