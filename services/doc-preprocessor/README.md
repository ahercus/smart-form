# Document Preprocessor Service

Lightweight FastAPI service to normalize document photos before OCR/QC.

## Endpoint

`POST /preprocess`

Request (JSON):
```
{
  "imageBase64": "...",
  "mimeType": "image/jpeg",
  "applyWarp": true,
  "enhanceContrast": true,
  "adaptiveThreshold": false
}
```

Response (JSON):
```
{
  "imageBase64": "...",
  "mimeType": "image/jpeg"
}
```

## Behavior

- `applyWarp`: detects document edges and applies perspective warp when possible
- `enhanceContrast`: applies CLAHE contrast normalization
- `adaptiveThreshold`: optional binarization for high-noise photos

## Local run

```
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Set `DOC_PREPROCESSOR_URL` in the main app to point to this service.
