import os
import json
import asyncio
import time
from typing import AsyncGenerator
from datetime import datetime, timedelta

import yfinance as yf
import pandas as pd
import numpy as np
from dotenv import load_dotenv
import google.generativeai as genai

# ─── Setup ────────────────────────────────────────────────────────────────────
load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Setup Caching
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)
CACHE_TTL_SECONDS = 4 * 3600  # 4 hours

MODEL_NAME = "gemini-3-pro-preview"
GEN_CFG = genai.types.GenerationConfig(temperature=0.0)
GEN_CFG_JSON = genai.types.GenerationConfig(temperature=0.0, response_mime_type="application/json")


def _safe_number(value, default=None):
    try:
        if value is None:
            return default
        parsed = float(value)
        if np.isnan(parsed):
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def _clamp_score(value, default=50):
    parsed = _safe_number(value, default)
    if parsed is None:
        return default
    return int(max(0, min(100, round(parsed))))


def _completeness_ratio(values):
    if not values:
        return 0.0
    valid = sum(1 for value in values if _safe_number(value) is not None)
    return valid / len(values)


def _bucket_market_cap(market_cap):
    cap = _safe_number(market_cap, 0) or 0
    if cap >= 200_000_000_000:
        return "mega_cap"
    if cap >= 10_000_000_000:
        return "large_cap"
    if cap >= 2_000_000_000:
        return "mid_cap"
    return "small_cap"


def _classify_score(score):
    if score >= 85:
        return "STRONG BUY"
    if score >= 70:
        return "BUY"
    if score >= 45:
        return "HOLD"
    if score >= 25:
        return "SELL"
    return "STRONG SELL"


def _fundamental_signal(fundamentals):
    score = 50.0
    pe = _safe_number(fundamentals.get("P_E_Ratio"))
    sector_pe = _safe_number(fundamentals.get("Sector_P_E_Median"), 25.0)
    peg = _safe_number(fundamentals.get("PEG_Ratio"))
    roe = _safe_number(fundamentals.get("ROE_pct"))
    debt = _safe_number(fundamentals.get("Debt_to_Equity"))
    fcf_yield = _safe_number(fundamentals.get("Free_Cash_Flow_Yield_pct"))
    eps_growth = _safe_number(fundamentals.get("5Y_EPS_Growth_Rate_pct"))

    if pe is not None and sector_pe:
        premium_pct = ((pe - sector_pe) / sector_pe) * 100
        if premium_pct <= -15:
            score += 10
        elif premium_pct <= 10:
            score += 3
        elif premium_pct >= 50:
            score -= 12
        elif premium_pct >= 25:
            score -= 7

    if peg is not None:
        if peg <= 1.2:
            score += 10
        elif peg <= 2.0:
            score += 4
        elif peg >= 3.0:
            score -= 8

    if roe is not None:
        if roe >= 20:
            score += 12
        elif roe >= 12:
            score += 6
        elif roe < 5:
            score -= 8

    if debt is not None:
        if debt <= 0.8:
            score += 8
        elif debt <= 1.5:
            score += 2
        elif debt >= 2.5:
            score -= 10

    if fcf_yield is not None:
        if fcf_yield >= 5:
            score += 10
        elif fcf_yield >= 2:
            score += 4
        elif fcf_yield < 0:
            score -= 10

    if eps_growth is not None:
        if eps_growth >= 20:
            score += 12
        elif eps_growth >= 8:
            score += 5
        elif eps_growth < 0:
            score -= 12

    return _clamp_score(score)


