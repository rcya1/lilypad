---
title: Video Streaming
date: 2024-10-01
order: 6
---

## Video Streaming

- Over 3/4 of bits send over the Internet are video
- In early days, sending uncompressed video would be way too much (740 megabits per second when we could only do like 20)
- **Intra-frame compression**:
  - Compressing an image only relative to itself
  - Divide component into blocks (i.e. 8x8)
  - For each channel of each component, predict from surrounding blocks what this component is
  - Take the residue (what's left / not predicted) and transform it (i.e. some change of basis)
  - Then quantize this to throw away some higher level information but keep the general picture
  - Then use some compression algorithm to transmit this (i.e. Huffman codes)
- **Inter-frame compression**
  - Divide frame into macroblocks
  - For each macroblock, encode with either the intra-frame compression discussed before
  - Or predict by shifting / warping part of a reference frame and then compressing the residue
  - The resulting frame can be either displayed and/or stored as a reference frame for future compression
  - The reference frame could be from the future or past
- A macroblock can be labeled as:
  - I: from intra-frame
  - P: predicted from past
  - B: bilteral prediction from the future

### Bitrate

- What is bitrate?
- Problem: it is no longer predictable how many bits each frame will consume
  - In the best case, we have a single frame that takes some kb and then everything else is 0
  - Or in the worst case, everything requires the same amount of kb to display the entire image
- Target decoder model:
  - We have a buffer that is filling with information at some constant network speed
  - In "random" spurts, it is decreasing as we take frames out of the buffer
- What it means for a video to have a certain bitrate is:
  - If bytes stream in at that rate and the buffer has a certain max occupancy and the video starts playing when the buffer reaches a certain occupancy, then the video can play without interruption and without the buffer ever filling up
- How can we reduce required bitrate?
  - Can make it look worse (reduce quality) by reducing picture quality or framerate

### Playback

- When can you start playing frames?
- If every frame was the same size, you could just wait until you got a single frame
  - Or you could just wait until your buffer filled
  - You could also do some backwards computation to figure it out
- Services like YouTube offer multiple possible bitrates
- How does this make the choice automatically?
  - Segmented streaming with bitrate adaptation (around the 2008 Olympics)
  - We divide the video into independent segments
    - Between segments, no inter-frame prediction
  - This means that at every segment, there is a decision opportunity for what bitrate to get this segment at
  - At each segment, we use an ABR policy to choose the appropriate bitrate
    - The first policies estimated throughput then picked the highest feasible
    - This is done client-side
