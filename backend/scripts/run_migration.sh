#!/bin/bash

# Script to run user_id migration
# Usage:
#   ./scripts/run_migration.sh --dry-run    # Preview changes
#   ./scripts/run_migration.sh              # Execute migration

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}  User ID Migration Script${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""

# Check if .env file exists
if [ ! -f "backend/.env" ] && [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo "   Please create backend/.env with:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Load environment variables
if [ -f "backend/.env" ]; then
    export $(cat backend/.env | grep -v '^#' | xargs)
elif [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo -e "${RED}❌ Error: Missing required environment variables${NC}"
    echo "   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

echo -e "${GREEN}✅ Environment variables loaded${NC}"
echo ""

# Change to backend directory if not already there
if [ -d "backend" ]; then
    cd backend
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Error: Python 3 is not installed${NC}"
    exit 1
fi

# Check if supabase package is installed
python3 -c "import supabase" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Supabase package not found${NC}"
    echo "   Installing supabase package..."
    pip install supabase
    echo ""
fi

# Run migration script
echo -e "${BLUE}Running migration script...${NC}"
echo ""

if [ "$1" == "--dry-run" ]; then
    python3 scripts/migrate_null_user_ids.py --dry-run
else
    echo -e "${YELLOW}⚠️  WARNING: This will modify the database${NC}"
    echo "   Run with --dry-run first to preview changes"
    echo ""
    read -p "Continue with migration? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        python3 scripts/migrate_null_user_ids.py
        echo ""
        echo -e "${GREEN}✅ Migration completed${NC}"
    else
        echo -e "${YELLOW}Migration cancelled${NC}"
        exit 0
    fi
fi

echo ""
echo -e "${BLUE}==========================================${NC}"