def _technical_signal(technicals):
    score = 50.0
    current_price = _safe_number(technicals.get("Current_Price"))
    sma50 = _safe_number(technicals.get("SMA_50"))
    sma200 = _safe_number(technicals.get("SMA_200"))
    rsi = _safe_number(technicals.get("RSI_14"))
    williams_r = _safe_number(technicals.get("Williams_R"))
    macd_signal = str(technicals.get("MACD_Signal") or "").lower()
    volume_momentum = str(technicals.get("Volume_Momentum") or "").lower()

    if current_price is not None and sma50 is not None:
        score += 8 if current_price > sma50 else -8
    if current_price is not None and sma200 is not None:
        score += 10 if current_price > sma200 else -10
    if sma50 is not None and sma200 is not None:
        score += 6 if sma50 > sma200 else -6

    if rsi is not None:
        if 45 <= rsi <= 65:
            score += 8
        elif 35 <= rsi < 45 or 65 < rsi <= 75:
            score += 2
        else:
            score -= 8

    if williams_r is not None:
        if -80 <= williams_r <= -20:
            score += 4
        else:
            score -= 4

    if "bullish" in macd_signal:
        score += 8
    elif "bearish" in macd_signal:
        score -= 8

    if "expanding" in volume_momentum:
        score += 4
    elif "contracting" in volume_momentum:
        score -= 4

    return _clamp_score(score)


def _sentiment_signal(sentiment):
    score = 50.0
    news_score = _safe_number(sentiment.get("FinBERT_News_Score_Approx"))
    headline_count = len(sentiment.get("Recent_Headlines") or [])
    social = str(sentiment.get("Overnight_Social_Sentiment") or "").lower()

    if news_score is not None:
        score += (news_score - 0.5) * 40
    if headline_count >= 4:
        score += 6
    elif headline_count == 0:
        score -= 6

    if "positive" in social or "bull" in social:
        score += 6
    elif "negative" in social or "bear" in social:
        score -= 6

    return _clamp_score(score)


def _macro_signal(macro_risk, market_cap_bucket):
    score = 50.0
    vix = _safe_number(macro_risk.get("VIX_Level"))
    beta = _safe_number(macro_risk.get("Stock_Beta"))
    pe_premium = _safe_number((macro_risk.get("Valuation_vs_Sector") or {}).get("P_E_Premium_pct"))

    if vix is not None:
        if vix <= 16:
            score += 10
        elif vix <= 22:
            score += 2
        elif vix >= 30:
            score -= 14
        else:
            score -= 6

    if beta is not None:
        if market_cap_bucket in {"mega_cap", "large_cap"}:
            score += 6 if beta <= 1.1 else (-8 if beta >= 1.5 else -2)
        else:
            score += 4 if beta <= 1.3 else (-10 if beta >= 2.0 else -3)

    if pe_premium is not None:
        if pe_premium >= 50:
            score -= 10
        elif pe_premium >= 20:
            score -= 5
        elif pe_premium <= -10:
            score += 4

    return _clamp_score(score)

# ─── Agent Prompts ────────────────────────────────────────────────────────────

BULL_PROMPT = """You are an aggressive Bullish Equity Analyst. Your job is to find the most compelling fundamental and growth reasons to BUY this stock.

Use Financial Chain-of-Thought (FinCoT) to build a strong investment thesis based on value, operational efficiency, and growth metrics. Ignore technical indicators entirely.

Focus ONLY on the following data:
{fundamentals_json}

Task: Write a single coherent paragraph arguing the long (BUY) case. You MUST cite the exact top 2 most bullish fundamental metrics (e.g. ROE, FCF Yield, EPS Growth, low D/E) with their actual numbers from the data. Be specific and quantitative."""

BEAR_PROMPT = """You are a pessimistic Bearish Risk Manager at a macro-focused hedge fund. Your job is to rigorously stress-test this stock and argue why it should be a SELL or avoided.

Use Financial Chain-of-Thought (FinCoT) to identify the maximum downside risks. Attack overvaluation multiples where P/E > Sector Median, high D/E relative to sector, and fragility to macro regime shifts.

Focus ONLY on the following data:
{macro_risk_json}

Task: Write a single coherent paragraph arguing the short (SELL or AVOID) case. You MUST cite the exact top 2 most severe risk factors with their actual numbers from the data (e.g. P/E vs. sector median, VIX level, Beta exposure)."""

