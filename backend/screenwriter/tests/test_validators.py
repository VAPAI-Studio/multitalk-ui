# backend/tests/test_validators.py

import pytest
from fastapi import HTTPException
from screenwriter.utils.validators import (
    validate_email,
    validate_project_title,
    validate_section_content,
    validate_review_text,
    validate_password,
    sanitize_html
)

class TestValidators:
    """Test validation functions"""
    
    def test_validate_email(self):
        """Test email validation"""
        # Valid emails
        assert validate_email("user@example.com") is True
        assert validate_email("user.name+tag@example.co.uk") is True
        
        # Invalid emails
        assert validate_email("invalid.email") is False
        assert validate_email("@example.com") is False
        assert validate_email("user@") is False
        assert validate_email("user@example") is False
    
    def test_validate_project_title(self):
        """Test project title validation"""
        # Valid titles
        validate_project_title("My Project")
        validate_project_title("A" * 255)  # Max length
        
        # Invalid titles
        with pytest.raises(HTTPException) as exc:
            validate_project_title("")
        assert exc.value.status_code == 400
        assert "empty" in exc.value.detail
        
        with pytest.raises(HTTPException) as exc:
            validate_project_title("A")  # Too short
        assert exc.value.status_code == 400
        assert "at least 2 characters" in exc.value.detail
        
        with pytest.raises(HTTPException) as exc:
            validate_project_title("A" * 256)  # Too long
        assert exc.value.status_code == 400
        assert "exceed 255 characters" in exc.value.detail
    
    def test_validate_section_content(self):
        """Test section content validation"""
        # Normal content
        assert validate_section_content("Some content") == "Some content"
        
        # Empty content
        assert validate_section_content("") == ""
        
        # Content exceeding max length (assuming MAX_SECTION_LENGTH is 1500)
        long_content = "A" * 2000
        result = validate_section_content(long_content)
        assert len(result) == 1503  # 1500 + "..."
        assert result.endswith("...")
    
    def test_validate_review_text(self):
        """Test review text validation"""
        # Valid text
        valid_text = "This is a valid review text with enough content."
        validate_review_text(valid_text)  # Should not raise
        
        # Empty text
        with pytest.raises(HTTPException) as exc:
            validate_review_text("")
        assert exc.value.status_code == 400
        assert "empty" in exc.value.detail
        
        # Too short text
        with pytest.raises(HTTPException) as exc:
            validate_review_text("Too short")
        assert exc.value.status_code == 400
        assert "at least 20 characters" in exc.value.detail
    
    def test_validate_password(self):
        """Test password validation"""
        # Valid password
        validate_password("StrongPass123")  # Should not raise
        
        # Too short
        with pytest.raises(HTTPException) as exc:
            validate_password("Short1")
        assert exc.value.status_code == 400
        assert "at least 8 characters" in exc.value.detail
        
        # Missing uppercase
        with pytest.raises(HTTPException) as exc:
            validate_password("weakpass123")
        assert exc.value.status_code == 400
        assert "uppercase letter" in exc.value.detail
        
        # Missing lowercase
        with pytest.raises(HTTPException) as exc:
            validate_password("WEAKPASS123")
        assert exc.value.status_code == 400
        assert "lowercase letter" in exc.value.detail
        
        # Missing number
        with pytest.raises(HTTPException) as exc:
            validate_password("WeakPassword")
        assert exc.value.status_code == 400
        assert "number" in exc.value.detail
    
    def test_sanitize_html(self):
        """Test HTML sanitization"""
        # HTML tags should be removed
        assert sanitize_html("<p>Hello</p>") == "Hello"
        assert sanitize_html("<script>alert('xss')</script>") == "alert('xss')"
        
        # Multiple spaces should be normalized
        assert sanitize_html("Hello    World") == "Hello World"
        
        # Empty input
        assert sanitize_html("") == ""
        assert sanitize_html(None) == ""
