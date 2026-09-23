# Narration voice auditions

> **No human has listened to these clips yet.** Everything below is an automatic measurement of the signal. It can catch clipping, clicks, pitch glitches, dropped words, odd pauses and rate problems, but it cannot judge naturalness, accent or whether a word *sounds* right. The final voice choice needs a person to listen.

Passage (105 written words, 107 spoken: '193' is read 'one ninety-three'), one cue per sentence, 0.35 s between sentences, 0.6 s tail, each clip normalised to -18 LUFS (true peak ≤ -1.5 dBTP), mono 24 kHz MP3 at 64 kbps.

* Model: `expo-kokoro@1.1.9` → Kokoro-82M v1.0 quantized ONNX, sha256 `fbae9257e1e05ffc…`
* Engine: `float-conv` (graph sha256 `2e83328bed32c73a…`), onnxruntime 1.30.0, 4 threads, CPU only
* G2P: misaki 0.9.4 British lexicon + espeak-ng 1.52.0 fallback (`en-gb`), pronunciation dictionary `tools/narration/pronunciations.json`
* Voices requested: bm_daniel, bm_fable, bm_george, bm_lewis. All present in the package.
* ASR check: Moonshine tiny (MIT) from `@moonshine-ai/moonshine-js@0.1.29` + tokenizer from `useful-moonshine-onnx==20251121`; word error rate against the spoken script, a rough intelligibility proxy

## Clip summary

| Clip | Duration s | WPM (whole clip) | Speech WPM | Peak dBFS | Clipping | Longest internal silence s | Leading / trailing silence s | Median F0 Hz | F0 range st | Pitch jumps /min | Spikes | HF share dB | RTF | ASR WER |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [bm_george](bm_george.mp3) | 46.80 | 137.2 | 139.4 | -1.5 | no | 0.51 | 0.04 / 0.71 | 141.1 | 7.7 | 0.0 | 0 | -28.5 | 0.230 | 0.028 |
| [bm_fable](bm_fable.mp3) | 44.36 | 144.7 | 147.3 | -2.0 | no | 0.57 | 0.05 / 0.73 | 134.6 | 11.5 | 0.0 | 0 | -10.0 | 0.233 | 0.028 |
| [bm_lewis](bm_lewis.mp3) | 45.24 | 141.9 | 144.3 | -1.5 | no | 0.54 | 0.04 / 0.72 | 123.6 | 6.5 | 0.0 | 0 | -22.7 | 0.346 | 0.019 |
| [bm_daniel](bm_daniel.mp3) | 40.06 | 160.3 | 163.4 | -1.6 | no | 0.53 | 0.04 / 0.72 | 129.3 | 6.8 | 0.0 | 0 | -26.8 | 0.225 | 0.010 |
| [bm_george_0.92](bm_george_0.92.mp3) | 49.21 | 130.5 | 132.4 | -1.5 | no | 0.52 | 0.04 / 0.69 | 141.4 | 7.9 | 0.0 | 0 | -28.5 | 0.389 | 0.029 |
| [bm_fable_0.92](bm_fable_0.92.mp3) | 46.62 | 137.7 | 140.2 | -2.2 | no | 0.56 | 0.08 / 0.74 | 135.4 | 11.5 | 0.0 | 1 | -10.0 | 0.783 | 0.019 |

How to read it:

* **WPM (whole clip)** counts spoken words over the whole clip, including the 0.35 s sentence gaps and the 0.6 s tail; **Speech WPM** divides by the span from the first to the last speech frame.
* **Longest internal silence** is the longest run of 10 ms frames below -50 dBFS between the first and last speech frame. It includes the 0.35 s sentence gaps (plus the 40 ms/80 ms trim margins), so ~0.45-0.5 s is expected; anything well above that is a pause the model made itself.
* **Leading / trailing silence** of the finished clip: 0.04 s lead margin (trim) and 0.6 s tail + 0.08 s margin by construction. The model's own silences before trimming are in the per-sentence tables.
* **Pitch jumps** are jumps of more than 7 semitones between adjacent voiced 10 ms frames of an autocorrelation pitch track: a crude detector for cracks or octave glitches (and for pitch-tracker mistakes on creaky voice).
* **Spikes** counts isolated sample discontinuities (clicks). **HF share** is the energy above 8 kHz relative to all energy during speech: higher means brighter, more sibilant or hissier audio.
* **RTF** = inference time / audio produced, on this 4-core CPU (from the per-cue cache records when a clip was re-rendered from cache).
* Every MP3 was decoded back with ffmpeg: decoded length equals the source length and the alignment lag is 0 for every clip (see report.json).

