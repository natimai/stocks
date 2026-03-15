from analysis_engine import (
    _classify_score,
    _fundamental_signal,
    _macro_signal,
    _technical_signal,
)


def test_classify_score_thresholds():
    assert _classify_score(90) == "STRONG BUY"
    assert _classify_score(72) == "BUY"
    assert _classify_score(50) == "HOLD"
    assert _classify_score(30) == "SELL"
    assert _classify_score(10) == "STRONG SELL"


def test_fundamental_signal_rewards_quality_metrics():
    strong = _fundamental_signal(
        {
            "P_E_Ratio": 18,
            "Sector_P_E_Median": 25,
            "PEG_Ratio": 1.1,
            "ROE_pct": 24,
            "Debt_to_Equity": 0.5,
            "Free_Cash_Flow_Yield_pct": 6.5,
            "5Y_EPS_Growth_Rate_pct": 18,
        }
    )
    weak = _fundamental_signal(
        {
            "P_E_Ratio": 42,
            "Sector_P_E_Median": 25,
            "PEG_Ratio": 3.8,
            "ROE_pct": 3,
            "Debt_to_Equity": 3.1,
            "Free_Cash_Flow_Yield_pct": -1.2,
            "5Y_EPS_Growth_Rate_pct": -4,
        }
    )

    assert strong > weak
    assert strong >= 70
    assert weak <= 40


def test_technical_and_macro_signals_penalize_risk():
    bullish_technical = _technical_signal(
        {
            "Current_Price": 120,
            "SMA_50": 110,
            "SMA_200": 100,
            "RSI_14": 58,
            "Williams_R": -45,
            "MACD_Signal": "Bullish Crossover",
            "Volume_Momentum": "Expanding",
        }
    )
    risky_macro = _macro_signal(
        {
            "VIX_Level": 34,
            "Stock_Beta": 2.1,
            "Valuation_vs_Sector": {"P_E_Premium_pct": 70},
        },
        "small_cap",
    )

    assert bullish_technical >= 65
    assert risky_macro <= 40
