"""Test authentication endpoints."""
import requests
import sys

BASE_URL = "http://localhost:8000/api"

def test_register():
    """Test user registration."""
    print("\n🔹 Testing registration...")
    response = requests.post(
        f"{BASE_URL}/auth/register",
        json={
            "email": "test@example.com",
            "password": "Test1234",
            "full_name": "Test User"
        }
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json() if response.status_code in [200, 201] else None


def test_login(email="test@example.com", password="Test1234"):
    """Test user login."""
    print("\n🔹 Testing login...")
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={
            "email": email,
            "password": password
        }
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json() if response.status_code == 200 else None


def test_get_current_user(token):
    """Test getting current user info."""
    print("\n🔹 Testing get current user...")
    response = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json() if response.status_code == 200 else None


def test_logout(token):
    """Test logout."""
    print("\n🔹 Testing logout...")
    response = requests.post(
        f"{BASE_URL}/auth/logout",
        headers={"Authorization": f"Bearer {token}"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")


def main():
    """Run all authentication tests."""
    print("🧪 Starting authentication tests...")
    print(f"Base URL: {BASE_URL}")

    # Test registration (might fail if user already exists)
    register_result = test_register()

    # Test login
    login_result = test_login()
    if not login_result or 'access_token' not in login_result:
        print("\n❌ Login failed. Cannot continue with tests.")
        sys.exit(1)

    token = login_result['access_token']
    print(f"\n✅ Got access token: {token[:20]}...")

    # Test get current user
    test_get_current_user(token)

    # Test logout
    test_logout(token)

    print("\n✅ All tests completed!")


if __name__ == "__main__":
    main()
