#!/usr/bin/env python3
"""
Migration script to convert ComfyUI URLs to Supabase Storage URLs.

This script:
1. Scans all tables for ComfyUI/localhost URLs
2. Downloads the files and uploads them to Supabase Storage
3. Updates the database with the new Supabase URLs

Tables and columns scanned:
- video_jobs: output_video_urls (array)
- edited_images: result_image_url, source_image_url
- style_transfers: result_image_url, source_image_url, style_image_url

Usage:
    python scripts/migrate_comfyui_urls.py [--dry-run] [--limit N] [--table TABLE]

Arguments:
    --dry-run       Print what would be done without making changes
    --limit N       Process at most N records per table (default: all)
    --table TABLE   Only process specific table (video_jobs, edited_images, style_transfers)
"""

import os
import sys
import asyncio
import argparse
import re
from typing import List, Tuple, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from core.supabase import get_supabase
from services.storage_service import StorageService


# Patterns to identify ComfyUI/local URLs that need migration
COMFYUI_PATTERNS = [
    r'https?://localhost[:/]',
    r'https?://127\.0\.0\.1[:/]',
    r'https?://[^/]*comfy[^/]*/api/view',
    r'https?://[^/]*/view\?filename=',
]

# Pattern to identify Supabase URLs (these don't need migration)
SUPABASE_PATTERN = r'https://[^/]+\.supabase\.co/storage/'


def is_comfyui_url(url: str) -> bool:
    """Check if a URL is a ComfyUI/local URL that needs migration."""
    if not url:
        return False

    # Skip if already a Supabase URL
    if re.search(SUPABASE_PATTERN, url):
        return False

    # Check if it matches any ComfyUI pattern
    for pattern in COMFYUI_PATTERNS:
        if re.search(pattern, url, re.IGNORECASE):
            return True

    return False


async def migrate_video_jobs(
    supabase,
    storage_service: StorageService,
    dry_run: bool = False,
    limit: int = None
) -> Tuple[int, int, int]:
    """Migrate ComfyUI URLs in video_jobs table."""

    print("\n📹 Migrating video_jobs table...")

    query = supabase.table("video_jobs")\
        .select("id, output_video_urls")

    if limit:
        query = query.limit(limit)

    result = query.execute()
    records = result.data or []

    found = 0
    migrated = 0
    failed = 0

    for record in records:
        record_id = record['id']
        urls = record.get('output_video_urls') or []

        # Check if any URLs need migration
        needs_migration = any(is_comfyui_url(url) for url in urls)
        if not needs_migration:
            continue

        found += 1

        if dry_run:
            print(f"   Would migrate: {record_id}")
            for url in urls:
                if is_comfyui_url(url):
                    print(f"      - {url[:60]}...")
            continue

        # Migrate each URL
        new_urls = []
        for url in urls:
            if is_comfyui_url(url):
                print(f"   🔄 Migrating video {record_id}...", end=" ", flush=True)
                success, new_url, error = await storage_service.upload_video_from_url(
                    url, 'migrated-videos'
                )
                if success and new_url:
                    new_urls.append(new_url)
                    print("✅")
                else:
                    print(f"❌ {error}")
                    new_urls.append(url)  # Keep original on failure
                    failed += 1
            else:
                new_urls.append(url)

        # Update database
        if new_urls != urls:
            supabase.table("video_jobs")\
                .update({"output_video_urls": new_urls})\
                .eq("id", record_id)\
                .execute()
            migrated += 1

    print(f"   Found: {found}, Migrated: {migrated}, Failed: {failed}")
    return found, migrated, failed


async def migrate_edited_images(
    supabase,
    storage_service: StorageService,
    dry_run: bool = False,
    limit: int = None
) -> Tuple[int, int, int]:
    """Migrate ComfyUI URLs in edited_images table."""

    print("\n🖼️ Migrating edited_images table...")

    query = supabase.table("edited_images")\
        .select("id, result_image_url, source_image_url")

    if limit:
        query = query.limit(limit)

    result = query.execute()
    records = result.data or []

    found = 0
    migrated = 0
    failed = 0

    for record in records:
        record_id = record['id']
        update_data = {}

        for field in ['result_image_url', 'source_image_url']:
            url = record.get(field)
            if not is_comfyui_url(url):
                continue

            found += 1

            if dry_run:
                print(f"   Would migrate {record_id}.{field}: {url[:50]}...")
                continue

            print(f"   🔄 Migrating {field} for {record_id}...", end=" ", flush=True)
            success, new_url, error = await storage_service.upload_image_from_url(
                url, 'migrated-images'
            )
            if success and new_url:
                update_data[field] = new_url
                print("✅")
            else:
                print(f"❌ {error}")
                failed += 1

        # Update database if any fields changed
        if update_data and not dry_run:
            supabase.table("edited_images")\
                .update(update_data)\
                .eq("id", record_id)\
                .execute()
            migrated += 1

    print(f"   Found: {found}, Migrated: {migrated}, Failed: {failed}")
    return found, migrated, failed


