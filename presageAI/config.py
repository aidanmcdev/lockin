import os
from dotenv import load_dotenv

load_dotenv()

PRESAGE_API_KEY = os.getenv("PRESAGE_API_KEY", "")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 5000))

# Path to the SmartSpectra C++ binary
SMARTSPECTRA_BIN = os.getenv(
    "SMARTSPECTRA_BIN",
    os.path.join(os.path.dirname(__file__), "smartspectra", "build", "extract_vitals"),
)
