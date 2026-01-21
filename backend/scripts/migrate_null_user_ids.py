"""
Migration Script: Assign random user_id to jobs with NULL user_id

This script:
1. Fetches all existing users from auth.users
2. Assigns a random user_id to video_jobs with NULL user_id
3. Assigns a random user_id to image_jobs with NULL user_id
4. Assigns a random user_id to text_jobs with NULL user_id

Usage:
    python scripts/migrate_null_user_ids.py [--dry-run]

Options:
    --dry-run    Show what would be updated without making changes
"""

import os
import sys
import random
from datetime import datetime
from supabase import create_client, Client
from pathlib import Path

# Load environment variables from .env
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
except ImportError:
    print("⚠️  python-dotenv not installed, trying to load .env manually")
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_supabase_client() -> Client:
    """Create Supabase client with service role key (has full access)"""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise ValueError(
            "Missing required environment variables:\n"
            "- SUPABASE_URL\n"
            "- SUPABASE_SERVICE_ROLE_KEY\n"
            "Make sure these are set in your .env file"
        )

    return create_client(url, key)


def get_all_users(supabase: Client) -> list[str]:
    """Fetch all user IDs from existing jobs with user_id"""
    print("📊 Fetching all users...")

    # Query jobs tables to find existing user_ids
    # This is safer than querying auth.users directly
    video_jobs = supabase.table('video_jobs').select('user_id').not_.is_('user_id', 'null').execute()
    image_jobs = supabase.table('image_jobs').select('user_id').not_.is_('user_id', 'null').execute()

    user_ids = set()

    # Collect unique user_ids from video jobs
    for job in video_jobs.data:
        if job.get('user_id'):
            user_ids.add(job['user_id'])

    # Collect unique user_ids from image jobs
    for job in image_jobs.data:
        if job.get('user_id'):
            user_ids.add(job['user_id'])

    users = list(user_ids)

    if not users:
        print("⚠️  No users found from existing jobs")
        print("    Tip: Create at least one job with user_id first, then run this script")
        return []

    print(f"✅ Found {len(users)} unique users from existing jobs")
    return users


def migrate_video_jobs(supabase: Client, user_ids: list[str], dry_run: bool = False) -> tuple[int, int]:
    """Migrate video_jobs with NULL user_id"""
    print("\n🎬 Migrating video_jobs...")

    # Fetch all video jobs with NULL user_id
    response = supabase.table('video_jobs').select('id, workflow_name, created_at').is_('user_id', 'null').execute()

    jobs_to_migrate = response.data
    total_jobs = len(jobs_to_migrate)

    if total_jobs == 0:
        print("  ✓ No video jobs need migration")
        return 0, 0

    print(f"  Found {total_jobs} video jobs with NULL user_id")

    if dry_run:
        print("  [DRY RUN] Would assign random user_id to these jobs")
        for job in jobs_to_migrate[:5]:  # Show first 5 as sample
            random_user = random.choice(user_ids)
            print(f"    - Job {job['id'][:8]}... ({job['workflow_name']}) → User {random_user[:8]}...")
        if total_jobs > 5:
            print(f"    ... and {total_jobs - 5} more")
        return total_jobs, 0

    # Update each job with a random user_id
    updated = 0
    failed = 0

    for job in jobs_to_migrate:
        random_user = random.choice(user_ids)
        try:
            supabase.table('video_jobs').update({'user_id': random_user}).eq('id', job['id']).execute()
            updated += 1
            if updated % 10 == 0:
                print(f"  Progress: {updated}/{total_jobs} video jobs updated")
        except Exception as e:
            print(f"  ⚠️  Failed to update job {job['id']}: {e}")
            failed += 1

    print(f"  ✅ Updated {updated} video jobs")
    if failed > 0:
        print(f"  ⚠️  Failed to update {failed} video jobs")

    return updated, failed


