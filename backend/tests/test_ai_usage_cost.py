from decimal import Decimal

from app.services.ai_service import AIService


def test_usage_summary_calculates_cost_for_known_model():
    service = AIService()
    payload = {
        "model": "gpt-4.1-nano",
        "usage": {
            "prompt_tokens": 1200,
            "completion_tokens": 300,
            "total_tokens": 1500,
        },
    }

    usage = service._build_usage_summary(payload)

    assert usage.model == "gpt-4.1-nano"
    assert usage.prompt_tokens == 1200
    assert usage.completion_tokens == 300
    assert usage.total_tokens == 1500
    assert usage.input_cost_usd == Decimal("0.00012000")
    assert usage.output_cost_usd == Decimal("0.00012000")
    assert usage.total_cost_usd == Decimal("0.00024000")


def test_usage_summary_handles_unknown_model_with_zero_cost():
    service = AIService()
    payload = {
        "model": "unknown-model",
        "usage": {
            "prompt_tokens": 5000,
            "completion_tokens": 800,
        },
    }

    usage = service._build_usage_summary(payload)

    assert usage.pricing_key is None
    assert usage.prompt_tokens == 5000
    assert usage.completion_tokens == 800
    assert usage.total_tokens == 5800
    assert usage.total_cost_usd == Decimal("0.00000000")