QUANT_PROMPT = """You are a purely mathematical Quantitative Analyst. You care ONLY about price action, volume momentum, and NLP sentiment scores. You have zero interest in company fundamentals.

Use FinCoT to analyze trend alignment using moving averages, identify mean-reversion risk from RSI and Williams %R levels, and determine if public sentiment aligns with or diverges from the technical price action.

Focus ONLY on the following data:
{technicals_sentiment_json}

Task: Write a single coherent paragraph summarizing the short-term mathematical and behavioral momentum. Cite exact numeric values (e.g. RSI at X, price vs SMA50, MACD direction). Highlight any divergence between price momentum and sentiment."""

CIO_PROMPT = """You are the Chief Investment Officer of an elite quantitative hedge fund managing $50B AUM. You have just received independent analyses from three of your specialists: a Bull, a Bear, and a Quant.

Your task: Read their arguments carefully, resolve the conflicts, and deliver a final, highly calculated, risk-adjusted investment verdict.

CRITICAL INSTRUCTION: Calculate entirely NEW sub-scores and a final Recommendation Score based ONLY on the live market data and the debate summaries below. DO NOT copy or anchor to any prior example scores. Apply rigorous logic.

Analytical Weighting Framework:
- Fundamentals: 40% weight
- Technicals: 30% weight
- Sentiment: 15% weight
- Macro Risk: 15% weight

Apply a risk-adjustment penalty if the Bear's macro/valuation arguments materially outweigh the Bull's case.

─── RAW MARKET DATA ────────────────────────────────
{raw_data_json}

─── BULL ANALYST REPORT ────────────────────────────
{bull_output}

─── BEAR ANALYST REPORT ────────────────────────────
{bear_output}

─── QUANT ANALYST REPORT ───────────────────────────
{quant_output}

Return ONLY a valid JSON object (no markdown, no explanation outside the JSON) with this exact structure:
{{
  "Ticker": "{ticker}",
  "Recommendation_Score": <integer 0-100 rigorously weighted from debate>,
  "Classification": "<Strong Sell|Sell|Hold|Buy|Strong Buy>",
  "Expected_Trend_1_to_6_Months": "<concrete, data-driven prediction with price targets or % range>",
  "XAI_Rationale": {{
    "Top_Positive_Drivers": [
      "<specific metric + value driving the bull case>",
      "<specific metric + value driving the bull case>",
      "<specific metric + value driving the bull case>"
    ],
    "Top_Negative_Drivers": [
      "<specific risk factor + value from bear case>",
      "<specific risk factor + value from bear case>"
    ]
  }},
  "Sub_Scores": {{
    "Fundamental": <integer 0-100, based on fundamentals data only>,
    "Technical": <integer 0-100, based on technicals data only>,
    "Sentiment": <integer 0-100, based on sentiment data only>,
    "Macro_Risk": <integer 0-100, based on macro/risk data only>
  }}
}}"""


# ─── Async Agent Runner with Retry ────────────────────────────────────────────

async def _call_agent_async(prompt: str, use_json: bool = False, max_retries: int = 3) -> str:
    """Calls Gemini asynchronously with retry on rate-limit errors."""
    model = genai.GenerativeModel(MODEL_NAME)
    cfg = GEN_CFG_JSON if use_json else GEN_CFG

    for attempt in range(max_retries):
        try:
            response = await model.generate_content_async(prompt, generation_config=cfg)
            return response.text
        except Exception as e:
            err = str(e)
            if "429" in err or "quota" in err.lower() or "rate" in err.lower():
                wait = 2 ** attempt * 5
                await asyncio.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Agent failed after {max_retries} retries.")


# ─── Main Analysis Function (SSE Stream) ──────────────────────────────────────

