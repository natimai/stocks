from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import requests
from analysis_engine import analyze_stock_stream, get_historical_data, genai, api_key
import yfinance as yf
import json

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

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Verifies the JWT token and fetches user data from Firestore without applying any paywall limits.
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

def verify_token_and_check_limit(user_data: dict = Depends(verify_token)):
    """
    Checks if the user has reached their 1 free analysis limit.
    If they are 'isPro', bypass the limit.
    """
    is_pro = user_data.get("isPro", False)
    analysis_count = user_data.get("analysisCount", 0)

    # Apply Paywall Rule
    if not is_pro and analysis_count >= 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PAYWALL_LIMIT_REACHED"
        )
        
    return user_data

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

# ── ADMIN MIDDLEWARE ──────────────────────────────────────────────────────────
ADMIN_EMAILS = {"netanel18999@gmail.com"}  # Add more admin emails here if needed

def verify_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Only allows requests from admin-level accounts."""
    try:
        token = credentials.credentials
        decoded = auth.verify_id_token(token)
        email = decoded.get('email', '')
        if email not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required.")
        return decoded
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token.")

@app.get("/api/admin/users")
def list_users(admin=Depends(verify_admin)):
    """Returns all registered users from Firestore."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    users = []
    for doc in db.collection('users').stream():
        d = doc.to_dict()
        d['uid'] = doc.id
        # Convert Firestore timestamp to ISO string if present
        if 'createdAt' in d and hasattr(d['createdAt'], 'isoformat'):
            d['createdAt'] = d['createdAt'].isoformat()
        users.append(d)
    return users

class AdminUserUpdate(BaseModel):
    isPro: bool

@app.patch("/api/admin/users/{uid}")
def update_user(uid: str, body: AdminUserUpdate, admin=Depends(verify_admin)):
    """Toggle a user's Pro status."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    user_ref = db.collection('users').document(uid)
    if not user_ref.get().exists:
        raise HTTPException(status_code=404, detail="User not found.")
    user_ref.update({'isPro': body.isPro})
    return {"success": True, "uid": uid, "isPro": body.isPro}

@app.get("/api/user-profile")
def get_user_profile(user_data: dict = Depends(verify_token)):
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
            "customPicks": d.get('customPicks', ["NVDA", "AAPL", "META", "TSLA", "MSFT"])
        }
    return {
        "uid": user_data['uid'], 
        "isPro": False, 
        "analysisCount": 0, 
        "autoAnalysis": False,
        "customPicks": ["NVDA", "AAPL", "META", "TSLA", "MSFT"]
    }

class UserSettings(BaseModel):
    autoAnalysis: Optional[bool] = None
    customPicks: Optional[list[str]] = None

@app.patch("/api/user-settings")
def update_user_settings(settings: UserSettings, user_data: dict = Depends(verify_token_and_check_limit)):
    """Allows Pro users to update their profile settings (e.g., autoAnalysis, custom picks)."""
    user_ref = user_data['user_ref']
    updates = {}
    
    if settings.autoAnalysis is not None:
        if user_data.get('isPro'):
            updates['autoAnalysis'] = settings.autoAnalysis
        else:
            raise HTTPException(status_code=403, detail="Auto-analysis is a Pro feature.")
            
    if settings.customPicks is not None:
        if user_data.get('isPro'):
            # Validate they are strings and limit to 5
            picks = [str(p).upper().strip() for p in settings.customPicks][:5]
            updates['customPicks'] = picks
        else:
            raise HTTPException(status_code=403, detail="Custom top picks is a Pro feature.")

    if updates:
        user_ref.update(updates)
    return {"success": True}

@app.get("/api/analyze/{ticker}")
async def get_stock_analysis(ticker: str, date: str = Query(None), user_data: dict = Depends(verify_token_and_check_limit)):
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

    return StreamingResponse(analyze_stock_stream(ticker, date), media_type="text/event-stream")

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

class ChatAgentRequest(BaseModel):
    ticker: str
    user_message: str
    target_agent: str
    context_score: Optional[int] = None

@app.post("/api/chat_agent")
async def chat_agent(request: ChatAgentRequest, user_data: dict = Depends(verify_token_and_check_limit)):
    """
    User endpoint to chat with a specific AI agent using persona and context.
    """
    from analysis_engine import chat_with_agent
    try:
        response_text = await chat_with_agent(
            request.ticker,
            request.user_message,
            request.target_agent,
            request.context_score
        )
        return {"response": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

class PortfolioItem(BaseModel):
    ticker: str
    shares: float
    average_cost: float

class DoctorChatRequest(BaseModel):
    messages: list

@app.post("/api/portfolio-doctor/chat")
async def portfolio_doctor_chat(request: DoctorChatRequest, user_data: dict = Depends(verify_token)):
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set.")
        
    uid = user_data["uid"]
    user_ref = db.collection('users').document(uid)
    doc = user_ref.get()
    user_profile = doc.to_dict() if doc.exists else {}
    
    profile_for_prompt = {
        "Age": user_profile.get("age"),
        "Investment_Horizon": user_profile.get("investment_horizon"),
        "Risk_Tolerance": user_profile.get("risk_tolerance"),
        "Primary_Financial_Goal": user_profile.get("target_goal")
    }
    
    # We define the tool definition manually for the Gemini API
    update_user_profile_tool = {
        "function_declarations": [
            {
                "name": "update_user_profile",
                "description": "Updates the user's financial profile in the database.",
                "parameters": {
                    "type_": "OBJECT",
                    "properties": {
                        "key": {
                            "type_": "STRING",
                            "description": "The profile key to update (Age, Investment_Horizon, Risk_Tolerance, Primary_Financial_Goal)"
                        },
                        "value": {
                            "type_": "STRING",
                            "description": "The value to save for the profile key."
                        }
                    },
                    "required": ["key", "value"]
                }
            }
        ]
    }
    
    holdings = []
    for h_doc in user_ref.collection('portfolio').stream():
        d = h_doc.to_dict()
        if 'createdAt' in d and hasattr(d['createdAt'], 'isoformat'):
            d['createdAt'] = d['createdAt'].isoformat()
        holdings.append(d)

    system_prompt = f"""Role:
