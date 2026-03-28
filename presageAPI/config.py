import os
from dotenv import load_dotenv

load_dotenv()

PRESAGE_API_KEY = os.getenv("PRESAGE_API_KEY")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 5000))
BASE_API_URL = "https://api.physiology.presagetech.com"
