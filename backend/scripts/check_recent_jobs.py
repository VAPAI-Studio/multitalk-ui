"""
Diagnostic Script: Check recent jobs and their user_id status

This script displays the last 10 jobs created and shows if they have user_id set.
"""

import os
import sys
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
    """Create Supabase client with service role key (or anon key as fallback)"""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if not url or not key:
        raise ValueError("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)")

    return create_client(url, key)


def check_recent_jobs():
    """Check recent jobs and their user_id status"""
    print("=" * 70)
    print("🔍 Recent Jobs Diagnostic")
    print("=" * 70)
    print()

    try:
        supabase = get_supabase_client()

        # Get recent video jobs
        print("📹 RECENT VIDEO JOBS (last 10):")
        print("-" * 70)
        video_jobs = supabase.table('video_jobs')\
            .select('id, user_id, workflow_name, created_at')\
            .order('created_at', desc=True)\
            .limit(10)\
            .execute()

        if video_jobs.data:
            for job in video_jobs.data:
                user_status = "✅ HAS USER_ID" if job['user_id'] else "❌ NULL"
                created = job['created_at'][:19] if job['created_at'] else 'Unknown'
                print(f"  {user_status} | {job['workflow_name']:20} | {created} | {job['id'][:8]}...")
        else:
            print("  No video jobs found")

        print()

        # Get recent image jobs
        print("🖼️  RECENT IMAGE JOBS (last 10):")
        print("-" * 70)
        image_jobs = supabase.table('image_jobs')\
            .select('id, user_id, workflow_name, created_at')\
            .order('created_at', desc=True)\
            .limit(10)\
            .execute()

        if image_jobs.data:
            for job in image_jobs.data:
                user_status = "✅ HAS USER_ID" if job['user_id'] else "❌ NULL"
                created = job['created_at'][:19] if job['created_at'] else 'Unknown'
                print(f"  {user_status} | {job['workflow_name']:20} | {created} | {job['id'][:8]}...")
        else:
            print("  No image jobs found")

        print()

        # Statistics
        print("=" * 70)
        print("📊 STATISTICS:")
        print("-" * 70)

        # Count video jobs with/without user_id
        video_with_user = supabase.table('video_jobs')\
            .select('id', count='exact')\
            .not_.is_('user_id', 'null')\
            .execute()
        video_without_user = supabase.table('video_jobs')\
            .select('id', count='exact')\
            .is_('user_id', 'null')\
            .execute()

        print(f"Video Jobs WITH user_id:    {video_with_user.count or 0}")
        print(f"Video Jobs WITHOUT user_id:  {video_without_user.count or 0}")

        # Count image jobs with/without user_id
        image_with_user = supabase.table('image_jobs')\
            .select('id', count='exact')\
            .not_.is_('user_id', 'null')\
            .execute()
        image_without_user = supabase.table('image_jobs')\
            .select('id', count='exact')\
            .is_('user_id', 'null')\
            .execute()

        print(f"Image Jobs WITH user_id:     {image_with_user.count or 0}")
        print(f"Image Jobs WITHOUT user_id:  {image_without_user.count or 0}")

        print()

        # Show unique users
        print("👥 UNIQUE USERS WITH JOBS:")
        print("-" * 70)

        # Get unique users from video jobs
        video_users_response = supabase.table('video_jobs')\
            .select('user_id')\
            .not_.is_('user_id', 'null')\
            .execute()

        image_users_response = supabase.table('image_jobs')\
            .select('user_id')\
            .not_.is_('user_id', 'null')\
            .execute()

        all_users = set()
        for job in video_users_response.data:
            if job['user_id']:
                all_users.add(job['user_id'])
        for job in image_users_response.data:
            if job['user_id']:
                all_users.add(job['user_id'])

        if all_users:
            print(f"  Total unique users: {len(all_users)}")
            for i, user_id in enumerate(list(all_users)[:5], 1):
                print(f"    {i}. {user_id[:8]}...")
            if len(all_users) > 5:
                print(f"    ... and {len(all_users) - 5} more")
        else:
            print("  ⚠️  No users found with jobs")
            print("  This means all jobs have NULL user_id")

        print()
        print("=" * 70)

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit(check_recent_jobs())
