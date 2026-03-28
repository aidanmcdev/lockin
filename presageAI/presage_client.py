import logging
import time
import requests
from config import PRESAGE_API_KEY, BASE_API_URL

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s [PresageAPI] %(message)s",
    level=logging.INFO,
    datefmt="%Y-%m-%d %H:%M:%S",
)


class PresageClient:
    """Wrapper around the Presage Physiology API."""

    def __init__(self, api_key=None):
        self.api_key = api_key or PRESAGE_API_KEY
        if not self.api_key:
            raise ValueError("PRESAGE_API_KEY is required. Set it in .env or pass it directly.")
        self.base_url = BASE_API_URL
        self.headers = {"x-api-key": self.api_key}

    def upload_and_process(self, preprocessed_data: bytes, process_type: str = "all") -> str:
        """Upload preprocessed trace data and queue for processing.

        Args:
            preprocessed_data: Gzipped JSON bytes of the preprocessed trace.
            process_type: 'all' for all vitals, 'hr_br' for heart rate + breathing only.

        Returns:
            The video/upload ID for retrieving results.
        """
        import sys
        max_size = 5 * 1024 * 1024

        # Get upload URLs
        resp = requests.post(
            f"{self.base_url}/v1/upload-url",
            headers=self.headers,
            json={
                "file_size": sys.getsizeof(preprocessed_data),
                process_type: {"to_process": True},
            },
        )
        if resp.status_code == 401:
            raise PermissionError("Unauthorized - check your API key.")
        resp.raise_for_status()

        data = resp.json()
        vid_id = data["id"]
        urls = data["urls"]
        upload_id = data["upload_id"]

        # Multipart upload
        parts = []
        tracker = 0
        total_len = len(preprocessed_data)
        for num, url in enumerate(urls):
            part = num + 1
            end = min(tracker + max_size, total_len)
            chunk = preprocessed_data[tracker:end]
            put_resp = requests.put(url, data=chunk)
            put_resp.raise_for_status()
            etag = put_resp.headers["ETag"]
            parts.append({"ETag": etag, "PartNumber": part})
            tracker += max_size

        # Complete upload
        requests.post(
            f"{self.base_url}/v1/complete",
            headers=self.headers,
            json={"id": vid_id, "upload_id": upload_id, "parts": parts},
        )
        logging.info(f"Upload complete. ID: {vid_id}")
        return vid_id

    def retrieve_result(self, vid_id: str, timeout: int = 300, reshape: bool = False) -> dict:
        """Poll the API until results are ready.

        Args:
            vid_id: The upload ID returned from upload_and_process.
            timeout: Max seconds to wait.
            reshape: Whether to reshape data for plotting.

        Returns:
            Dict of vitals data from the API.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            resp = requests.post(
                f"{self.base_url}/retrieve-data",
                headers=self.headers,
                json={"id": vid_id, "reshape": reshape},
            )
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 401:
                raise PermissionError("Unauthorized - check your API key.")
            time.sleep(2)

        raise TimeoutError(f"Results not ready after {timeout}s for ID: {vid_id}")

    def process_and_get_results(self, preprocessed_data: bytes, process_type: str = "all", timeout: int = 300) -> dict:
        """Upload preprocessed data and wait for results.

        Returns:
            Dict with all vitals data.
        """
        vid_id = self.upload_and_process(preprocessed_data, process_type)
        logging.info(f"Processing... polling for results (timeout: {timeout}s)")
        return self.retrieve_result(vid_id, timeout=timeout)