## ASR findings

Word-level differences between the script and the Moonshine-tiny transcription, grouped over the speed-1.0 clips. A difference heard for every voice points at the text, the G2P or the recogniser's vocabulary; one heard for a single voice points at that voice. Treat these as places to listen first, not as verdicts.

| Sentence | Expected | Transcribed | Voices |
|---|---|---|---|
| 1 | lithography | lethography | bm_george, bm_fable, bm_lewis, bm_daniel |
| 4 | latent | lightened | bm_fable |
| 4 | resists | resisted | bm_george |
| 4 | resists | resistance | bm_fable |
| 4 | resists | resist | bm_lewis |
| 8 | etch | edge | bm_george |

## Pause behaviour of the model

Read from the model's own duration predictor (exposed as an extra graph output; 25 ms per frame): the time given to each comma, colon, semicolon or dash inside a sentence (plus the following word gap), whether that reaches 0.15 s, how far the signal drops during those pauses relative to the sentence's speech level (about -60 dB is clean silence; above about -35 dB means breath or a noise bed fills the pause), and word gaps of 150 ms or more where there is no punctuation (unpunctuated gaps; these can be natural phrase breaks).

The last three columns: variation of the speaking rate between sentences (coefficient of variation of phonemes per second), the loudest 50 ms of each sentence and the loudest 50 ms of its first half second, both in dB above the sentence's median speech level (mean over sentences; even narration sits around 5-8 dB), and the highest raw model peak before gain (above 0 dBFS means the model itself overshot full scale).

| Clip | Marks | Marks with ≥0.15 s pause | Mean pause s | Longest pause s | Median pause depth dB | Unpunctuated gaps (total s) | Rate CV | Burst dB | Onset burst dB | Max raw peak dBFS |
|---|---|---|---|---|---|---|---|---|---|---|
| bm_george | 7 | 2 | 0.12 | 0.17 | -68.4 | 0 (0) | 0.032 | 5.6 | 5.2 | -4.1 |
| bm_fable | 7 | 2 | 0.12 | 0.17 | -19.1 | 0 (0) | 0.089 | 12.8 | 12.6 | 3.5 |
| bm_lewis | 7 | 5 | 0.15 | 0.23 | -91.1 | 2 (0.30) | 0.045 | 12.5 | 11.3 | -1.9 |
| bm_daniel | 7 | 1 | 0.11 | 0.15 | -67.2 | 0 (0) | 0.035 | 8.4 | 8.2 | -2.9 |
| bm_george_0.92 | 7 | 2 | 0.13 | 0.20 | -68.8 | 2 (0.30) | 0.042 | 5.7 | 5.2 | -4.1 |
| bm_fable_0.92 | 7 | 4 | 0.14 | 0.23 | -18.2 | 0 (0) | 0.095 | 12.9 | 12.9 | 3.1 |

## Engine check: bundled quantized graph vs float-conv graph

The default engine rewrites the bundled graph's ConvInteger chains as float convolutions over the same 8-bit weights (see `narr/derive.py`). Same clip, both engines:

| Engine | Duration s | Speech WPM | Peak dBFS | F0 median | F0 range st | Pitch jumps /min | Spikes | HF share dB | RTF |
|---|---|---|---|---|---|---|---|---|---|
| float-conv (default) | 46.80 | 139.4 | -1.5 | 141.1 | 7.7 | 0.0 | 0 | -28.5 | 0.230 |
| quantized | 46.78 | 139.4 | -1.6 | 141.1 | 7.7 | 0.0 | 0 | -28.3 | 1.611 |

## Objective ranking (speed 1.0 clips)