async def migrate_style_transfers(
    supabase,
    storage_service: StorageService,
    dry_run: bool = False,
    limit: int = None
) -> Tuple[int, int, int]:
    """Migrate ComfyUI URLs in style_transfers table."""

    print("\n🎨 Migrating style_transfers table...")

    query = supabase.table("style_transfers")\
        .select("id, result_image_url, source_image_url, style_image_url")

    if limit:
        query = query.limit(limit)

    result = query.execute()
    records = result.data or []

    found = 0
    migrated = 0
    failed = 0

    for record in records:
        record_id = record['id']
        update_data = {}

        for field in ['result_image_url', 'source_image_url', 'style_image_url']:
            url = record.get(field)
            if not is_comfyui_url(url):
                continue

            found += 1

            if dry_run:
                print(f"   Would migrate {record_id}.{field}: {url[:50]}...")
                continue

            print(f"   🔄 Migrating {field} for {record_id}...", end=" ", flush=True)
            success, new_url, error = await storage_service.upload_image_from_url(
                url, 'migrated-images'
            )
            if success and new_url:
                update_data[field] = new_url
                print("✅")
            else:
                print(f"❌ {error}")
                failed += 1

        # Update database if any fields changed
        if update_data and not dry_run:
            supabase.table("style_transfers")\
                .update(update_data)\
                .eq("id", record_id)\
                .execute()
            migrated += 1

    print(f"   Found: {found}, Migrated: {migrated}, Failed: {failed}")
    return found, migrated, failed


async def run_migration(
    dry_run: bool = False,
    limit: int = None,
    table: str = None
):
    """Run the migration on all or specific tables."""

    print("\n" + "=" * 60)
    print("🔄 ComfyUI URL Migration Script")
    print("=" * 60)

    if dry_run:
        print("\n⚠️  DRY RUN MODE - No changes will be made\n")

    supabase = get_supabase()
    storage_service = StorageService()

    total_found = 0
    total_migrated = 0
    total_failed = 0

    tables_to_process = ['video_jobs', 'edited_images', 'style_transfers']
    if table:
        if table not in tables_to_process:
            print(f"❌ Invalid table: {table}")
            print(f"   Valid options: {', '.join(tables_to_process)}")
            return
        tables_to_process = [table]

    for table_name in tables_to_process:
        if table_name == 'video_jobs':
            found, migrated, failed = await migrate_video_jobs(
                supabase, storage_service, dry_run, limit
            )
        elif table_name == 'edited_images':
            found, migrated, failed = await migrate_edited_images(
                supabase, storage_service, dry_run, limit
            )
        elif table_name == 'style_transfers':
            found, migrated, failed = await migrate_style_transfers(
                supabase, storage_service, dry_run, limit
            )

        total_found += found
        total_migrated += migrated
        total_failed += failed

    # Summary
    print("\n" + "=" * 60)
    print("📊 Migration Summary")
    print("=" * 60)
    print(f"   Total ComfyUI URLs found: {total_found}")
    print(f"   ✅ Successfully migrated: {total_migrated}")
    print(f"   ❌ Failed: {total_failed}")
    if total_found > 0 and not dry_run:
        print(f"   Success rate: {((total_found - total_failed) / total_found * 100):.1f}%")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Migrate ComfyUI URLs to Supabase Storage"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without making changes"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N records per table"
    )
    parser.add_argument(
        "--table",
        type=str,
        choices=['video_jobs', 'edited_images', 'style_transfers'],
        default=None,
        help="Only process specific table"
    )

    args = parser.parse_args()

    print("\n⚠️  WARNING: This script will download files from ComfyUI and upload to Supabase.")
    print("   Make sure the ComfyUI server is running if any URLs are still accessible.\n")

    if not args.dry_run:
        confirm = input("Continue? (y/N): ")
        if confirm.lower() != 'y':
            print("Aborted.")
            return

    asyncio.run(run_migration(
        dry_run=args.dry_run,
        limit=args.limit,
        table=args.table
    ))


if __name__ == "__main__":
    main()
