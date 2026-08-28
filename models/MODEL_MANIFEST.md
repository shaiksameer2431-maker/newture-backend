# NECN Local Model Manifest

All production inference is offline. Loaders resolve this directory relative to their own source file.

| Model | Location | SHA-256 |
| --- | --- | --- |
| all-MiniLM-L6-v2 | `Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx` | `AFDB6F1A0E45B715D0BB9B11772F032C399BABD23BFC31FED1C170AFC848BDB1` |
| LaMini encoder | `Xenova/LaMini-Flan-T5-77M/onnx/encoder_model_quantized.onnx` | `4F390DE450B7D6F23817795484E37CCB0F6C2BBE618F4BAD414712C664CFE07D` |
| LaMini decoder | `Xenova/LaMini-Flan-T5-77M/onnx/decoder_model_merged_quantized.onnx` | `E2CC3C6A18BA1952567754366C7A76C0F266AFC5D071B5488138B7F684D63C28` |

`allowLocalModels=true` and `allowRemoteModels=false` are set by both loaders. Model changes require re-verifying these hashes.