Each criterion is ranked with a tolerance: a clip only ranks below another if it is worse by more than the tolerance (rank = 1 + number of clips better by more than it), so differences inside measurement noise or below audibility do not count (the ASR tolerance is wide because changing only the silence padding around a clip moved single words in and out of Moonshine's transcript). Unpunctuated gaps and high-band share are reported above but not ranked: a gap at a phrase boundary can be natural, and brightness is partly timbre.

| Criterion (lower is better) | Tolerance | bm_george | bm_fable | bm_lewis | bm_daniel |
|---|---|---|---|---|---|
| artifacts: clipped samples + spikes + pitch jumps/min + sentences with raw peak > 0 dBFS | 0 | 0 (#1) | 1 (#4) | 0 (#1) | 0 (#1) |
| sentence-onset level burst, dB over median speech (mean) | 2 | 5.200 (#1) | 12.600 (#3) | 11.300 (#3) | 8.200 (#2) |
| in-sentence punctuation marks without a ≥0.15 s pause | 1 | 5 (#2) | 5 (#2) | 2 (#1) | 6 (#2) |
| pause depth, dB below speech (values under -50 count as clean silence) | 6 | -50.000 (#1) | -19.100 (#4) | -50.000 (#1) | -50.000 (#1) |
| speech rate outside 140-170 wpm, wpm | 5 | 0.600 (#1) | 0.000 (#1) | 0.000 (#1) | 0.000 (#1) |
| pace variation between sentences (CV of phonemes/s) | 0.02 | 0.032 (#1) | 0.089 (#4) | 0.045 (#1) | 0.035 (#1) |
| F0 range outside 6-12 semitones | 1 | 0.000 (#1) | 0.000 (#1) | 0.000 (#1) | 0.000 (#1) |
| ASR word error rate | 0.05 | 0.028 (#1) | 0.028 (#1) | 0.019 (#1) | 0.010 (#1) |
| **Rank sum** | | **9** | **20** | **10** | **10** |

## Recommendation

**Objective pick: `bm_george` at speed 1** (lowest rank sum, 9, over the criteria above; next: `bm_daniel` 10, `bm_lewis` 10, `bm_fable` 20).

* Best on its own: sentence-onset level burst, dB over median speech (mean); tied for first on 6 of the other criteria.
* The margin is small: `bm_daniel`, `bm_lewis` are within one rank point, so on these measures they are close alternatives; listening should decide between them.
* Speech rate 139 wpm at 1.0, 132 wpm at 0.92; the speed is chosen as the one closest to the 140-170 wpm band usual for explainer narration (ties go to 1.0).
* Pauses: 2 of 7 in-sentence punctuation marks get ≥ 0.15 s; median pause depth -68.4 dB below speech; 0 unpunctuated gaps ≥ 0.15 s. Kokoro gives commas short pauses (≈0.05-0.2 s) with every voice, so longer breaths belong in the script as separate cues (pauseAfter) rather than commas.
* Measured concerns with the others: `bm_fable`: pauses are filled by a noise/breath bed (median depth -19.1 dB); raw output exceeds full scale (+3.5 dBFS); loud sentence onsets (12.6 dB over median speech on average); uneven pace between sentences (CV 0.089) · `bm_lewis`: loud sentence onsets (11.3 dB over median speech on average); 2 unpunctuated gaps ≥ 0.15 s.

**Limits.** These criteria measure the signal, not the listening experience: they cannot rank naturalness, warmth, accent, how well stress falls on the key word, or whether a technical word sounds right (the ASR check is a rough proxy for that). RTF differences between voices come from other jobs sharing this machine, not from the voices. **A person needs to listen to the clips before the voice is final**; if they prefer another voice, only `voice` (and maybe `speed`) in narration.json changes.

## Phonemes per sentence

Identical for every voice (G2P does not depend on the voice). `[word]` marks a pronunciation-dictionary entry; the phonemes are Kokoro/misaki symbols (A = eɪ, I = aɪ, Q = əʊ, W = aʊ, Y = ɔɪ, ᵊ = light schwa, ˈ ˌ = stress). Words the British lexicon did not know went to espeak-ng and are listed, as are any warnings.

Automatic G2P checks for this passage: 0 sentence(s) with espeak-ng fallback words, 0 G2P warning(s) (unknown words, all-caps words missing from the dictionary, symbols outside the British set).

1. A single silicon wafer arrives at the lithography bay.
   * audio text: A single silicon [wafer] arrives at the [lithography] bay.
   * phonemes: `ɐ sˈɪŋɡᵊl sˈɪlɪkᵊn wˈAfə əɹˈIvz at ðə lɪθˈɒɡɹəfi bˈA.`
   * sources: dictionary: wafer, lithography; lexicon-silver: arrives; lexicon-gold: 6 words
2. First, the track spins it and spreads a thin film of photoresist across the surface.
   * audio text: First, the track spins it and spreads a thin film of [photoresist] across the surface.
   * phonemes: `fˈɜːst, ðə tɹˈak spˈɪnz ɪt and spɹˈɛdz ɐ θˈɪn fˈɪlm ɒv fˌQtQɹɪzˈɪst əkɹˈɒs ðə sˈɜːfɪs.`
   * sources: dictionary: photoresist; lexicon-silver: spins, spreads; lexicon-gold: 12 words
3. The scanner then shines 193-nanometre deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer.
   * audio text: The [scanner] then shines one ninety-three [nanometre] deep [ultraviolet] light through a [reticle], shrinking the pattern four times onto the [wafer].
   * phonemes: `ðə skˈanə ðˈɛn ʃˈInz wˈʌn nˈIntiθɹˌiː nˈanQmˌiːtə dˈiːp ˌʌltɹəvˈIələt lˈIt θɹuː ɐ ɹˈɛtɪkᵊl, ʃɹˈɪŋkɪŋ ðə pˈatᵊn fˈɔː tˈImz ˈɒntuː ðə wˈAfə.`
   * sources: dictionary: scanner, nanometre, ultraviolet, reticle, wafer; lexicon-silver: shines, ninety-three; lexicon-gold: 14 words
4. Nothing is carved yet: the light only changes the resist's chemistry, leaving a hidden latent image.
   * audio text: Nothing is carved yet: the light only changes the [resist's] chemistry, leaving a hidden latent image.
   * phonemes: `nˈʌθɪŋ ɪz kˈɑːvd jˈɛt: ðə lˈIt ˈQnli ʧˈAnʤɪz ðə ɹɪzˈɪsts kˈɛmɪstɹi, lˈiːvɪŋ ɐ hˈɪdᵊn lˈAtᵊnt ˈɪmɪʤ.`
   * sources: dictionary: resist's; lexicon-silver: changes, leaving; lexicon-gold: 13 words
5. A short bake finishes that reaction.
   * audio text: A short bake finishes that reaction.
   * phonemes: `ɐ ʃˈɔːt bˈAk fˈɪnɪʃɪz ðˈat ɹɪˈakʃᵊn.`
   * sources: lexicon-silver: finishes; lexicon-gold: 5 words
6. Then developer washes away the exposed positive resist, and the pattern opens.
   * audio text: Then developer washes away the exposed positive [resist], and the pattern opens.
   * phonemes: `ðˈɛn dɪvˈɛləpə wˈɒʃɪz əwˈA ði ɪkspˈQzd pˈɒzɪtɪv ɹɪzˈɪst, and ðə pˈatᵊn ˈQpᵊnz.`
   * sources: dictionary: resist; lexicon-silver: washes; lexicon-gold: 10 words
7. Only now can the plasma etch reach the polysilicon underneath.
   * audio text: Only now can the [plasma] etch reach the [polysilicon] underneath.
   * phonemes: `ˈQnli nˈW kan ðə plˈazmə ˈɛʧ ɹˈiːʧ ðə pˌɒlisˈɪlɪkᵊn ˌʌndənˈiːθ.`
   * sources: dictionary: plasma, polysilicon; lexicon-gold: 8 words
8. When the etch is done, the leftover resist is stripped, and the gates of a CMOS inverter remain.
   * audio text: When the etch is done, the leftover [resist] is stripped, and the gates of a [CMOS] [inverter] remain.
   * phonemes: `wˌɛn ði ˈɛʧ ɪz dˈʌn, ðə lˈɛftQvə ɹɪzˈɪst ɪz stɹˈɪpt, and ðə ɡˈAts ɒv ɐ sˈiːmɒs ɪnvˈɜːtə ɹɪmˈAn.`
   * sources: dictionary: resist, CMOS, inverter; lexicon-silver: stripped, gates; lexicon-gold: 13 words

## Per-sentence measurements

### bm_george

| # | Duration s | Speech WPM | Phonemes/s | Model lead / tail silence s | Pauses at punctuation (mark length s / depth dB) | Unpunctuated gaps [t s, length s] | Raw peak dBFS | Tokens | Synth s | ASR hypothesis (errors/words) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3.92 | 142.9 | 10.1 | 0.26 / 0.52 | – | none | -6.1 | 53 | 1.08 | A single silicon wafer arrives at the lethography bay. (1/9) |
| 2 | 5.64 | 164.2 | 10.6 | 0.27 / 0.48 | , 0.05 / 0 | none | -4.1 | 86 | 1.59 | First, the track spins it and spreads a thin film of photo resist across the surface. (0/14) |
| 3 | 9.20 | 139.2 | 10.1 | 0.27 / 0.53 | , 0.17 / -68 | none | -4.3 | 138 | 2.15 | The scanner then shines 193 nanometer deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. (0/23) |
| 4 | 6.69 | 146.3 | 10.2 | 0.27 / 0.51 | : 0.12 / -70, , 0.15 / -69 | none | -5.2 | 99 | 1.73 | Nothing is carved yet. The light only changes the resisted chemistry, leaving a hidden, latent image. (1/16) |
| 5 | 2.57 | 148.1 | 9.9 | 0.25 / 0.47 | – | none | -6.9 | 36 | 0.72 | A short bake finishes that reaction. (0/6) |
| 6 | 5.31 | 139.0 | 10.8 | 0.28 / 0.53 | , 0.12 / -69 | none | -5.5 | 78 | 1.53 | Then developer washes away the exposed positive resist and the pattern opens. (0/11) |
| 7 | 4.35 | 142.9 | 10.0 | 0.27 / 0.50 | – | none | -7.4 | 63 | 1.05 | Only now can the plasma etch reach the polysilicon underneath. (0/10) |
| 8 | 6.07 | 182.7 | 10.7 | 0.27 / 0.48 | , 0.12 / -69, , 0.12 / -68 | none | -7.0 | 95 | 1.41 | When the edge is done, the left over resist is stripped and the gates of a seamoss inverter remain. (1/17) |

### bm_fable

| # | Duration s | Speech WPM | Phonemes/s | Model lead / tail silence s | Pauses at punctuation (mark length s / depth dB) | Unpunctuated gaps [t s, length s] | Raw peak dBFS | Tokens | Synth s | ASR hypothesis (errors/words) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3.88 | 145.2 | 10.2 | 0.24 / 0.23 | – | none | -3.6 | 53 | 1.14 | A single silicon wafer arrives at the lethography bay. (1/9) |
| 2 | 5.31 | 177.5 | 11.4 | 0.25 / 0.23 | , 0.05 / 6 | none | -3.4 | 86 | 1.34 | First, the track spins it and spreads a thin film of photoresist across the surface. (0/14) |
| 3 | 7.86 | 163.6 | 11.8 | 0.25 / 0.26 | , 0.17 / -20 | none | 3.5 | 138 | 1.90 | The scanner then shines 193 nanometer deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. (0/23) |
| 4 | 6.23 | 159.5 | 11.1 | 0.25 / 0.24 | : 0.12 / -16, , 0.15 / -18 | none | -1.1 | 99 | 1.65 | Nothing is carved yet. The light only changes the resistance chemistry, leaving a hidden lightened image. (2/16) |
| 5 | 2.94 | 129.0 | 8.6 | 0.23 / 0.23 | – | none | -4.7 | 36 | 0.77 | A short bake finishes that reaction. (0/6) |
| 6 | 5.15 | 144.9 | 11.3 | 0.25 / 0.24 | , 0.12 / -21 | none | -2.7 | 78 | 1.17 | Then developer washes away the exposed positive resist, and the pattern opens. (0/11) |
| 7 | 4.23 | 149.3 | 10.4 | 0.24 / 0.23 | – | none | -3.5 | 63 | 1.00 | Only now can the plasma etch reach the poly silicon underneath. (0/10) |
| 8 | 5.71 | 195.7 | 11.4 | 0.23 / 0.23 | , 0.10 / -17, , 0.12 / -20 | none | -3.0 | 95 | 1.31 | When the etch is done, the leftover resist is stripped and the gates of a seamoss inverter remain. (0/17) |

### bm_lewis

| # | Duration s | Speech WPM | Phonemes/s | Model lead / tail silence s | Pauses at punctuation (mark length s / depth dB) | Unpunctuated gaps [t s, length s] | Raw peak dBFS | Tokens | Synth s | ASR hypothesis (errors/words) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3.67 | 153.4 | 10.8 | 0.40 / 0.57 | – | none | -3.1 | 53 | 0.94 | A single silicon wafer arrives at the lethography bay. (1/9) |
| 2 | 5.33 | 173.7 | 11.2 | 0.39 / 0.60 | , 0.05 / 2 | none | -2.9 | 86 | 1.43 | First, the track spins it and spreads a thin film of photoresist across the surface. (0/14) |
| 3 | 8.82 | 145.3 | 10.5 | 0.40 / 0.65 | , 0.23 / -130 | [7.14, 0.15] | -3.9 | 138 | 3.84 | The scanner then shines one ninety three nanometer deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. (0/22) |
| 4 | 6.69 | 146.6 | 10.2 | 0.41 / 0.59 | : 0.17 / -115, , 0.15 / -55 | none | -1.9 | 99 | 3.70 | Nothing is carved yet. The light only changes the resist chemistry, leaving a hidden, latent image. (1/16) |
| 5 | 2.47 | 155.2 | 10.3 | 0.39 / 0.54 | – | none | -3.9 | 36 | 1.81 | A short bake finishes that reaction. (0/6) |
| 6 | 4.95 | 150.0 | 11.7 | 0.40 / 0.59 | , 0.15 / -91 | none | -3.4 | 78 | 2.45 | Then developer washes away the exposed positive resist, and the pattern opens. (0/11) |
| 7 | 4.28 | 146.0 | 10.2 | 0.40 / 0.59 | – | [2.02, 0.15] | -3.5 | 63 | 1.23 | Only now can the plasma etch reach the poly silicon underneath. (0/10) |
| 8 | 5.98 | 185.6 | 10.8 | 0.40 / 0.59 | , 0.15 / -70, , 0.12 / -79 | none | -3.6 | 95 | 1.59 | When the etch is done, the leftover resist is stripped, and the gates of a sea-moss inverter remain. (0/17) |

### bm_daniel

| # | Duration s | Speech WPM | Phonemes/s | Model lead / tail silence s | Pauses at punctuation (mark length s / depth dB) | Unpunctuated gaps [t s, length s] | Raw peak dBFS | Tokens | Synth s | ASR hypothesis (errors/words) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3.29 | 172.5 | 12.1 | 0.25 / 0.51 | – | none | -5.2 | 53 | 0.82 | A single silicon wafer arrives at the lethography bay. (1/9) |
| 2 | 4.85 | 191.1 | 12.3 | 0.25 / 0.55 | , 0.05 / 2 | none | -2.9 | 86 | 1.21 | First, the track spins it and spreads a thin film of photo-resist across the surface. (0/14) |
| 3 | 7.38 | 174.5 | 12.6 | 0.27 / 0.55 | , 0.15 / -67 | none | -3.2 | 138 | 1.84 | The scanner then shines one 93 nanometer deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. (0/22) |
| 4 | 5.64 | 174.9 | 12.2 | 0.25 / 0.53 | : 0.12 / -67, , 0.10 / -43 | none | -5.3 | 99 | 1.29 | Nothing is carved yet. The light only changes the resist's chemistry, leaving a hidden latent image. (0/16) |
| 5 | 2.31 | 166.7 | 11.1 | 0.24 / 0.45 | – | none | -4.5 | 36 | 0.70 | A short bake finishes that reaction. (0/6) |
| 6 | 4.59 | 161.4 | 12.6 | 0.26 / 0.52 | , 0.12 / -66 | none | -5.9 | 78 | 1.28 | Then developer washes away the exposed positive resist, and the pattern opens. (0/11) |
| 7 | 3.64 | 173.4 | 12.1 | 0.25 / 0.51 | – | none | -5.1 | 63 | 0.96 | Only now can the plasma etch reach the poly silicon underneath. (0/10) |
| 8 | 5.31 | 210.1 | 12.3 | 0.26 / 0.50 | , 0.10 / -25, , 0.12 / -66 | none | -4.8 | 95 | 1.39 | When the etch is done, the leftover resist is stripped, and the gates of a seamoss inverter remain. (0/17) |

### bm_george_0.92

| # | Duration s | Speech WPM | Phonemes/s | Model lead / tail silence s | Pauses at punctuation (mark length s / depth dB) | Unpunctuated gaps [t s, length s] | Raw peak dBFS | Tokens | Synth s | ASR hypothesis (errors/words) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4.18 | 133.7 | 9.4 | 0.27 / 0.55 | – | none | -6.8 | 53 | 1.14 | A single silicon wafer arrives at the lethography bay. (1/9) |
| 2 | 5.83 | 158.5 | 10.2 | 0.27 / 0.52 | , 0.07 / -9 | none | -4.2 | 86 | 1.62 | First, the track spins it and spreads a thin film of photo resist across the surface. (0/14) |
| 3 | 9.76 | 131.1 | 9.5 | 0.29 / 0.55 | , 0.20 / -68 | [7.72, 0.15] | -4.1 | 138 | 2.96 | The scanner then shines one ninety three nanometer deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. (0/22) |
| 4 | 6.98 | 140.4 | 9.8 | 0.28 / 0.54 | : 0.12 / -70, , 0.15 / -69 | none | -5.7 | 99 | 4.10 | Nothing is carved yet. The light only changes the resist chemistry, leaving a hidden, latent image. (1/16) |
| 5 | 2.72 | 139.5 | 9.3 | 0.27 / 0.51 | – | none | -7.1 | 36 | 1.70 | A short bake finishes that reaction. (0/6) |
| 6 | 5.58 | 132.4 | 10.3 | 0.28 / 0.56 | , 0.12 / -69 | none | -5.0 | 78 | 3.01 | Then developer washes away the exposed positive resist and the pattern opens. (0/11) |
| 7 | 4.74 | 131.0 | 9.2 | 0.28 / 0.53 | – | [2.16, 0.15] | -6.3 | 63 | 3.18 | Only now can the plasma etch reach the polysilicon underneath. (0/10) |
| 8 | 6.37 | 173.4 | 10.1 | 0.28 / 0.55 | , 0.12 / -69, , 0.12 / -68 | none | -6.9 | 95 | 2.42 | When the edge is done, the left over resist is stripped and the gates of a sea-moss inverter remain. (1/17) |

### bm_fable_0.92

| # | Duration s | Speech WPM | Phonemes/s | Model lead / tail silence s | Pauses at punctuation (mark length s / depth dB) | Unpunctuated gaps [t s, length s] | Raw peak dBFS | Tokens | Synth s | ASR hypothesis (errors/words) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4.12 | 137.4 | 9.7 | 0.25 / 0.23 | – | none | -3.8 | 53 | 3.37 | A single silicon wafer arrives at the lethography bay. (1/9) |
| 2 | 5.68 | 164.5 | 10.6 | 0.25 / 0.24 | , 0.05 / 4 | none | -3.4 | 86 | 4.51 | First, the track spins it and spreads a thin film of photo resist across the surface. (0/14) |
| 3 | 8.38 | 154.2 | 11.1 | 0.25 / 0.27 | , 0.23 / -20 | none | 3.1 | 138 | 5.77 | The scanner then shines one 93 nanometer deep ultraviolet light through a reticle, shrinking the pattern four times onto the wafer. (0/22) |
| 4 | 6.50 | 152.6 | 10.7 | 0.26 / 0.26 | : 0.15 / -18, , 0.15 / -18 | none | -1.3 | 99 | 5.00 | Nothing is carved yet. The light only changes the resist's chemistry, leaving a hidden lightened image. (1/16) |
| 5 | 3.13 | 120.4 | 8.0 | 0.24 / 0.23 | – | none | -4.7 | 36 | 3.29 | A short bake finishes that reaction. (0/6) |
| 6 | 5.34 | 140.1 | 10.9 | 0.25 / 0.26 | , 0.15 / -18 | none | -3.1 | 78 | 5.74 | Then developer washes away the exposed positive resist, and the pattern opens. (0/11) |
| 7 | 4.49 | 139.9 | 9.8 | 0.25 / 0.23 | – | none | -2.6 | 63 | 2.94 | Only now can the plasma etch reach the polysilicon underneath. (0/10) |
| 8 | 5.93 | 188.8 | 11.0 | 0.25 / 0.24 | , 0.10 / -16, , 0.12 / -19 | none | -2.1 | 95 | 5.84 | When the etch is done, the leftover resist is stripped, and the gates of a seamoss inverter remain. (0/17) |

