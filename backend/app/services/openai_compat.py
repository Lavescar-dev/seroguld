"""OpenAI-uyumlu uçların chat/completions parametre uyumsuzlukları.

0.3.43: gpt-5 ailesi ve o-serisi modeller yerel OpenAI/Azure
chat/completions ucunda ``max_tokens`` parametresini reddeder (HTTP 400
unsupported_parameter — "Use 'max_completion_tokens' instead"). Bu modül
model adına göre doğru parametre adını üretir; iki çağıranı vardır:
kimlik VLM'i (_call_vlm) ve urun metni AI'i (AIService).
"""


def max_tokens_param(model: str, limit: int) -> dict[str, int]:
    """Model adına gore cap parametresi: gpt-5*/o-serisi → max_completion_tokens.

    OpenRouter slug'lari ("openai/gpt-5-mini") vendor oneki tasir — sade
    model adina indirgenir. Eslesmeyen adlar icin ``max_tokens`` doner:
    OpenRouter bu adı normalize edip kabul eder (kanıt: 1912b5d sonrasi
    gpt-5 ailesi bench'leri aynı uçta koştu), yani en kotu durum mevcut
    davranış, kırılma değil.
    """
    name = (model or "").rsplit("/", 1)[-1].strip().lower()
    if name.startswith(("gpt-5", "o1", "o3", "o4")):
        return {"max_completion_tokens": limit}
    return {"max_tokens": limit}
