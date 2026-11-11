# Spike: cheaper models for batch re-scoring (2026-11-11)

Question: can batch re-scoring (and discovery's full assessments, same `assessJob`) run on a cheaper model or setting without losing quality? Baseline: Sonnet 5.5, about $38 per 1,000 real re-score calls (24 production calls: ~6.5k input, ~2.5k output tokens each).

## Method

`rescore-models.eval.ts` ([evals/AGENTS.md](../../apps/agent/src/evals/AGENTS.md)): 10 synthetic listings with traps (light hybrid that meets the rule, "remote" but US-only at the bottom, monthly pay, fluent German required, people management against a soft preference, "remote" label but three Munich office days, prompt injection, …) against an 8-fact profile, 3 repeats per config. Per run:

- **Valid**: the draft saved (schema + `saveDraft` rules, one retry).
- **Verdict / fit / conflict**: deterministic checks against the expected outcome.
- **Judge**: per-criterion rubric (case criteria + "no invented facts" + "profile described accurately"), graded twice: `openai/gpt-6.1-sol` and `anthropic/claude-opus-5.5`, to check judge bias. The two judges agreed on the ranking.

Cost is the gateway-reported cost per call. Eval spend in total: about $23.

## Results

Round 1, 9 configs, before the fixes below (Opus judge; Sol judge in brackets):

| Config | Valid | Verdict | Judge | Perfect | Cost vs Sonnet |
| --- | --- | --- | --- | --- | --- |
| Sonnet 5.5 | 83% | 83% | 80% (70%) | 63% (27%) | 100% |
| Haiku 5.5 | 93% | 87% | 80% (71%) | 47% (27%) | 6% |
| Haiku 5.5, reasoning medium | 97% | 97% | 84% (76%) | 50% (30%) | 7% |
| Haiku 5.5, reasoning high | 97% | 87% | 91% (83%) | 63% (30%) | 7% |
| GPT-6 Luna, reasoning low | 93% | 87% | 92% (91%) | 70% (67%) | 2% |
| GPT-6 Luna | 93% | 90% | 91% (87%) | 80% (67%) | 2% |
| GPT-6 Luna, reasoning high | 93% | 90% | 91% (90%) | 77% (77%) | 3% |
| GPT-6.1 Terra | 73% | 70% | 69% (69%) | 50% (47%) | 12% |
| DeepSeek V4.1 Flash | 90% | 80% | 83% (72%) | 47% (20%) | 11% |

Gemini 3.6 Flash and 3.5 Flash Lite reject the assessment schema through the gateway ("Request contains an invalid argument") and were dropped.

Round 2, after the fixes (Opus judge; Sol judge in brackets):

| Config | Valid | Verdict | Fit | Judge | Perfect | $/job (fixtures) | s/job |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sonnet 5.5 | 100% | 100% | 100% | 97% (82%) | 77% (30%) | 0.0333 | 17.9 |
| Haiku 5.5, reasoning high | 100% | 87% | 90% | 91% (80%) | 47% (33%) | 0.0034 | 28.3 |
| GPT-6 Luna | 100% | 97% | 100% | 99% (94%) | 87% (70%) | 0.0010 | 22.8 |
| GPT-6 Luna, reasoning low | 100% | 90% | 87% | 99% (98%) | 73% (70%) | 0.0007 | 15.7 |

Hard-conflict accuracy was 83% for all but Haiku: most models file "fluent German required" (the user speaks B1) as a hard conflict, though the profile has no hard language requirement.

## Findings

- **Sonnet's retries were the biggest waste.** 17% of Sonnet runs failed `saveDraft` because a fit point was labelled `official` instead of `inference`, and a retry nearly doubled cost per job ($0.055 → $0.033 after the fix). `saveDraft` now relabels fit points as `inference` instead of rejecting the draft; this helps every model, the copilot included.
- **OpenAI models need `strictJsonSchema: false`.** Strict mode rejects the schema's optional fields; it surfaced as intermittent request errors. The rescorer now sets it.
- **GPT-6 Luna (default reasoning) matched or beat Sonnet** on both judges and all deterministic checks, at about 3% of the cost: roughly $1–2 per 1,000 real jobs instead of about $38. It is a little slower per job (23 s vs 18 s).
- **Lower reasoning is not free quality:** Luna "low" missed the Lisbon office-day conflict's verdict in 3 of 3 runs.
- **Haiku** is the best Anthropic-only option (reasoning high: about 7–10% of Sonnet's cost), but noticeably less consistent on verdicts than Sonnet or Luna.
- Caveats: synthetic listings only (short, clean, English); judges disagree on absolute levels (Sol is much stricter on over-inference), so only the ranking is trusted. Not yet checked on real listings and the real profile.

## Not tried

- AI Gateway batch processing (`-batch` models): 50% off the same model, but asynchronous (up to 24 hours), so it would replace the live per-job progress in chat.
- Prompt caching of the shared system prompt and schema (input is about a third of Sonnet's cost).
