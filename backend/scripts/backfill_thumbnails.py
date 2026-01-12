#!/usr/bin/env python3
"""
Backfill script to generate thumbnails for existing videos in video_jobs table.

This script:
1. Finds all completed video jobs without thumbnails
2. Generates thumbnails for each video using ThumbnailService
3. Updates the database with the thumbnail URLs

Usage:
    python scripts/backfill_thumbnails.py [--dry-run] [--limit N] [--batch-size N] [--debug]

Arguments:
    --dry-run       Print what would be done without making changes
    --limit N       Process at most N videos (default: all)
    --batch-size N  Process N videos at a time (default: 10)
    --debug         Show full URLs for debugging
"""

import os
import sys
import asyncio
import argparse
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from core.supabase import get_supabase
from services.thumbnail_service import ThumbnailService


def is_valid_public_url(url: str) -> bool:
    """Check if a URL is a valid public Supabase URL (not signed/expired)."""
    if not url:
        return False
    # Signed URLs expire and won't work - skip them
    if '/storage/v1/object/sign/' in url:
        return False
    # Public URLs are accessible
    if '/storage/v1/object/public/' in url:
        return True
    # ComfyUI URLs might still be accessible
    if 'localhost' in url or '127.0.0.1' in url or 'comfy' in url:
        return False  # Skip local URLs in backfill
    return False


async def backfill_thumbnails(dry_run: bool = False, limit: int = None, batch_size: int = 10, debug: bool = False):
    """Generate thumbnails for existing videos without thumbnails."""

    print("\n" + "=" * 60)
    print("📸 Video Thumbnail Backfill Script")
    print("=" * 60)

    if dry_run:
        print("\n⚠️  DRY RUN MODE - No changes will be made\n")

    supabase = get_supabase()
    thumbnail_service = ThumbnailService()

    # Query for videos without thumbnails
    print("🔍 Finding videos without thumbnails...")

    query = supabase.table("video_jobs")\
        .select("id, output_video_urls, thumbnail_url, comfy_job_id")\
        .eq("status", "completed")\
        .is_("thumbnail_url", "null")

    if limit:
        query = query.limit(limit)

    result = query.execute()

    videos = result.data or []

    # Filter to only videos with valid public URLs
    videos_with_output = []
    skipped_signed = 0
    skipped_local = 0
    skipped_empty = 0

    for v in videos:
        urls = v.get('output_video_urls') or []
        if not urls:
            skipped_empty += 1
            continue

        first_url = urls[0]
        if is_valid_public_url(first_url):
            videos_with_output.append(v)
        elif '/storage/v1/object/sign/' in first_url:
            skipped_signed += 1
        else:
            skipped_local += 1

    print(f"📊 Found {len(videos)} videos without thumbnails")
    print(f"📊 {len(videos_with_output)} videos have valid public URLs")
    print(f"📊 Skipped: {skipped_signed} signed (expired), {skipped_local} local/comfy, {skipped_empty} empty")

    # Debug mode: show full URLs
    if debug and videos_with_output:
        print("\n🔍 DEBUG - URLs to process:")
        for video in videos_with_output[:10]:
            url = video['output_video_urls'][0]
            print(f"   {video['id']}")
            print(f"   URL: {url}")
            print()

    if len(videos_with_output) == 0:
        print("\n✅ No videos to process!")
        return

    if dry_run:
        print("\n📋 Videos that would be processed:")
        for video in videos_with_output[:20]:  # Show first 20
            print(f"   - {video['id']}: {video['output_video_urls'][0][:60]}...")
        if len(videos_with_output) > 20:
            print(f"   ... and {len(videos_with_output) - 20} more")
        return

    # Process in batches
    processed = 0
    success = 0
    failed = 0

    print(f"\n🚀 Processing {len(videos_with_output)} videos in batches of {batch_size}...\n")

    for i in range(0, len(videos_with_output), batch_size):
        batch = videos_with_output[i:i + batch_size]
        print(f"📦 Processing batch {i // batch_size + 1} ({len(batch)} videos)...")

        for video in batch:
            video_id = video['id']
            video_url = video['output_video_urls'][0]

            print(f"   🎬 Processing {video_id}...", end=" ", flush=True)

            try:
                # Generate thumbnail
                thumb_success, thumb_url, thumb_error = await thumbnail_service.generate_thumbnail_from_url(
                    video_url,
                    video_id,
                    width=400,
                    height=400
                )

                if thumb_success and thumb_url:
                    # Update database
                    supabase.table("video_jobs")\
                        .update({"thumbnail_url": thumb_url})\
                        .eq("id", video_id)\
                        .execute()

                    print(f"✅ Done")
                    success += 1
                else:
                    print(f"❌ Failed: {thumb_error}")
                    failed += 1

            except Exception as e:
                print(f"❌ Error: {str(e)[:50]}")
                failed += 1

            processed += 1

        # Small delay between batches to avoid overwhelming the system
        if i + batch_size < len(videos_with_output):
            print(f"   ⏳ Waiting before next batch...\n")
            await asyncio.sleep(2)

    # Summary
    print("\n" + "=" * 60)
    print("📊 Backfill Summary")
    print("=" * 60)
    print(f"   Total processed: {processed}")
    print(f"   ✅ Successful: {success}")
    print(f"   ❌ Failed: {failed}")
    print(f"   Success rate: {(success / processed * 100):.1f}%")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Generate thumbnails for existing videos"
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
        help="Process at most N videos"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=10,
        help="Process N videos at a time (default: 10)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Show full URLs for debugging"
    )

    args = parser.parse_args()

    # Check for ffmpeg
    import subprocess
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            timeout=5
        )
    except FileNotFoundError:
        print("❌ Error: ffmpeg is not installed or not in PATH")
        print("   Please install ffmpeg to use this script")
        sys.exit(1)

    print("✅ ffmpeg found")

    # Run backfill
    asyncio.run(backfill_thumbnails(
        dry_run=args.dry_run,
        limit=args.limit,
        batch_size=args.batch_size,
        debug=args.debug
    ))


if __name__ == "__main__":
    main()
