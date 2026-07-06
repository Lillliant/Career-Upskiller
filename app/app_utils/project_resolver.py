import os
import google.auth
import google.auth.transport.requests
import requests
from google.genai import Client
from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()

_resolved_project_id = None


def get_resolved_project_id() -> str | None:
    global _resolved_project_id
    if _resolved_project_id:
        return _resolved_project_id

    # 1. Check env vars
    proj = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if proj:
        print(f"[PROJECT RESOLVER] Using GOOGLE_CLOUD_PROJECT from env: {proj}")
        _resolved_project_id = proj
        return proj

    # 2. Try to get it from default credentials
    try:
        _, auth_proj = google.auth.default()
        if auth_proj:
            print(f"[PROJECT RESOLVER] Using project from default credentials: {auth_proj}")
            _resolved_project_id = auth_proj
            return auth_proj
    except Exception as e:
        print(f"[PROJECT RESOLVER] google.auth.default() failed: {e}")

    # 3. List projects using Resource Manager API and test each one
    try:
        print("[PROJECT RESOLVER] Attempting to list projects via Resource Manager API...")
        creds, _ = google.auth.default()
        creds.refresh(google.auth.transport.requests.Request())
        r = requests.get(
            'https://cloudresourcemanager.googleapis.com/v1/projects',
            headers={'Authorization': f'Bearer {creds.token}'},
            timeout=5
        )
        data = r.json()
        if 'error' in data:
            print(f"[PROJECT RESOLVER] Resource Manager API returned error: {data['error']}")
        projects = data.get('projects', [])
        print(f"[PROJECT RESOLVER] Found projects: {[p.get('projectId') for p in projects]}")
        for p in projects:
            p_id = p.get('projectId')
            if p_id:
                try:
                    os.environ["GOOGLE_CLOUD_PROJECT"] = p_id
                    os.environ["GOOGLE_CLOUD_QUOTA_PROJECT"] = p_id
                    client = Client(vertexai=True, location='us-east1')
                    if list(client.models.list()):
                        print(f"[PROJECT RESOLVER] Successfully resolved project ID: {p_id}")
                        _resolved_project_id = p_id
                        return p_id
                except Exception as ex:
                    print(f"[PROJECT RESOLVER] Project {p_id} model listing failed: {ex}")
                    continue
    except Exception as e:
        print(f"[PROJECT RESOLVER] Resource Manager API discovery failed: {e}")

    print("[PROJECT RESOLVER] Failed to resolve any valid project ID.")
    return None

def setup_gcp_environment():
    """Sets up the Google Cloud Project and Quota Project environment variables dynamically."""
    proj = get_resolved_project_id()
    if proj:
        os.environ["GOOGLE_CLOUD_PROJECT"] = proj
        os.environ["GOOGLE_CLOUD_QUOTA_PROJECT"] = proj
