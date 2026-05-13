# backend/app/utils/validators.py

import re
from typing import Optional
from fastapi import HTTPException, status

from screenwriter.models.database import SectionType, Framework
from screenwriter.config import settings

def validate_email(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

def validate_project_title(title: str) -> None:
    """Validate project title"""
    if not title or not title.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project title cannot be empty"
        )
    
    if len(title.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project title must be at least 2 characters long"
        )
    
    if len(title) > 255:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project title cannot exceed 255 characters"
        )

def validate_section_content(content: str) -> str:
    """Validate and possibly truncate section content"""
    if not content:
        return ""
    
    # Truncate if exceeds maximum length
    if len(content) > settings.MAX_SECTION_LENGTH:
        return content[:settings.MAX_SECTION_LENGTH] + "..."
    
    return content

def validate_section_type(section_type: str) -> bool:
    """Validate if section type is valid"""
    try:
        SectionType(section_type)
        return True
    except ValueError:
        return False

def validate_framework(framework: str) -> bool:
    """Validate if framework is valid"""
    try:
        Framework(framework)
        return True
    except ValueError:
        return False

def validate_checklist_prompt(prompt: str) -> None:
    """Validate checklist prompt"""
    if not prompt or not prompt.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Checklist prompt cannot be empty"
        )
    
    if len(prompt.strip()) < 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Checklist prompt must be at least 5 characters long"
        )

def validate_checklist_answer(answer: str) -> str:
    """Validate checklist answer"""
    if not answer:
        return ""
    
    # Basic sanitization
    answer = answer.strip()
    
    # Limit answer length
    max_answer_length = 1000
    if len(answer) > max_answer_length:
        answer = answer[:max_answer_length] + "..."
    
    return answer

def validate_review_text(text: str) -> None:
    """Validate text for review submission"""
    if not text or not text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review text cannot be empty"
        )
    
    # Minimum length for meaningful review
    if len(text.strip()) < 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review text must be at least 20 characters long for meaningful analysis"
        )

def validate_uuid(uuid_string: str) -> bool:
    """Validate UUID format"""
    uuid_pattern = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        re.IGNORECASE
    )
    return bool(uuid_pattern.match(uuid_string))

def sanitize_html(text: str) -> str:
    """Basic HTML sanitization for user input"""
    if not text:
        return ""
    
    # Remove any HTML tags
    clean_text = re.sub(r'<[^>]+>', '', text)
    
    # Replace multiple spaces with single space
    clean_text = re.sub(r'\s+', ' ', clean_text)
    
    return clean_text.strip()

def validate_api_key(api_key: Optional[str]) -> bool:
    """Validate OpenAI API key format"""
    if not api_key:
        return False
    
    # OpenAI API keys typically start with "sk-" and have specific length
    if not api_key.startswith("sk-") or len(api_key) < 20:
        return False
    
    return True

def validate_pagination(page: int = 1, page_size: int = 10) -> tuple[int, int]:
    """Validate pagination parameters"""
    # Ensure positive integers
    page = max(1, page)
    page_size = max(1, min(page_size, 100))  # Max 100 items per page
    
    return page, page_size

def validate_sort_order(sort_order: str) -> str:
    """Validate sort order parameter"""
    valid_orders = ["asc", "desc", "ascending", "descending"]
    sort_order = sort_order.lower()
    
    if sort_order not in valid_orders:
        return "desc"  # Default sort order
    
    # Normalize to "asc" or "desc"
    if sort_order in ["ascending", "asc"]:
        return "asc"
    return "desc"

def validate_search_query(query: str) -> str:
    """Validate and sanitize search query"""
    if not query:
        return ""
    
    # Remove special characters that might break search
    query = re.sub(r'[^\w\s-]', '', query)
    
    # Limit query length
    max_query_length = 100
    if len(query) > max_query_length:
        query = query[:max_query_length]
    
    return query.strip()

def validate_password(password: str) -> None:
    """Validate password strength"""
    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long"
        )
    
    if not re.search(r"[A-Z]", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one uppercase letter"
        )
    
    if not re.search(r"[a-z]", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one lowercase letter"
        )
    
    if not re.search(r"\d", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one number"
        )

def validate_file_type(filename: str, allowed_types: list[str]) -> bool:
    """Validate file type based on extension"""
    if not filename:
        return False
    
    ext = filename.split('.')[-1].lower()
    return ext in allowed_types

def validate_json_structure(data: dict, required_fields: list[str]) -> bool:
    """Validate JSON structure has required fields"""
    return all(field in data for field in required_fields)
