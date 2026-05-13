import asyncio
import json
import logging
from typing import List, Dict

from .ai_provider import chat_completion

logger = logging.getLogger(__name__)

# Section types for relevance scoring
SECTION_TYPES = [
    "INCITING_INCIDENT",
    "PLOT_POINT_1",
    "MIDPOINT",
    "PLOT_POINT_2",
    "CLIMAX",
    "RESOLUTION",
]


class KnowledgeExtractionService:
    """Extracts structured knowledge from book chapters using AI.

    Three-stage pipeline:
    1. Concept Identification — extract key concepts from a chapter
    2. Deep Concept Analysis — examples, actionable questions, section relevance
    3. Relationship Mapping — inter-concept relationships
    """

    async def _call_ai(self, system_prompt: str, user_prompt: str) -> dict:
        """Call AI with JSON response format and retry on errors."""
        for attempt in range(5):
            try:
                text = await chat_completion(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.3,
                    max_tokens=4000,
                    json_mode=True,
                )
                return json.loads(text)
            except Exception as e:
                if attempt < 4:
                    wait = 2 ** attempt * 2
                    logger.warning(f"AI call failed, retrying in {wait}s (attempt {attempt + 1}/5): {e}")
                    await asyncio.sleep(wait)
                else:
                    raise
        raise RuntimeError("AI call failed after 5 retries")

    async def extract_concepts(self, chapter_text: str, chapter_title: str, book_title: str) -> List[Dict]:
        """Stage 1: Identify key screenwriting concepts in a chapter."""
        system_prompt = """You are a knowledge extraction specialist for screenwriting books.
Your task is to identify the KEY CONCEPTS taught in this chapter. Focus on:
- Named techniques, principles, or frameworks
- Definitions of screenwriting terminology
- Rules or guidelines the author teaches
- Structural patterns or story elements

Do NOT include:
- Trivial observations ("show don't tell" without deeper explanation)
- Biographical information about the author
- Marketing or promotional content
- Generic advice that applies to all writing

Return a JSON object with:
{
  "concepts": [
    {
      "name": "Short concept name (e.g., 'The Gap', 'Story Values', 'Beat Sheet')",
      "definition": "Clear 2-4 sentence definition of this concept as taught by the author",
      "page_range": "Approximate page range if identifiable, otherwise null",
      "tags": ["categorization tags — use any relevant from: structure, character, conflict, dialogue, scene_design, pacing, theme, short_film, genre, motivation, emotional_arc, visual_storytelling, subtext, tone"],
      "quality_score": 0.0
    }
  ]
}

For quality_score (0.0 to 1.0) — only include concepts scoring >= 0.5:
- 0.0-0.49: Skip (padding, obvious truisms, filler content)
- 0.5-0.69: Useful supporting concept (general advice with some specificity)
- 0.7-0.89: Strong actionable concept (named technique or framework with clear application)
- 0.9-1.0: Core insight (the author's most original, specific, and actionable teaching)

Be selective — 3-8 high-quality concepts per chapter is better than 15 mediocre ones. Only return concepts with quality_score >= 0.5."""

        user_prompt = f"""Book: "{book_title}"
Chapter: "{chapter_title}"

Chapter text:
{chapter_text[:12000]}"""

        try:
            result = await self._call_ai(system_prompt, user_prompt)
            return result.get("concepts", [])
        except Exception as e:
            logger.error(f"Concept extraction failed for chapter '{chapter_title}': {e}")
            return []

    async def analyze_concept(self, concept_name: str, concept_definition: str, chapter_text: str, book_title: str) -> Dict:
        """Stage 2: Deep analysis of a single concept — examples, questions, section relevance."""
        section_types_str = ", ".join(SECTION_TYPES)

        system_prompt = f"""You are a screenwriting knowledge analyst. Given a concept from a screenwriting book, extract:

1. Film/screenplay examples the author uses to illustrate this concept
2. Actionable questions a writer could use to evaluate their own screenplay against this concept
3. How relevant this concept is to each section type of a screenplay: {section_types_str}

Return a JSON object with:
{{
  "examples": [
    {{
      "film": "Film name",
      "description": "How this film/scene demonstrates the concept (1-2 sentences)",
      "page": "Page number if identifiable, otherwise null"
    }}
  ],
  "actionable_questions": [
    "Question a writer should ask about their screenplay to check if they're applying this concept correctly"
  ],
  "section_relevance": {{
    "INCITING_INCIDENT": 0.0 to 1.0,
    "PLOT_POINT_1": 0.0 to 1.0,
    "MIDPOINT": 0.0 to 1.0,
    "PLOT_POINT_2": 0.0 to 1.0,
    "CLIMAX": 0.0 to 1.0,
    "RESOLUTION": 0.0 to 1.0
  }}
}}

For section_relevance, score how relevant this concept is when analyzing each section type (0.0 = not relevant, 1.0 = critically important).
Generate 3-6 actionable questions. Be specific and practical."""

        user_prompt = f"""Book: "{book_title}"
Concept: "{concept_name}"
Definition: "{concept_definition}"

Source chapter text (for context):
{chapter_text[:8000]}"""

        try:
            result = await self._call_ai(system_prompt, user_prompt)
            return {
                "examples": result.get("examples", []),
                "actionable_questions": result.get("actionable_questions", []),
                "section_relevance": result.get("section_relevance", {}),
            }
        except Exception as e:
            logger.error(f"Concept analysis failed for '{concept_name}': {e}")
            return {
                "examples": [],
                "actionable_questions": [],
                "section_relevance": {},
            }

    async def extract_relationships(self, concepts: List[Dict], book_title: str) -> List[Dict]:
        """Stage 3: Identify relationships between concepts."""
        if len(concepts) < 2:
            return []

        concept_list = "\n".join(
            f"- {c['name']}: {c['definition'][:100]}..." for c in concepts
        )

        system_prompt = """You are a knowledge graph specialist. Given a list of screenwriting concepts from the same book, identify meaningful relationships between them.

Relationship types:
- depends_on: Concept A requires understanding of Concept B
- related_to: Concepts are thematically connected
- part_of: Concept A is a component of Concept B
- example_of: Concept A is a specific instance of Concept B
- contradicts: Concepts present opposing viewpoints
- extends: Concept A builds upon or refines Concept B

Return a JSON object with:
{
  "relationships": [
    {
      "source": "Source concept name (exact match from the list)",
      "target": "Target concept name (exact match from the list)",
      "type": "relationship type",
      "description": "Brief explanation of why/how they relate"
    }
  ]
}

Only include meaningful, non-trivial relationships. Aim for 3-10 relationships depending on concept count."""

        user_prompt = f"""Book: "{book_title}"

Concepts:
{concept_list}"""

        try:
            result = await self._call_ai(system_prompt, user_prompt)
            return result.get("relationships", [])
        except Exception as e:
            logger.error(f"Relationship extraction failed for '{book_title}': {e}")
            return []

    async def extract_snippets(
        self,
        chapter_text: str,
        chapter_title: str,
        book_title: str,
        concepts: List[Dict],
    ) -> List[Dict]:
        """Stage 4: Identify 3-5 key passages that best illustrate the extracted concepts.

        Returns [] if no concepts were found for this chapter.
        """
        if not concepts:
            return []

        concept_summary = "\n".join(
            f"- {c['name']}: {c.get('definition', '')[:100]}" for c in concepts
        )

        system_prompt = """You are a knowledge curation specialist. Given a chapter from a screenwriting book and its extracted concepts, identify the 3-5 most illuminating passages that best illustrate these concepts.

For each passage, extract the EXACT text from the chapter (do not paraphrase or summarize). Choose passages that:
- Directly define, demonstrate, or exemplify a specific concept
- Are self-contained and understandable without surrounding context
- Are 50-300 words in length (long enough to be meaningful, short enough to be scannable)

Return a JSON object with:
{
  "snippets": [
    {
      "content": "The exact passage text from the chapter",
      "concept_name": "The concept this passage best illustrates (exact name from the list)",
      "justification": "1-2 sentence explanation of why this passage was chosen"
    }
  ]
}

Return 3-5 snippets. Quality over quantity."""

        user_prompt = f"""Book: "{book_title}"
Chapter: "{chapter_title}"

Extracted concepts from this chapter:
{concept_summary}

Chapter text:
{chapter_text[:10000]}"""

        try:
            result = await self._call_ai(system_prompt, user_prompt)
            return result.get("snippets", [])
        except Exception as e:
            logger.error(f"Snippet extraction failed for chapter '{chapter_title}': {e}")
            return []

    async def process_chapter(self, chapter_text: str, chapter_title: str, book_title: str) -> Dict:
        """Full pipeline for a single chapter: extract → analyze → relate → find snippets."""
        logger.info(f"Processing chapter: {chapter_title}")

        # Stage 1: Extract concepts
        raw_concepts = await self.extract_concepts(chapter_text, chapter_title, book_title)
        logger.info(f"  Found {len(raw_concepts)} concepts in '{chapter_title}'")

        if not raw_concepts:
            return {"concepts": [], "relationships": [], "snippets": []}

        # Stage 2: Deep analysis for each concept (with delay to avoid rate limits)
        enriched_concepts = []
        for i, concept in enumerate(raw_concepts):
            analysis = await self.analyze_concept(
                concept_name=concept["name"],
                concept_definition=concept["definition"],
                chapter_text=chapter_text,
                book_title=book_title,
            )
            enriched_concepts.append({
                **concept,
                "chapter_source": chapter_title,
                **analysis,
            })
            if i < len(raw_concepts) - 1:
                await asyncio.sleep(1)

        # Stage 3: Extract relationships
        relationships = await self.extract_relationships(enriched_concepts, book_title)
        logger.info(f"  Found {len(relationships)} relationships in '{chapter_title}'")

        # Stage 4: Extract key snippets
        snippets = await self.extract_snippets(
            chapter_text=chapter_text,
            chapter_title=chapter_title,
            book_title=book_title,
            concepts=enriched_concepts,
        )
        logger.info(f"  Found {len(snippets)} snippets in '{chapter_title}'")

        return {
            "concepts": enriched_concepts,
            "relationships": relationships,
            "snippets": snippets,
        }


knowledge_extraction_service = KnowledgeExtractionService()