async def analyze_stock_stream(ticker: str, target_date: str = None) -> AsyncGenerator[str, None]:
    """
    Hybrid RAG + Adversarial Multi-Agent Debate architecture as an Async Generator.
    Yields SSE-formatted data chunks:
    - data: {"type": "status", "message": "..."}
    - data: {"type": "agent_done", "agent": "bull", "text": "..."}
    - data: {"type": "complete", "data": {...}}
    - data: {"type": "error", "message": "..."}
    """
    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    try:
        if not api_key:
            yield sse({"type": "error", "message": "GEMINI_API_KEY is not set."})
            return

        ticker = ticker.upper()

        # ── 0. Check Cache ────────────────────────────────────────────────────
        cache_key = f"{ticker}_{target_date}" if target_date else ticker
        cache_file = os.path.join(CACHE_DIR, f"{cache_key}.json")
        
        if os.path.exists(cache_file):
            file_mtime = os.path.getmtime(cache_file)
            file_date = datetime.fromtimestamp(file_mtime).date()
            today = datetime.now().date()
            
            # Cache is valid if it's for a past date, or if it's today's analysis
            if target_date or file_date == today:
                yield sse({"type": "status", "message": f"Cache hit for {ticker}. Loading..."})
                with open(cache_file, "r") as f:
                    cache_data = json.load(f)
                
                if "metadata" not in cache_data:
                    cache_data["metadata"] = {}
                cache_data["metadata"]["is_cached"] = True
                cache_data["metadata"]["generated_at"] = datetime.fromtimestamp(file_mtime).isoformat()
                    
                yield sse({"type": "complete", "data": cache_data})
                return

        yield sse({"type": "status", "message": f"Fetching live market data for {ticker}..."})

        # ── 1. Fetch Live Data ────────────────────────────────────────────────
        stock = yf.Ticker(ticker)
        info = stock.info
        
        if target_date:
            try:
                # Add 1 day to end_date to ensure the target_date is included in yfinance history
                end_date = datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)
            except ValueError:
                yield sse({"type": "error", "message": f"Invalid date format: {target_date}"})
                return
        else:
            end_date = datetime.now()
            
        hist = stock.history(start=end_date - timedelta(days=365), end=end_date)
        
        if hist.empty:
            yield sse({"type": "error", "message": f"Could not retrieve historical data for {ticker}."})
            return

        current_price = info.get("currentPrice", 0) or hist['Close'].iloc[-1]

        # ── 2. Sanitize Fundamentals ──────────────────────────────────────────
        raw_pe = info.get("trailingPE", None)
        raw_peg = info.get("pegRatio", None)
        raw_eps_growth = info.get("earningsQuarterlyGrowth", None)
        raw_dte = info.get("debtToEquity", None)

        # PEG: dynamically calculate if missing
        peg_ratio = raw_peg
        if peg_ratio is None or (isinstance(peg_ratio, float) and np.isnan(peg_ratio)):
            eps_growth_pct = round(raw_eps_growth * 100, 2) if raw_eps_growth else None
            if raw_pe and eps_growth_pct and eps_growth_pct != 0:
                peg_ratio = round(raw_pe / eps_growth_pct, 2)
            else:
                peg_ratio = 2.0  # Sector fallback

        # D/E: normalize if yfinance returns it as a percentage (>10 heuristic)
        dte_normalized = None
        if raw_dte is not None:
            dte_normalized = round(raw_dte / 100, 2) if abs(raw_dte) > 10 else round(raw_dte, 2)

        # ── 3. Build Payload Segments (each agent gets only what it needs) ────
        fundamentals = {
            "P_E_Ratio": raw_pe,
            "Sector_P_E_Median": 25.0,
            "P_B_Ratio": info.get("priceToBook", None),
            "PEG_Ratio": peg_ratio,
            "ROE_pct": round(info.get("returnOnEquity", 0) * 100, 2) if info.get("returnOnEquity") else None,
            "Debt_to_Equity": dte_normalized,
            "Free_Cash_Flow_Yield_pct": round(info.get("freeCashflow", 0) / info.get("marketCap", 1) * 100, 2) if info.get("freeCashflow") and info.get("marketCap") else None,
            "5Y_EPS_Growth_Rate_pct": round(raw_eps_growth * 100, 2) if raw_eps_growth else None,
            "Recent_EPS_Revision_Trend": "Neutral"
        }

        # Technicals
        hist['SMA50'] = hist['Close'].rolling(50).mean()
        hist['SMA200'] = hist['Close'].rolling(200).mean()
        sma50 = hist['SMA50'].iloc[-1]
        sma200 = hist['SMA200'].iloc[-1]
        delta = hist['Close'].diff()
        gain = delta.where(delta > 0, 0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
        rsi = 100 - (100 / (1 + gain / loss))
        rsi_val = round(rsi.iloc[-1], 2)
        ema12 = hist['Close'].ewm(span=12, adjust=False).mean()
        ema26 = hist['Close'].ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        macd_sig = macd.ewm(span=9, adjust=False).mean()
        vol_avg_20 = hist['Volume'].rolling(20).mean().iloc[-1]
        vol_momentum = "Expanding" if hist['Volume'].iloc[-1] > vol_avg_20 else "Contracting"

        # Williams %R (using past 14 days high/low)
        h14 = hist['High'].rolling(14).max().iloc[-1]
        l14 = hist['Low'].rolling(14).min().iloc[-1]
        williams_r = round(((h14 - current_price) / (h14 - l14)) * -100, 2) if (h14 - l14) != 0 else None

        technicals = {
            "Current_Price": round(current_price, 2),
            "SMA_50": round(sma50, 2) if not np.isnan(sma50) else None,
            "SMA_200": round(sma200, 2) if not np.isnan(sma200) else None,
            "RSI_14": rsi_val if not np.isnan(rsi_val) else None,
            "MACD_Signal": "Bullish Crossover" if macd.iloc[-1] > macd_sig.iloc[-1] else "Bearish Crossover",
            "Williams_R": williams_r,
            "Volume_Momentum": vol_momentum,
        }

        # VIX & News
        try:
            vix_hist = yf.Ticker("^VIX").history(period="5d")
            vix_level = round(vix_hist['Close'].iloc[-1], 2) if not vix_hist.empty else 15.0
        except Exception:
            vix_level = 15.0

        try:
            news = stock.news or []
            recent_headlines = [n['title'] for n in news[:5]]
        except Exception:
            recent_headlines = []

        sentiment = {
            "FinBERT_News_Score_Approx": 0.5 if recent_headlines else 0.1,
            "Recent_Headlines": recent_headlines,
            "Overnight_Social_Sentiment": "Neutral",
        }

        macro_risk = {
            "VIX_Level": vix_level,
            "Federal_Funds_Rate_Trend": "Stable",
            "US_GDP_Expectation_pct": 2.0,
            "Stock_Beta": info.get("beta", 1.0),
            "Valuation_vs_Sector": {
                "P_E_Ratio": raw_pe,
                "Sector_P_E_Median": 25.0,
                "P_E_Premium_pct": round((raw_pe - 25.0) / 25.0 * 100, 1) if raw_pe else None,
            }
        }

        full_payload = {
            "Ticker": ticker.upper(),
            "Sector": info.get("sector", "Unknown"),
            "Fundamentals": fundamentals,
            "Technicals": technicals,
            "Sentiment": sentiment,
            "Macro_and_Risk": macro_risk,
        }

        # ── 4. Build Per-Agent Prompts ────────────────────────────────────────
        bull_p = BULL_PROMPT.format(
            fundamentals_json=json.dumps(fundamentals, indent=2)
        )
        bear_p = BEAR_PROMPT.format(
            macro_risk_json=json.dumps({**macro_risk, "Fundamentals_Valuation": {
                "P_E_Ratio": fundamentals["P_E_Ratio"],
                "P_B_Ratio": fundamentals["P_B_Ratio"],
                "PEG_Ratio": fundamentals["PEG_Ratio"],
                "Debt_to_Equity": fundamentals["Debt_to_Equity"],
            }}, indent=2)
        )
        quant_p = QUANT_PROMPT.format(
            technicals_sentiment_json=json.dumps({**technicals, **sentiment}, indent=2)
        )

        yield sse({"type": "status", "message": "Starting 3-Agent Parallel Debate..."})

        # ── 5. Run Agents 1, 2, 3 in Parallel & Yield as they finish ──────────
        async def run_agent(name, prompt):
            text = await _call_agent_async(prompt)
            return name, text

        pending = [
            run_agent("bull", bull_p),
            run_agent("bear", bear_p),
            run_agent("quant", quant_p)
        ]

        debate_results = {}
        for coro in asyncio.as_completed(pending):
            name, out = await coro
            debate_results[name] = out
            yield sse({"type": "agent_done", "agent": name, "text": out})

        bull_out = debate_results.get("bull", "")
        bear_out = debate_results.get("bear", "")
        quant_out = debate_results.get("quant", "")

        yield sse({"type": "status", "message": "Synthesizing debate (CIO Agent)..."})

        # ── 6. Agent 4 (CIO) — Sequential, reads the debate ──────────────────
        cio_p = CIO_PROMPT.format(
            ticker=ticker,
            raw_data_json=json.dumps(full_payload, indent=2),
            bull_output=bull_out,
            bear_output=bear_out,
            quant_output=quant_out,
        )
        cio_raw = await _call_agent_async(cio_p, use_json=True)

        # ── 7. Parse CIO Verdict ──────────────────────────────────────────────
        try:
            llm_result = json.loads(cio_raw)
        except json.JSONDecodeError:
            raise ValueError(f"CIO Agent returned invalid JSON. Raw output: {cio_raw[:300]}")

        summary = llm_result.get("Expected_Trend_1_to_6_Months", "")
        llm_sub_scores = llm_result.get("Sub_Scores", {}) or {}
        market_cap_bucket = _bucket_market_cap(info.get("marketCap"))
        completeness = {
            "Fundamental": _completeness_ratio(
                [
                    fundamentals.get("P_E_Ratio"),
                    fundamentals.get("P_B_Ratio"),
                    fundamentals.get("PEG_Ratio"),
                    fundamentals.get("ROE_pct"),
                    fundamentals.get("Debt_to_Equity"),
                    fundamentals.get("Free_Cash_Flow_Yield_pct"),
                    fundamentals.get("5Y_EPS_Growth_Rate_pct"),
                ]
            ),
            "Technical": _completeness_ratio(
                [
                    technicals.get("Current_Price"),
                    technicals.get("SMA_50"),
                    technicals.get("SMA_200"),
                    technicals.get("RSI_14"),
                    technicals.get("Williams_R"),
                ]
            ),
            "Sentiment": _completeness_ratio(
                [
                    sentiment.get("FinBERT_News_Score_Approx"),
                    len(sentiment.get("Recent_Headlines") or []),
                ]
            ),
            "Macro_Risk": _completeness_ratio(
                [
                    macro_risk.get("VIX_Level"),
                    macro_risk.get("Stock_Beta"),
                    (macro_risk.get("Valuation_vs_Sector") or {}).get("P_E_Premium_pct"),
                ]
            ),
        }

        deterministic_sub_scores = {
            "Fundamental": _fundamental_signal(fundamentals),
            "Technical": _technical_signal(technicals),
            "Sentiment": _sentiment_signal(sentiment),
            "Macro_Risk": _macro_signal(macro_risk, market_cap_bucket),
        }

        calibrated_sub_scores = {}
        domain_confidence = {}
        deltas = []
        for key, deterministic_score in deterministic_sub_scores.items():
            llm_score = _clamp_score(llm_sub_scores.get(key), deterministic_score)
            completeness_ratio = completeness.get(key, 0.5)
            llm_weight = 0.5 + (completeness_ratio * 0.2)
            deterministic_weight = 1.0 - llm_weight
            calibrated_score = round((llm_score * llm_weight) + (deterministic_score * deterministic_weight))
            calibrated_sub_scores[key] = _clamp_score(calibrated_score, deterministic_score)

            delta = abs(llm_score - deterministic_score)
            deltas.append(delta)
            domain_confidence[key] = max(35, min(99, int((completeness_ratio * 100) - (delta * 0.45) + 28)))

        score_weights = {
            "mega_cap": {"Fundamental": 0.42, "Technical": 0.26, "Sentiment": 0.12, "Macro_Risk": 0.20},
            "large_cap": {"Fundamental": 0.40, "Technical": 0.28, "Sentiment": 0.14, "Macro_Risk": 0.18},
            "mid_cap": {"Fundamental": 0.37, "Technical": 0.30, "Sentiment": 0.15, "Macro_Risk": 0.18},
            "small_cap": {"Fundamental": 0.32, "Technical": 0.28, "Sentiment": 0.18, "Macro_Risk": 0.22},
        }[market_cap_bucket]

        score = round(
            sum(calibrated_sub_scores[key] * weight for key, weight in score_weights.items())
        )
        recommendation = _classify_score(score)

        avg_delta = sum(deltas) / len(deltas) if deltas else 18
        avg_completeness = sum(completeness.values()) / len(completeness) if completeness else 0.5
        analysis_confidence = max(40, min(98, int((avg_completeness * 100) - (avg_delta * 0.55) + 35)))

        low_confidence_reasons = []
        for key, confidence_value in domain_confidence.items():
            if confidence_value < 60:
                low_confidence_reasons.append(f"{key.lower()} disagreement_or_missing_data")

        if not summary:
            expected_direction = "upside bias" if score >= 70 else ("downside risk" if score < 45 else "range-bound setup")
            summary = f"The calibrated signal suggests a {expected_direction} over the next 1-6 months, with confidence driven primarily by the current fundamental/technical alignment."

        # ── 8. Compute Change % ───────────────────────────────────────────────
        def sanitize(val):
            try:
                return None if (val is None or (isinstance(val, float) and np.isnan(val))) else val
            except Exception:
                return val

        change_pct = info.get("regularMarketChangePercent", None)
        if change_pct is not None:
            change_pct = change_pct * 100
            # Sanity check: if result is unreasonably large, recalculate from price history
            if abs(change_pct) > 25:
                if len(hist) > 1:
                    prev = hist['Close'].iloc[-2]
                    change_pct = ((current_price - prev) / prev) * 100
                else:
                    change_pct = 0.0
        elif len(hist) > 1:
            prev = hist['Close'].iloc[-2]
            change_pct = ((current_price - prev) / prev) * 100
        else:
            change_pct = 0.0

        # ── 9. Return Final Unified Payload ──────────────────────────────────
        final_payload = {
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "is_cached": False,
                "analysisConfidenceScore": analysis_confidence,
                "inputHistoryPoints": int(len(hist)),
                "model": MODEL_NAME,
                "stockProfile": market_cap_bucket,
                "domainConfidence": domain_confidence,
                "lowConfidenceReasons": low_confidence_reasons,
            },
            "ticker": ticker,
            "name": info.get("shortName", info.get("longName", ticker)),
            "score": score,
            "recommendation": recommendation,
            "summary": summary,
            "price": current_price,
            "changePercent": sanitize(change_pct),
            "market_cap": info.get("marketCap", 0),
            "breakdown": {
                "technicals": "Bullish" if (technicals.get("RSI_14") or 50) > 50 else "Bearish",
                "fundamentals": "Strong" if calibrated_sub_scores.get("Fundamental", 50) > 60 else "Mixed",
                "valuation": "Premium" if (fundamentals.get("P_E_Ratio") or 0) > 25 else "Value",
                "risk": "High" if (macro_risk.get("Stock_Beta", 1) > 1.2 or vix_level > 20) else "Low",
            },
            "metrics": {k: sanitize(v) for k, v in fundamentals.items()},
            "technicals": {k: sanitize(v) for k, v in technicals.items()},
            "ai_analysis": {
                "xai_rationale": llm_result.get("XAI_Rationale", {}),
                "sub_scores": calibrated_sub_scores,
                "llm_sub_scores": {key: _clamp_score(value) for key, value in llm_sub_scores.items()},
                "deterministic_sub_scores": deterministic_sub_scores,
                "score_weights": score_weights,
                "debate": {
                    "bull": bull_out,
                    "bear": bear_out,
                    "quant": quant_out,
                }
            },
            "chartData": [
                {
                    "date": idx.strftime("%m/%d"),
                    "open": round(row['Open'], 2),
                    "high": round(row['High'], 2),
                    "low": round(row['Low'], 2),
                    "close": round(row['Close'], 2),
                    "volume": int(row['Volume']) if 'Volume' in row else 0,
                }
                for idx, row in hist.tail(30).iterrows()
            ]
        }

        # Save to cache
        with open(cache_file, "w") as f:
            json.dump(final_payload, f)

        yield sse({"type": "complete", "data": final_payload})

    except Exception as e:
        yield sse({"type": "error", "message": str(e)})


