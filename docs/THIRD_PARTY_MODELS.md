# Third-party local models

NoteBi does not commit speaker-model weights to the source repository. Speaker
analysis downloads the selected model lazily on first use. The default `auto`
route tries WeSpeaker first and falls back to sherpa-onnx when the optional
runtime/model is unavailable or returns fewer speakers than requested.

| Purpose | Model | License | Upstream |
|---|---|---|---|
| Speaker segmentation | pyannote segmentation 3.0, sherpa-onnx INT8 conversion | MIT | https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models |
| Speaker embedding | 3D-Speaker ERes2Net base zh-cn 16k | Apache-2.0 | https://github.com/modelscope/3D-Speaker |
| Speaker embedding (preferred) | WeSpeaker CN/EN ResNet34-LM | Apache-2.0 | https://github.com/wenet-e2e/wespeaker |

The non-commercial Reverb diarization model is intentionally not used.
