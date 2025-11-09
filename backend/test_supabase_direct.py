"""Test Supabase auth directly without FastAPI"""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_ANON_KEY")

print(f"Testing Supabase connection...")
print(f"URL: {supabase_url}")
print(f"Key: {supabase_key[:20]}...")

try:
    client = create_client(supabase_url, supabase_key)
    print("✅ Client created successfully")

    # Try to register a test user
    print("\nAttempting to register test user...")
    response = client.auth.sign_up({
        "email": "test123@example.com",
        "password": "Test1234!",
        "options": {
            "data": {
                "full_name": "Test User"
            }
        }
    })

    print(f"✅ Registration successful!")
    print(f"User ID: {response.user.id if response.user else 'None'}")
    print(f"Email: {response.user.email if response.user else 'None'}")

except Exception as e:
    print(f"❌ Error: {e}")
    print(f"Error type: {type(e)}")
    import traceback
    traceback.print_exc()
