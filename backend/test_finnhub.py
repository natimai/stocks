import os
import finnhub
import sys
import time
from datetime import datetime, timedelta
try:
    finnhub_client = finnhub.Client(api_key="d6gaqc9r01qt49327jagd6gaqc9r01qt49327jb0")
    end_t = int(time.time())
    start_t = int((datetime.now() - timedelta(days=30)).timestamp())
    print("Trying candles...")
    candles = finnhub_client.stock_candles("AAPL", 'D', start_t, end_t)
    print("Candles:", candles.get('s'))
except Exception as e:
    print(e)
