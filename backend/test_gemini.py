import json
from analysis_engine import analyze_stock

if __name__ == "__main__":
    print("Fetching and analyzing AAPL data using Gemini API...")
    result = analyze_stock("AAPL")
    print(json.dumps(result, indent=2))
