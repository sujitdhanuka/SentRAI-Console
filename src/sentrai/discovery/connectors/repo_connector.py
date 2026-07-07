import httpx
import tempfile
import zipfile
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class RemoteRepoConnector:
    @staticmethod
    def download_github_repo(owner: str, repo: str, branch: str = "main", token: str = None) -> Path:
        """
        Downloads a GitHub repository as a ZIP archive and extracts it to a temporary directory.
        Returns the path to the extracted directory.
        """
        headers = {}
        if token:
            headers["Authorization"] = f"token {token}"
            
        url = f"https://api.github.com/repos/{owner}/{repo}/zipball/{branch}"
        logger.info(f"Downloading GitHub repository: {url}")
        
        with httpx.Client(follow_redirects=True) as client:
            response = client.get(url, headers=headers)
            if response.status_code != 200:
                raise ValueError(f"Failed to download repository: {response.status_code} - {response.text}")
                
        temp_dir = tempfile.mkdtemp(prefix="sentrai_scan_")
        zip_path = Path(temp_dir) / "repo.zip"
        with open(zip_path, "wb") as f:
            f.write(response.content)
            
        extract_path = Path(temp_dir) / "extracted"
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_path)
            
        subdirs = [x for x in extract_path.iterdir() if x.is_dir()]
        return subdirs[0] if subdirs else extract_path

    @staticmethod
    def download_gitlab_repo(project_id: str, branch: str = "main", token: str = None, host: str = "gitlab.com") -> Path:
        """
        Downloads a GitLab repository as a ZIP archive and extracts it to a temporary directory.
        """
        headers = {}
        if token:
            headers["PRIVATE-TOKEN"] = token
            
        url = f"https://{host}/api/v4/projects/{project_id}/repository/archive.zip?sha={branch}"
        logger.info(f"Downloading GitLab repository: {url}")
        
        with httpx.Client(follow_redirects=True) as client:
            response = client.get(url, headers=headers)
            if response.status_code != 200:
                raise ValueError(f"Failed to download repository: {response.status_code} - {response.text}")
                
        temp_dir = tempfile.mkdtemp(prefix="sentrai_scan_")
        zip_path = Path(temp_dir) / "repo.zip"
        with open(zip_path, "wb") as f:
            f.write(response.content)
            
        extract_path = Path(temp_dir) / "extracted"
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_path)
            
        subdirs = [x for x in extract_path.iterdir() if x.is_dir()]
        return subdirs[0] if subdirs else extract_path
