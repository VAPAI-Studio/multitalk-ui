# backend/app/services/openai_service.py

import hashlib
import json
import logging
from collections import OrderedDict
from typing import Dict, List, Optional

from screenwriter.config import settings
from screenwriter.models.database import SectionType, Framework
from .ai_provider import chat_completion

logger = logging.getLogger(__name__)

class OpenAIService:
    def __init__(self):
        self.cache: OrderedDict = OrderedDict()
        self.max_cache_size = 100

    def _generate_cache_key(self, section_id: str, text: str, framework: str) -> str:
        """Generate cache key from request parameters"""
        content = f"{section_id}:{text}:{framework}"
        return hashlib.md5(content.encode()).hexdigest()

    def _get_system_prompt(self, framework: Framework, section_type: SectionType,
                           bible_context: Optional[str] = None) -> str:
        """Generate system prompt based on framework and section type"""
        framework_context = {
            Framework.THREE_ACT: "You are analyzing a screenplay using the Three-Act Structure.",
            Framework.SAVE_THE_CAT: "You are analyzing a screenplay using the Save the Cat framework.",
            Framework.HERO_JOURNEY: "You are analyzing a screenplay using the Hero's Journey framework."
        }

        section_context = {
            SectionType.INCITING_INCIDENT: "This is the Inciting Incident - the event that disrupts the protagonist's normal life.",
            SectionType.PLOT_POINT_1: "This is Plot Point 1 - the event that propels the story into Act 2.",
            SectionType.MIDPOINT: "This is the Midpoint - the major turning point in the middle of the story.",
            SectionType.PLOT_POINT_2: "This is Plot Point 2 - the event that propels the story into Act 3.",
            SectionType.CLIMAX: "This is the Climax - the highest point of tension and conflict.",
            SectionType.RESOLUTION: "This is the Resolution - how the story wraps up."
        }

        base_prompt = f"""{framework_context[framework]}

        {section_context[section_type]}

        Analyze the provided text and return a JSON object with two arrays:
        1. "issues": potential problems or areas that need improvement
        2. "suggestions": specific recommendations to strengthen this section

        Focus on:
        - Story structure coherence
        - Character development
        - Pacing and tension
        - Clarity of conflict/stakes
        """
        if bible_context:
            return f"{bible_context}\n---\n{base_prompt}"
        return base_prompt

    async def review_section(
        self,
        section_id: str,
        text: str,
        framework: Framework,
        section_type: SectionType,
        bible_context: Optional[str] = None,
    ) -> Dict[str, List[str]]:
        """Send section text to OpenAI for review"""

        # Check cache first
        cache_key = self._generate_cache_key(section_id, text, framework.value)
        if cache_key in self.cache:
            self.cache.move_to_end(cache_key)
            return self.cache[cache_key]

        # Truncate text if too long
        if len(text) > settings.MAX_SECTION_LENGTH:
            text = text[:settings.MAX_SECTION_LENGTH] + "..."

        try:
            ai_text = await chat_completion(
                messages=[
                    {"role": "system", "content": self._get_system_prompt(framework, section_type, bible_context=bible_context)},
                    {"role": "user", "content": f"Analyze this section:\n\n{text}"}
                ],
                temperature=0.7,
                max_tokens=settings.MAX_TOKENS,
                json_mode=True,
            )

            result = json.loads(ai_text)

            # Ensure proper format
            review_result = {
                "issues": result.get("issues", []),
                "suggestions": result.get("suggestions", [])
            }

            # Cache result with LRU eviction
            self.cache[cache_key] = review_result
            self.cache.move_to_end(cache_key)
            if len(self.cache) > self.max_cache_size:
                self.cache.popitem(last=False)

            return review_result

        except Exception as e:
            logger.error(f"OpenAI API error: {str(e)}")
            return {
                "issues": ["Unable to analyze section at this time."],
                "suggestions": ["Please try again later."]
            }

# Singleton instance
openai_service = OpenAIService()
