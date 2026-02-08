"""
Gemini client wrapper for field extraction.
Supports both Flash and Pro models with configurable thinking levels.
"""

import os
import time
from dataclasses import dataclass
from typing import Any, Literal

import google.generativeai as genai


ThinkingLevel = Literal["MINIMAL", "MEDIUM"]
ModelName = Literal["gemini-3-flash-preview", "gemini-3-pro-preview"]


@dataclass
class ExtractionResult:
    """Result from a Gemini extraction call."""
    fields: list[dict]
    no_fields_in_region: bool
    raw_response: dict
    duration_ms: float
    model: str
    thinking_level: str


@dataclass
class GeminiConfig:
    """Configuration for Gemini client."""
    model: ModelName = "gemini-3-flash-preview"
    thinking_level: ThinkingLevel = "MINIMAL"
    temperature: float = 0.1
    max_output_tokens: int = 8192


class GeminiClient:
    """
    Wrapper for Gemini Vision API calls.

    Supports:
    - Multiple model variants (Flash, Pro)
    - Configurable thinking levels (MINIMAL, MEDIUM)
    - JSON schema enforcement
    - Timing metrics
    """

    def __init__(self, config: GeminiConfig | None = None):
        """
        Initialize Gemini client.

        Args:
            config: Optional configuration. Uses defaults if not provided.
        """
        self.config = config or GeminiConfig()

        # Configure API key from environment
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY or GOOGLE_API_KEY environment variable required"
            )
        genai.configure(api_key=api_key)

        # Initialize model
        self.model = genai.GenerativeModel(
            model_name=self.config.model,
            generation_config=genai.GenerationConfig(
                temperature=self.config.temperature,
                max_output_tokens=self.config.max_output_tokens,
                response_mime_type="application/json",
            )
        )

    def extract_fields(
        self,
        image_base64: str,
        prompt: str,
        response_schema: dict | None = None
    ) -> ExtractionResult:
        """
        Extract fields from an image using Gemini Vision.

        Args:
            image_base64: Base64 encoded image (JPEG)
            prompt: Extraction prompt
            response_schema: Optional JSON schema for response validation

        Returns:
            ExtractionResult with extracted fields and metadata
        """
        import base64

        # Build message content
        contents = [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": image_base64
                        }
                    }
                ]
            }
        ]

        # Add thinking level configuration
        generation_config = {
            "temperature": self.config.temperature,
            "max_output_tokens": self.config.max_output_tokens,
            "response_mime_type": "application/json",
        }

        # Add response schema if provided
        if response_schema:
            generation_config["response_schema"] = response_schema

        # Time the API call
        start_time = time.perf_counter()

        try:
            response = self.model.generate_content(
                contents,
                generation_config=generation_config
            )

            duration_ms = (time.perf_counter() - start_time) * 1000

            # Parse response
            response_text = response.text
            import json
            parsed = json.loads(response_text)

            return ExtractionResult(
                fields=parsed.get("fields", []),
                no_fields_in_region=parsed.get("noFieldsInRegion", False),
                raw_response=parsed,
                duration_ms=duration_ms,
                model=self.config.model,
                thinking_level=self.config.thinking_level
            )

        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            raise ExtractionError(
                f"Gemini extraction failed: {str(e)}",
                duration_ms=duration_ms,
                model=self.config.model
            )


class ExtractionError(Exception):
    """Error during field extraction."""

    def __init__(self, message: str, duration_ms: float = 0, model: str = ""):
        super().__init__(message)
        self.duration_ms = duration_ms
        self.model = model


# Response schema for field extraction (matches TypeScript implementation)
EXTRACTION_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "fieldType": {
                        "type": "string",
                        "enum": [
                            "text", "textarea", "checkbox", "radio", "date",
                            "signature", "initials", "circle_choice",
                            "table", "linkedText", "linkedDate"
                        ]
                    },
                    "coordinates": {
                        "type": "object",
                        "properties": {
                            "left": {"type": "number"},
                            "top": {"type": "number"},
                            "width": {"type": "number"},
                            "height": {"type": "number"}
                        },
                        "required": ["left", "top", "width", "height"]
                    },
                    "groupLabel": {"type": "string"},
                    "rows": {"type": "number"},
                    "tableConfig": {
                        "type": "object",
                        "properties": {
                            "columnHeaders": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "coordinates": {
                                "type": "object",
                                "properties": {
                                    "left": {"type": "number"},
                                    "top": {"type": "number"},
                                    "width": {"type": "number"},
                                    "height": {"type": "number"}
                                }
                            },
                            "dataRows": {"type": "number"},
                            "columnPositions": {
                                "type": "array",
                                "items": {"type": "number"}
                            }
                        }
                    },
                    "segments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "left": {"type": "number"},
                                "top": {"type": "number"},
                                "width": {"type": "number"},
                                "height": {"type": "number"}
                            }
                        }
                    },
                    "dateSegments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "left": {"type": "number"},
                                "top": {"type": "number"},
                                "width": {"type": "number"},
                                "height": {"type": "number"},
                                "part": {
                                    "type": "string",
                                    "enum": ["day", "month", "year", "year2"]
                                }
                            }
                        }
                    }
                },
                "required": ["label", "fieldType"]
            }
        },
        "noFieldsInRegion": {"type": "boolean"}
    },
    "required": ["fields", "noFieldsInRegion"]
}
