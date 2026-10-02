import math, struct, sys, wave
# Two-tone wail: sweep 650 Hz -> 1350 Hz -> 650 Hz, three cycles, ~2.1 s.
RATE, CYCLE, CYCLES, LOW, HIGH, AMP = 44100, 0.7, 3, 650.0, 1350.0, 0.6
frames, phase, n = bytearray(), 0.0, int(RATE * CYCLE * CYCLES)
for i in range(n):
    t = (i / RATE) % CYCLE / CYCLE                      # 0..1 within one cycle
    freq = LOW + (HIGH - LOW) * (1 - abs(2 * t - 1))    # up then down
    phase += 2 * math.pi * freq / RATE
    fade = min(1.0, i / 2000, (n - i) / 2000)           # avoid clicks at the ends
    frames += struct.pack("<h", int(32767 * AMP * fade * math.sin(phase)))
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(bytes(frames))
