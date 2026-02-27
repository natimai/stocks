from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import requests
from analysis_engine import analyze_stock_stream, get_historical_data
import yfinance as yf

import firebase_admin
from firebase_admin import credentials, auth, firestore

# Initialize Firebase Admin
# On Cloud Run, ADC is used automatically.
# Locally, falls back to firebase-credentials.json.
import os

try:
    if os.path.exists("firebase-credentials.json"):
        cred = credentials.Certificate("firebase-credentials.json")
        firebase_admin.initialize_app(cred)
    else:
        firebase_admin.initialize_app()  # Uses ADC on Cloud Run
    db = firestore.client()
    print("Firebase Admin SDK initialized successfully.")
except Exception as e:
    print(f"Warning: Could not initialize Firebase Admin SDK. {e}")
    db = None

security = HTTPBearer()

def verify_token_and_check_limit(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Verifies the JWT token and checks if the user has reached their 1 free analysis limit.
    If they are 'isPro', bypass the limit.
    """
    try:
        token = credentials.credentials
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        email = decoded_token.get('email', '')
        name = decoded_token.get('name', 'User')

        # Check user in Firestore
        user_ref = db.collection('users').document(uid)
        user_doc = user_ref.get()

        if user_doc.exists:
            user_data = user_doc.to_dict()
            is_pro = user_data.get('isPro', False)
            analysis_count = user_data.get('analysisCount', 0)
        else:
            # First time user
            is_pro = False
            analysis_count = 0
            user_ref.set({
                'uid': uid,
                'email': email,
                'name': name,
                'isPro': is_pro,
                'analysisCount': analysis_count,
                'createdAt': firestore.SERVER_TIMESTAMP
            })

        # Apply Paywall Rule
        if not is_pro and analysis_count >= 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="PAYWALL_LIMIT_REACHED"
            )
            
        return {"uid": uid, "user_ref": user_ref, "isPro": is_pro, "analysisCount": analysis_count}

    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Expired auth token")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Auth error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Authentication failed")

# Initialize FastAPI app
app = FastAPI(
    title="US Stock Analysis API",
    description="Backend for the SaaS fintech dashboard",
    version="1.0.0"
)

# Configure CORS to allow our Next.js frontend to communicate with the FastAPI backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your frontend domains (e.g., ["https://your-frontend.vercel.app"])
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to the SaaS Stock Analysis API. Use /api/analyze/{ticker} to get real-time scores."}

@app.get("/api/user-profile")
def get_user_profile(user_data: dict = Depends(verify_token_and_check_limit)):
    """Returns the current user's profile (isPro, analysisCount, autoAnalysis)."""
    user_ref = user_data['user_ref']
    doc = user_ref.get()
    if doc.exists:
        d = doc.to_dict()
        return {
            "uid": user_data['uid'],
            "isPro": d.get('isPro', False),
            "analysisCount": d.get('analysisCount', 0),
            "autoAnalysis": d.get('autoAnalysis', False),
        }
    return {"uid": user_data['uid'], "isPro": False, "analysisCount": 0, "autoAnalysis": False}

from pydantic import BaseModel

class UserSettings(BaseModel):
    autoAnalysis: bool | None = None

@app.patch("/api/user-settings")
def update_user_settings(settings: UserSettings, user_data: dict = Depends(verify_token_and_check_limit)):
    """Allows Pro users to update their profile settings (e.g., autoAnalysis)."""
    user_ref = user_data['user_ref']
    updates = {}
    # Only Pro users can set autoAnalysis
    if settings.autoAnalysis is not None:
        if user_data.get('isPro'):
            updates['autoAnalysis'] = settings.autoAnalysis
        else:
            raise HTTPException(status_code=403, detail="Auto-analysis is a Pro feature.")
    if updates:
        user_ref.update(updates)
    return {"success": True}

@app.get("/api/analyze/{ticker}")
async def get_stock_analysis(ticker: str, user_data: dict = Depends(verify_token_and_check_limit)):
    """
    Endpoint to retrieve complete AI-driven stock analysis for a given ticker,
    streamed sequentially (Bull -> Bear -> Quant -> CIO).
    Requires Authentication.
    """
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker symbol provided.")
        
    # Increment usage count if not Pro
    if not user_data['isPro']:
        user_data['user_ref'].update({
            'analysisCount': firestore.Increment(1)
        })

    return StreamingResponse(analyze_stock_stream(ticker), media_type="text/event-stream")

@app.get("/api/chart/{ticker}")
def get_chart(ticker: str, period: str = Query("1mo"), interval: str = Query("1d")):
    """
    Endpoint to fetch dynamic OHLC chart over requested timeframe.
    """
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker symbol provided.")
        
    result = get_historical_data(ticker, period, interval)
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.get("/api/search")
def search_tickers(q: str = Query(..., min_length=1)):
    """
    Auto-suggest endpoint for the Command Palette UI.
    Uses Yahoo Finance API search endpoint.
    """
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=5&newsCount=0"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers)
        data = response.json()
        
        results = []
        if 'quotes' in data:
            for quote in data['quotes']:
                if 'symbol' in quote and 'shortname' in quote:
                    results.append({
                        "symbol": quote['symbol'],
                        "name": quote['shortname'],
                        "exchange": quote.get('exchange', 'N/A')
                    })
        return results
    except Exception as e:
        return []

if __name__ == "__main__":
    # Start the application using Uvicorn
    # Make sure analysis_engine.py is in the same directory or Python path!
    # Run server via: python app.py
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
@app.get("/api/quick-stats/{ticker}")
def get_quick_stats(ticker: str):
    import pandas as pd
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        hist = stock.history(period="1mo")
        current_price = info.get("currentPrice", 0)
        if not current_price and not hist.empty:
            current_price = hist['Close'].iloc[-1]
            
        change_pct = info.get("regularMarketChangePercent", None)
        if change_pct is not None:
            # yfinance returns regularMarketChangePercent as a decimal (e.g. 0.012 = 1.2%)
            # Multiply by 100 to get a proper percentage value
            change_pct = change_pct * 100
            # Sanity check: if result is unreasonably large, recalculate from price history
            if abs(change_pct) > 25:
                if len(hist) > 1:
                    prev_close = hist['Close'].iloc[-2]
                    change_pct = ((current_price - prev_close) / prev_close) * 100
                else:
                    change_pct = 0.0
        else:
            if len(hist) > 1:
                prev_close = hist['Close'].iloc[-2]
                change_pct = ((current_price - prev_close) / prev_close) * 100
            else:
                change_pct = 0.0
                
        # Optional safe get for metrics
        def safe_get(key, default=None):
            val = info.get(key)
            return default if pd.isna(val) else val

        return {
            "ticker": ticker.upper(),
            "name": info.get("shortName", info.get("longName", ticker)),
            "price": current_price,
            "changePercent": change_pct,
            "market_cap": safe_get("marketCap", 0),
            "metrics": {
                "pe_ratio": safe_get("trailingPE"),
                "beta": safe_get("beta")
            },
            "chartData": [{"date": idx.strftime("%m/%d"), "open": round(row['Open'], 2), "high": round(row['High'], 2), "low": round(row['Low'], 2), "close": round(row['Close'], 2), "volume": int(row['Volume']) if 'Volume' in row else 0} for idx, row in hist.iterrows()]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
