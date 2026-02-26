import sys
import importlib
import yfinance
import os

history_path = os.path.join(os.path.dirname(yfinance.__file__), "scrapers", "history.py")
with open(history_path, "r", encoding="utf-8") as f:
    content = f.read()
    
old = "data_delay = _datetime.timedelta(minutes=30)"
new = "data_delay = _datetime.timedelta(minutes=15)"

if old in content:
    content = content.replace(old, new)
    with open(history_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("✅ data_delay has been successfully changed to 15 minutes")
elif new in content:
    print("✅ data_delay is already set to 15 minutes")
else:
    print("⚠️ Target line was not found - version might be different or change was already applied")

import yfinance.scrapers.history as yf_history
importlib.reload(yf_history)
print("✅ Library reloaded")