You are the "Chief Portfolio Doctor" for Consensus, an elite AI Wealth Management platform. Your ultimate goal is to ensure the user's stock portfolio perfectly aligns with their personal financial goals (Goal Alignment).

Your Instructions & Protocol:
You operate in a strict loop. Before providing any financial analysis, you MUST verify that you have a complete understanding of the user's financial profile.

Step 1: The Profile Check
Look at the injected User_Profile JSON context. To provide an accurate portfolio diagnosis, you require the following 4 data points:
- Age
- Investment Horizon (e.g., short-term, 5 years, retirement)
- Risk Tolerance (e.g., conservative, moderate, aggressive)
- Primary Financial Goal (e.g., buying a house, passive income, capital preservation)

User_Profile:
{json.dumps(profile_for_prompt, indent=2)}

Current_Holdings:
{json.dumps(holdings, indent=2)}

Step 2: Information Gathering (If data is missing)
If ANY of the 4 data points are missing or null in User_Profile, DO NOT analyze the portfolio yet. Instead, act conversationally and ask the user a polite, engaging question to gather the missing information. Ask one question at a time.

Step 3: Updating Memory (Tool Calling)
If the user's message contains the answer to a missing profile data point, you MUST immediately execute the `update_user_profile` tool to permanently save this information to the database.

Step 4: Portfolio Diagnosis (Once profile is complete)
Only when all 4 profile criteria are known, proceed to analyze the user's Current_Holdings.
Use Financial Chain-of-Thought (FinCoT) reasoning to evaluate the portfolio against their profile:
- Does an aggressive tech-heavy portfolio make sense for a 65-year-old wanting capital preservation? (Flag as high risk).
- Is a highly diversified, low-beta portfolio appropriate for a 25-year-old seeking aggressive growth? (Flag as too conservative).

Output Style:
Speak directly to the user. Be professional, slightly witty, and highly analytical. Avoid long essays; use bullet points and clear actionable advice.
"""

    async def chat_stream():
        try:
            # Reconstruct history for Gemini API natively
            gemini_history = []
            for m in request.messages[:-1]:
                gemini_history.append({"role": "user" if m["role"] == "user" else "model", "parts": [m["parts"][0]]})
                
            model = genai.GenerativeModel("gemini-3-pro-preview", tools=[update_user_profile_tool], system_instruction=system_prompt)
            chat = model.start_chat(history=gemini_history)
            
            last_msg = request.messages[-1]["parts"][0]
            response = await chat.send_message_async(last_msg, stream=True)
            
            tool_calls_to_make = []
            
            # Step 1: Fully resolve the initial stream and collect any tool calls
            async for chunk in response:
                for part in chunk.parts:
                    if part.function_call:
                        tool_calls_to_make.append(part.function_call)
                    elif part.text:
                        yield "data: " + json.dumps({"type": "text", "text": part.text}) + "\n\n"
                        
            # Critical Fix: we must explicitly resolve the generator before continuing the chat loop
            await response.resolve()
                        
            # Step 2: If the model invoked a tool, execute it and send the result back
            if tool_calls_to_make:
                for fc in tool_calls_to_make:
                    if fc.name == "update_user_profile":
                        key = fc.args.get("key", "")
                        val = fc.args.get("value", "")
                        
                        db_key_map = {
                            "Age": "age",
                            "Investment_Horizon": "investment_horizon",
                            "Risk_Tolerance": "risk_tolerance",
                            "Primary_Financial_Goal": "target_goal"
                        }
                        db_key = db_key_map.get(key, key.lower())
                        user_ref.set({db_key: val}, merge=True)
                        
                        yield "data: " + json.dumps({"type": "tool_call", "message": "System: User profile updated in memory."}) + "\n\n"
                        
                        # Send function response back
                        tool_response_part = genai.protos.Part(
                            function_response=genai.protos.FunctionResponse(
                                name="update_user_profile",
                                response={"result": "success"}
                            )
                        )
                        follow_up = await chat.send_message_async(tool_response_part, stream=True)
                        async for fu_chunk in follow_up:
                            if fu_chunk.text:
                                yield "data: " + json.dumps({"type": "text", "text": fu_chunk.text}) + "\n\n"
            
            yield "data: " + json.dumps({"type": "done"}) + "\n\n"
        except Exception as e:
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"

    return StreamingResponse(chat_stream(), media_type="text/event-stream")

@app.get("/api/portfolio")
def get_portfolio(user_data: dict = Depends(verify_token)):
    """Fetches all holdings for the user."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    uid = user_data["uid"]
    holdings = []
    try:
        docs = db.collection('users').document(uid).collection('portfolio').stream()
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            if 'createdAt' in d and hasattr(d['createdAt'], 'isoformat'):
                d['createdAt'] = d['createdAt'].isoformat()
            holdings.append(d)
        return holdings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/portfolio")