# ─── Historical Data (unchanged) ─────────────────────────────────────────────

def get_historical_data(ticker: str, period: str = "1mo", interval: str = "1d") -> list:
    """Fetches raw OHLC data for a dynamic timeframe to feed into trading charts using yfinance."""
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period=period, interval=interval)
        if hist.empty:
            return []

        hist = hist.reset_index()
        time_col = 'Datetime' if 'Datetime' in hist.columns else 'Date'

        chart_data = []
        for _, row in hist.iterrows():
            if interval in ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h']:
                time_val = int(row[time_col].timestamp())
            else:
                time_val = row[time_col].strftime('%Y-%m-%d')

            chart_data.append({
                "time": time_val,
                "open": round(row['Open'], 2),
                "high": round(row['High'], 2),
                "low": round(row['Low'], 2),
                "close": round(row['Close'], 2),
                "value": round(row['Close'], 2),
                "volume": int(row['Volume']) if 'Volume' in row else 0,
            })

        return chart_data
    except Exception as e:
        return {"error": str(e)}

async def chat_with_agent(ticker: str, user_message: str, target_agent: str, context_score: int = None) -> str:
    """Invokes a standalone LLM call simulating an agent's response to a user."""
    ticker = ticker.upper()
    cache_file = os.path.join(CACHE_DIR, f"{ticker}.json")
    context_str = "No recent context available."
    
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r") as f:
                data = json.load(f)
                ai_data = data.get("ai_analysis", {})
                context_str = json.dumps(ai_data, indent=2)
        except Exception as e:
            print(f"Error reading cache for chat: {e}")

    prompt = f"""You are the '{target_agent}' AI agent in a high-stakes financial debate room.
You are currently analyzing {ticker}.
Current consensus AI score: {context_score if context_score else 'Unknown'}/100

Recent analysis context for this stock:
{context_str}

The user has just asked you this question:
"{user_message}"

Respond DIRECTLY to the user in your unique persona:
- If Bullish: Aggressive, focused on growth, upside potential, and ignoring the noise.
- If Bearish: Pessimistic, focused on macro risks, high valuation, and downside.
- If Quant: Purely mathematical, focused on RSI, moving averages, not fundamentals.
- If CIO: Balanced, authoritative, focusing on risk-adjusted returns and resolving conflicts.

Keep your response concise (2-4 sentences max), punchy, and highly insightful. Rely on the numeric context provided above where possible. Do not output markdown asterisks or quotes around your response.
"""
    try:
        response = await _call_agent_async(prompt)
        return response.strip()
    except Exception as e:
        return f"Agent {target_agent} failed to respond: {str(e)}"