def migrate_image_jobs(supabase: Client, user_ids: list[str], dry_run: bool = False) -> tuple[int, int]:
    """Migrate image_jobs with NULL user_id"""
    print("\n🖼️  Migrating image_jobs...")

    # Fetch all image jobs with NULL user_id
    response = supabase.table('image_jobs').select('id, workflow_name, created_at').is_('user_id', 'null').execute()

    jobs_to_migrate = response.data
    total_jobs = len(jobs_to_migrate)

    if total_jobs == 0:
        print("  ✓ No image jobs need migration")
        return 0, 0

    print(f"  Found {total_jobs} image jobs with NULL user_id")

    if dry_run:
        print("  [DRY RUN] Would assign random user_id to these jobs")
        for job in jobs_to_migrate[:5]:  # Show first 5 as sample
            random_user = random.choice(user_ids)
            print(f"    - Job {job['id'][:8]}... ({job['workflow_name']}) → User {random_user[:8]}...")
        if total_jobs > 5:
            print(f"    ... and {total_jobs - 5} more")
        return total_jobs, 0

    # Update each job with a random user_id
    updated = 0
    failed = 0

    for job in jobs_to_migrate:
        random_user = random.choice(user_ids)
        try:
            supabase.table('image_jobs').update({'user_id': random_user}).eq('id', job['id']).execute()
            updated += 1
            if updated % 10 == 0:
                print(f"  Progress: {updated}/{total_jobs} image jobs updated")
        except Exception as e:
            print(f"  ⚠️  Failed to update job {job['id']}: {e}")
            failed += 1

    print(f"  ✅ Updated {updated} image jobs")
    if failed > 0:
        print(f"  ⚠️  Failed to update {failed} image jobs")

    return updated, failed


def migrate_text_jobs(supabase: Client, user_ids: list[str], dry_run: bool = False) -> tuple[int, int]:
    """Migrate text_jobs with NULL user_id"""
    print("\n📝 Migrating text_jobs...")

    # Fetch all text jobs with NULL user_id
    response = supabase.table('text_jobs').select('id, workflow_name, created_at').is_('user_id', 'null').execute()

    jobs_to_migrate = response.data
    total_jobs = len(jobs_to_migrate)

    if total_jobs == 0:
        print("  ✓ No text jobs need migration")
        return 0, 0

    print(f"  Found {total_jobs} text jobs with NULL user_id")

    if dry_run:
        print("  [DRY RUN] Would assign random user_id to these jobs")
        for job in jobs_to_migrate[:5]:  # Show first 5 as sample
            random_user = random.choice(user_ids)
            print(f"    - Job {job['id'][:8]}... ({job['workflow_name']}) → User {random_user[:8]}...")
        if total_jobs > 5:
            print(f"    ... and {total_jobs - 5} more")
        return total_jobs, 0

    # Update each job with a random user_id
    updated = 0
    failed = 0

    for job in jobs_to_migrate:
        random_user = random.choice(user_ids)
        try:
            supabase.table('text_jobs').update({'user_id': random_user}).eq('id', job['id']).execute()
            updated += 1
            if updated % 10 == 0:
                print(f"  Progress: {updated}/{total_jobs} text jobs updated")
        except Exception as e:
            print(f"  ⚠️  Failed to update job {job['id']}: {e}")
            failed += 1

    print(f"  ✅ Updated {updated} text jobs")
    if failed > 0:
        print(f"  ⚠️  Failed to update {failed} text jobs")

    return updated, failed


def main():
    """Main migration function"""
    # Check for dry-run flag
    dry_run = '--dry-run' in sys.argv

    print("=" * 60)
    print("🔄 User ID Migration Script")
    print("=" * 60)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if dry_run:
        print("🧪 DRY RUN MODE - No changes will be made")
    else:
        print("⚠️  LIVE MODE - Changes will be written to database")

    print("=" * 60)

    try:
        # Initialize Supabase client
        supabase = get_supabase_client()

        # Get all users
        user_ids = get_all_users(supabase)

        if not user_ids:
            print("\n❌ Error: No users found in the system")
            print("   Cannot assign jobs without existing users")
            return 1

        print(f"\n🎲 Will randomly assign jobs to {len(user_ids)} users")

        # Migrate each table
        video_updated, video_failed = migrate_video_jobs(supabase, user_ids, dry_run)
        image_updated, image_failed = migrate_image_jobs(supabase, user_ids, dry_run)
        text_updated, text_failed = migrate_text_jobs(supabase, user_ids, dry_run)

        # Summary
        print("\n" + "=" * 60)
        print("📊 Migration Summary")
        print("=" * 60)

        total_updated = video_updated + image_updated + text_updated
        total_failed = video_failed + image_failed + text_failed

        print(f"Video Jobs:  {video_updated} updated, {video_failed} failed")
        print(f"Image Jobs:  {image_updated} updated, {image_failed} failed")
        print(f"Text Jobs:   {text_updated} updated, {text_failed} failed")
        print("-" * 60)
        print(f"TOTAL:       {total_updated} updated, {total_failed} failed")

        if dry_run:
            print("\n🧪 This was a DRY RUN - no changes were made")
            print("   Run without --dry-run to apply changes")
        else:
            print("\n✅ Migration completed successfully!")

        print(f"\nFinished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 60)

        return 0 if total_failed == 0 else 1

    except Exception as e:
        print(f"\n❌ Error during migration: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())