def add_portfolio_item(item: PortfolioItem, user_data: dict = Depends(verify_token)):
    """Inserts a new holding into the database."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    uid = user_data["uid"]
    if not item.ticker or item.shares <= 0 or item.average_cost < 0:
        raise HTTPException(status_code=400, detail="Invalid portfolio data")
        
    try:
        portfolio_ref = db.collection('users').document(uid).collection('portfolio')
        doc_ref = portfolio_ref.document()
        new_item = {
            'ticker': item.ticker.upper(),
            'shares': float(item.shares),
            'average_cost': float(item.average_cost),
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        doc_ref.set(new_item)
        
        # SERVER_TIMESTAMP isn't JSON serializable directly when returning quickly,
        # so we return the constructed dict cleanly
        return_item = {
            'id': doc_ref.id,
            'ticker': new_item['ticker'],
            'shares': new_item['shares'],
            'average_cost': new_item['average_cost']
        }
        return return_item
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/portfolio/{item_id}")
def update_portfolio_item(item_id: str, item: PortfolioItem, user_data: dict = Depends(verify_token)):
    """Updates an existing holding in the database."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    uid = user_data["uid"]
    if item.shares < 0 or item.average_cost < 0:
        raise HTTPException(status_code=400, detail="Invalid portfolio data")

    try:
        doc_ref = db.collection('users').document(uid).collection('portfolio').document(item_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Portfolio item not found")
            
        update_data = {
            'shares': float(item.shares),
            'average_cost': float(item.average_cost)
        }
        doc_ref.update(update_data)
        
        return_item = doc_ref.get().to_dict()
        return_item['id'] = item_id
        if 'createdAt' in return_item and hasattr(return_item['createdAt'], 'isoformat'):
            return_item['createdAt'] = return_item['createdAt'].isoformat()
            
        return return_item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/portfolio/{item_id}")
def delete_portfolio_item(item_id: str, user_data: dict = Depends(verify_token)):
    """Removes a holding from the database."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    uid = user_data["uid"]
    try:
        doc_ref = db.collection('users').document(uid).collection('portfolio').document(item_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Portfolio item not found")
            
        doc_ref.delete()
        return {"success": True, "id": item_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
            change_pct = change_pct * 100
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
                
        def safe_get(key, default=None):
            val = info.get(key)
            return default if pd.isna(val) else val

        # Attempt to read REAL AI Score from cache
        score = None
        recommendation = None
        CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
        cache_file = os.path.join(CACHE_DIR, f"{ticker.upper()}.json")
        if os.path.exists(cache_file):
            try:
                import json
                with open(cache_file, "r") as f:
                    cdata = json.load(f)
                    score = cdata.get("score")
                    recommendation = cdata.get("recommendation")
            except:
                pass

        return {
            "ticker": ticker.upper(),
            "name": info.get("shortName", info.get("longName", ticker)),
            "price": current_price,
            "changePercent": change_pct,
            "score": score,
            "recommendation": recommendation,
            "market_cap": safe_get("marketCap", 0),
            "metrics": {
                "pe_ratio": safe_get("trailingPE"),
                "beta": safe_get("beta")
            },
            "chartData": [{"date": idx.strftime("%m/%d"), "open": round(row['Open'], 2), "high": round(row['High'], 2), "low": round(row['Low'], 2), "close": round(row['Close'], 2), "volume": int(row['Volume']) if 'Volume' in row else 0} for idx, row in hist.iterrows()]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Start the application using Uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
