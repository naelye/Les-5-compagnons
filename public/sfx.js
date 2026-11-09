/* Sons doux et organiques (WebAudio, aucun fichier audio). */
const S = { mute: false };
try { S.mute = localStorage.getItem("c5k-mute") === "1"; } catch (e) {}
function sfx(name, vol) {
    if (S.mute) return;
    try {
      const ac = S.ac || (S.ac = new (window.AudioContext || window.webkitAudioContext)());
      if (ac.state === 'suspended') ac.resume();
      if (!S.bus) {
        const bus = ac.createGain(); bus.gain.value = 0.5;
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -26; comp.ratio.value = 3;
        bus.connect(comp); comp.connect(ac.destination);
        const len = Math.floor(ac.sampleRate * 0.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        const conv = ac.createConvolver(); conv.buffer = ir;
        const wet = ac.createGain(); wet.gain.value = 0.2;
        bus.connect(conv); conv.connect(wet); wet.connect(comp);
        const nl = ac.sampleRate, nb = ac.createBuffer(1, nl, ac.sampleRate), nd = nb.getChannelData(0);
        let last = 0; for (let i = 0; i < nl; i++) { last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03; nd[i] = last * 6; }
        S.bus = bus; S.nb = nb;
      }
      const V = vol === undefined ? 1 : vol, t0 = ac.currentTime + 0.005;
      const out = ac.createGain(); out.gain.value = V; out.connect(S.bus);
      const J = () => 0.93 + Math.random() * 0.14;
      const env = (g, at, att, dur, peak) => { g.gain.setValueAtTime(0.0001, t0 + at); g.gain.linearRampToValueAtTime(peak, t0 + at + att); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur); };
      const tone = (f0, f1, at, dur, type, peak, att) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t0 + at); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
        env(g, at, att || 0.012, dur, peak); o.connect(g); g.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
      };
      const noise = (at, dur, f0, f1, q, peak, kind, att) => {
        const s = ac.createBufferSource(); s.buffer = S.nb;
        const fl = ac.createBiquadFilter(); fl.type = kind || 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t0 + at); fl.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
        const g = ac.createGain(); env(g, at, att || 0.004, dur, peak);
        s.connect(fl); fl.connect(g); g.connect(out); s.start(t0 + at, Math.random() * 0.6, dur + 0.05);
      };
      if (name === 'draw') {
        noise(0, 0.2, 450 * J(), 1500 * J(), 0.6, 0.5, 'bandpass', 0.045);
        noise(0.16, 0.05, 1500, 900, 0.8, 0.14, 'lowpass', 0.003);
      } else if (name === 'discard') {
        tone(115 * J(), 62, 0, 0.1, 'sine', 0.22, 0.004);
        noise(0, 0.09, 1500 * J(), 650, 0.7, 0.5, 'lowpass', 0.002);
        noise(0.075, 0.035, 1900, 1100, 0.9, 0.12, 'bandpass', 0.002);
      } else if (name === 'place') {
        noise(0, 0.06, 2000 * J(), 1000, 0.7, 0.3, 'lowpass', 0.002);
        tone(200 * J(), 150, 0, 0.06, 'sine', 0.08, 0.004);
      } else if (name === 'turn') {
        tone(523, 0, 0, 0.55, 'sine', 0.08, 0.03); tone(784, 0, 0.16, 0.8, 'sine', 0.07, 0.03); tone(1568, 0, 0.16, 0.5, 'sine', 0.012, 0.03);
      } else if (name === 'tick') {
        tone(880, 0, 0, 0.05, 'sine', 0.035, 0.006);
      } else if (name === 'tickHi') {
        tone(1175, 0, 0, 0.07, 'sine', 0.06, 0.006); tone(587, 0, 0, 0.09, 'sine', 0.03, 0.006);
      } else if (name === 'win') {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0, i * 0.12, 0.7, 'sine', 0.07, 0.02));
        tone(523, 0, 0.5, 1.1, 'triangle', 0.035, 0.05); tone(784, 0, 0.5, 1.1, 'sine', 0.04, 0.05);
      }
    } catch (e) {}
  }
function setMute(m) { S.mute = m; try { localStorage.setItem("c5k-mute", m ? "1" : "0"); } catch (e) {} }
