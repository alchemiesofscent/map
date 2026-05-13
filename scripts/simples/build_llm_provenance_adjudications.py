#!/usr/bin/env python3
"""Run independent Codex CLI votes for simples provenance candidates."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from provenance_common import (
    CANDIDATES_PATH,
    GAZETTEER_PATH,
    LLM_ADJUDICATIONS_PATH,
    MANIFEST_PATH,
    REPO_ROOT,
    load_json,
    now_utc,
    rel,
    sorted_counter,
    stable_id,
    write_json,
)


PROMPT_VERSION = "simples-provenance-consensus-v1"
RUNNER = "codex exec"
ALLOWED_DECISIONS = {
    "accept",
    "reject",
    "context_only",
    "uncertain",
    "needs_more_context",
    "wrong_pleiades_match",
}
ALLOWED_RELATIONS = {
    "named_variety_from",
    "grows_at",
    "produced_at",
    "sourced_from",
    "acquired",
    "observed",
    "tested",
    "prepared",
    "context_only",
    "rejected_candidate",
}
EXCLUDED_ACCEPT_RELATIONS = {"context_only", "rejected_candidate", ""}
VOTE_FIELDS = {
    "decision",
    "supported",
    "relation",
    "accepted_pleiades_id",
    "confidence",
    "evidence_phrase",
    "rationale",
    "warnings",
}
VOTE_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "required": sorted(VOTE_FIELDS),
    "properties": {
        "decision": {"type": "string", "enum": sorted(ALLOWED_DECISIONS)},
        "supported": {"type": "boolean"},
        "relation": {"type": "string", "enum": sorted(ALLOWED_RELATIONS | {""})},
        "accepted_pleiades_id": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "evidence_phrase": {"type": "string"},
        "rationale": {"type": "string"},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ask independent Codex CLI agents to adjudicate provenance candidates."
    )
    parser.add_argument(
        "--candidate-id",
        action="append",
        default=[],
        help="Limit to one or more candidate IDs. Defaults to every candidate.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit the number of candidates processed after filtering.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run candidates even if an adjudication already exists.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Seconds to allow each Codex CLI vote.",
    )
    parser.add_argument(
        "--model",
        default="",
        help="Optional Codex model override passed to codex exec.",
    )
    parser.add_argument(
        "--reasoning-effort",
        default="",
        choices=["", "low", "medium", "high", "xhigh"],
        help="Optional model_reasoning_effort override passed to codex exec.",
    )
    return parser.parse_args()


def candidate_place_options(
    candidate: dict[str, Any], places: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for pid in candidate["candidate_pleiades_ids"]:
        place = places.get(pid, {})
        names = []
        for name in place.get("names", [])[:20]:
            names.append(
                {
                    "surface": name.get("surface", ""),
                    "language": name.get("language", ""),
                    "kind": name.get("kind", ""),
                    "is_greek_script": name.get("is_greek_script", False),
                }
            )
        coords = place.get("coordinates") or {}
        options.append(
            {
                "pleiades_id": pid,
                "pleiades_uri": place.get("pleiades_uri", ""),
                "title": place.get("title", ""),
                "feature_types": place.get("feature_types", []),
                "coordinates": {
                    "lat": coords.get("lat"),
                    "lon": coords.get("lon"),
                },
                "location_precision": place.get("location_precision", ""),
                "names": names,
            }
        )
    return options


def build_prompt(
    agent_label: str,
    candidate: dict[str, Any],
    entry: dict[str, Any],
    places: dict[str, dict[str, Any]],
) -> str:
    prompt_payload = {
        "candidate": {
            "candidate_id": candidate["candidate_id"],
            "entry_id": candidate["entry_id"],
            "author": candidate.get("author", ""),
            "work": candidate.get("work", ""),
            "book": candidate.get("book", ""),
            "chapter": candidate.get("chapter", ""),
            "lemma": candidate.get("lemma", ""),
            "subject_label": candidate.get("subject_label", ""),
            "matched_place_surface": candidate.get("matched_place_surface", ""),
            "provisional_relation": candidate.get("provisional_relation", ""),
            "deterministic_certainty": candidate.get("certainty", ""),
            "deterministic_classifier_reason": candidate.get("classifier_reason", ""),
            "matched_field": candidate.get("matched_field", ""),
            "source_char_offsets": candidate.get("source_char_offsets", {}),
            "short_evidence_phrase": candidate.get("evidence_phrase", ""),
            "short_context_window": candidate.get("context_window", ""),
            "pleiades_options": candidate_place_options(candidate, places),
        },
        "entry": {
            "lemma": entry.get("lemma", ""),
            "lemma_en": entry.get("lemma_en", ""),
            "chapter_heading_gr": entry.get("chapter_heading_gr", ""),
            "section_heading_gr": entry.get("section_heading_gr", ""),
            "variant_or_parallel_gr": entry.get("variant_or_parallel_gr", ""),
            "variant_or_parallel_en": entry.get("variant_or_parallel_en", ""),
            "entry_en": entry.get("entry_en", ""),
            "greek_entry_text": entry.get("greek_entry_text", ""),
        },
    }
    return (
        f"You are Agent {agent_label}, an independent reviewer for a Greek medical "
        "simples provenance pipeline.\n\n"
        "Task: decide whether the proposed provenance candidate is supported by "
        "the full source passage. Judge only the supplied passage and Pleiades "
        "options. Do not use web search or outside sources. Do not edit files "
        "or run shell commands.\n\n"
        "Decision meanings:\n"
        "- accept: the passage supports the proposed or corrected provenance "
        "relation between the simple and one supplied Pleiades place.\n"
        "- reject: the place match does not support a provenance relation.\n"
        "- context_only: the place/name is only contextual, comparative, a homonym, "
        "or the simple's own label rather than provenance.\n"
        "- uncertain: the evidence is too ambiguous to accept or reject.\n"
        "- needs_more_context: the supplied passage is insufficient for judgment.\n"
        "- wrong_pleiades_match: the surface is probably geographic, but none of "
        "the supplied Pleiades options is the right target.\n\n"
        "Output requirements:\n"
        "- Return only a JSON object with exactly these keys: "
        "decision, supported, relation, accepted_pleiades_id, confidence, "
        "evidence_phrase, rationale, warnings.\n"
        "- For accept, supported must be true, relation must be a provenance "
        "relation other than context_only/rejected_candidate, and "
        "accepted_pleiades_id must be one of the supplied option IDs.\n"
        "- For every other decision, supported must be false and "
        "accepted_pleiades_id should be an empty string.\n"
        "- confidence must be a number from 0 to 1.\n"
        "- evidence_phrase should be the shortest Greek phrase that justifies the "
        "decision, or an empty string if no supporting phrase exists.\n\n"
        "Candidate package:\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False, indent=2)}\n"
    )


def extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.startswith("json"):
            stripped = stripped[4:]
        stripped = stripped.strip()
    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char != "{":
            continue
        try:
            value, end = decoder.raw_decode(stripped[index:])
        except json.JSONDecodeError:
            continue
        if stripped[index + end :].strip():
            continue
        if not isinstance(value, dict):
            raise ValueError("Codex response JSON is not an object")
        return value
    raise ValueError("Codex response did not contain one strict JSON object")


def normalize_vote_response(value: dict[str, Any]) -> dict[str, Any]:
    keys = set(value)
    if keys != VOTE_FIELDS:
        missing = sorted(VOTE_FIELDS - keys)
        extra = sorted(keys - VOTE_FIELDS)
        raise ValueError(f"vote JSON fields mismatch; missing={missing} extra={extra}")
    decision = str(value["decision"]).strip().lower()
    if decision not in ALLOWED_DECISIONS:
        raise ValueError(f"invalid decision: {value['decision']}")
    if not isinstance(value["supported"], bool):
        raise ValueError("supported must be boolean")
    relation = str(value["relation"]).strip()
    if relation not in ALLOWED_RELATIONS and relation:
        raise ValueError(f"invalid relation: {value['relation']}")
    try:
        confidence = float(value["confidence"])
    except (TypeError, ValueError) as exc:
        raise ValueError("confidence must be numeric") from exc
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    warnings = value["warnings"]
    if not isinstance(warnings, list) or not all(isinstance(item, str) for item in warnings):
        raise ValueError("warnings must be a list of strings")
    return {
        "decision": decision,
        "supported": bool(value["supported"]),
        "relation": relation,
        "accepted_pleiades_id": str(value["accepted_pleiades_id"]).strip(),
        "confidence": round(confidence, 3),
        "evidence_phrase": str(value["evidence_phrase"]).strip(),
        "rationale": str(value["rationale"]).strip(),
        "warnings": warnings,
    }


def run_codex_vote(
    agent_label: str,
    candidate: dict[str, Any],
    entry: dict[str, Any],
    places: dict[str, dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    prompt = build_prompt(agent_label, candidate, entry, places)
    with tempfile.TemporaryDirectory(prefix="simples-llm-vote-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        schema_path = temp_dir / "vote.schema.json"
        response_path = temp_dir / "last-message.json"
        schema_path.write_text(json.dumps(VOTE_SCHEMA, indent=2), encoding="utf-8")
        command = [
            "codex",
            "exec",
            "--ephemeral",
            "--cd",
            str(REPO_ROOT),
            "--sandbox",
            "workspace-write",
            "--output-schema",
            str(schema_path),
            "--output-last-message",
            str(response_path),
        ]
        if args.model:
            command.extend(["--model", args.model])
        if args.reasoning_effort:
            command.extend(["-c", f"model_reasoning_effort={args.reasoning_effort}"])
        command.append("-")
        result = subprocess.run(
            command,
            check=False,
            input=prompt,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=args.timeout,
        )
        response_text = response_path.read_text(encoding="utf-8") if response_path.exists() else result.stdout
        if result.returncode != 0:
            raise RuntimeError(
                "codex exec failed for "
                f"{candidate['candidate_id']} agent {agent_label}: "
                f"exit={result.returncode}\nSTDERR:\n{result.stderr[-2000:]}\nSTDOUT:\n{result.stdout[-2000:]}"
            )
    response = normalize_vote_response(extract_json_object(response_text))
    return {
        "vote_trace_id": stable_id("vote", candidate["candidate_id"], agent_label, PROMPT_VERSION),
        "candidate_id": candidate["candidate_id"],
        "agent_label": agent_label,
        "runner": RUNNER,
        "prompt_version": PROMPT_VERSION,
        "created_at": now_utc(),
        "response": response,
    }


def vote_key(vote: dict[str, Any]) -> str:
    response = vote["response"]
    decision = response["decision"]
    if decision == "accept":
        return "|".join(
            [
                decision,
                response.get("relation", ""),
                response.get("accepted_pleiades_id", ""),
            ]
        )
    return decision


def representative_vote(votes: list[dict[str, Any]], key: str) -> dict[str, Any]:
    matching = [vote for vote in votes if vote_key(vote) == key]
    if not matching:
        return votes[0]
    return sorted(matching, key=lambda vote: vote["response"]["confidence"], reverse=True)[0]


def consensus_from_votes(candidate: dict[str, Any], votes: list[dict[str, Any]]) -> dict[str, Any]:
    if len(votes) < 2:
        raise ValueError("at least two votes are required")
    first_key = vote_key(votes[0])
    second_key = vote_key(votes[1])
    if first_key == second_key:
        final_key = first_key
        method = "two_vote_match"
        majority_votes = votes[:2]
    else:
        if len(votes) != 3:
            raise ValueError("third vote required when the first two votes disagree")
        counts = Counter(vote_key(vote) for vote in votes)
        final_key, count = counts.most_common(1)[0]
        if count < 2:
            return {
                "method": "all_different_uncertain",
                "decision_key": "uncertain",
                "decision": "uncertain",
                "supported": False,
                "relation": "",
                "accepted_pleiades_id": "",
                "confidence": round(
                    sum(vote["response"]["confidence"] for vote in votes) / len(votes), 3
                ),
                "evidence_phrase": "",
                "rationale": "All three independent votes differed; no majority was available.",
                "warnings": ["all_votes_differed"],
            }
        method = "three_vote_majority"
        majority_votes = [vote for vote in votes if vote_key(vote) == final_key]

    final_vote = representative_vote(votes, final_key)
    response = final_vote["response"]
    decision = response["decision"]
    relation = response.get("relation", "")
    accepted_pid = response.get("accepted_pleiades_id", "")
    warnings = sorted({warning for vote in majority_votes for warning in vote["response"]["warnings"]})
    if decision == "accept":
        if relation in EXCLUDED_ACCEPT_RELATIONS:
            decision = "uncertain"
            warnings.append("accept_vote_used_non_provenance_relation")
        elif accepted_pid not in candidate["candidate_pleiades_ids"]:
            decision = "uncertain"
            warnings.append("accept_vote_used_non_candidate_pleiades_id")
    if decision != "accept":
        accepted_pid = ""
    return {
        "method": method,
        "decision_key": final_key,
        "decision": decision,
        "supported": decision == "accept",
        "relation": relation if decision == "accept" else response.get("relation", ""),
        "accepted_pleiades_id": accepted_pid,
        "confidence": round(
            sum(vote["response"]["confidence"] for vote in majority_votes) / len(majority_votes), 3
        ),
        "evidence_phrase": response.get("evidence_phrase", ""),
        "rationale": response.get("rationale", ""),
        "warnings": sorted(set(warnings)),
    }


def adjudicate_candidate(
    candidate: dict[str, Any],
    entry: dict[str, Any],
    places: dict[str, dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    votes = [
        run_codex_vote("A", candidate, entry, places, args),
        run_codex_vote("B", candidate, entry, places, args),
    ]
    if vote_key(votes[0]) != vote_key(votes[1]):
        votes.append(run_codex_vote("C", candidate, entry, places, args))
    consensus = consensus_from_votes(candidate, votes)
    return {
        "adjudication_id": stable_id("llm-adjudication", candidate["candidate_id"], PROMPT_VERSION),
        "candidate_id": candidate["candidate_id"],
        "entry_id": candidate["entry_id"],
        "prompt_version": PROMPT_VERSION,
        "runner": RUNNER,
        "created_at": now_utc(),
        "votes": votes,
        "consensus": consensus,
    }


def build_payload(
    candidates_payload: dict[str, Any],
    adjudications_by_candidate: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    adjudications = [
        adjudications_by_candidate[candidate["candidate_id"]]
        for candidate in candidates_payload["candidates"]
        if candidate["candidate_id"] in adjudications_by_candidate
    ]
    final_decisions = [item["consensus"]["decision"] for item in adjudications]
    methods = [item["consensus"]["method"] for item in adjudications]
    vote_counts = [str(len(item["votes"])) for item in adjudications]
    return {
        "metadata": {
            "artifact_id": "simples-provenance-llm-adjudications",
            "stage": "stage_4_llm_consensus_review",
            "built_at": now_utc(),
            "source_candidates_path": rel(CANDIDATES_PATH),
            "source_manifest_path": rel(MANIFEST_PATH),
            "source_gazetteer_path": rel(GAZETTEER_PATH),
            "prompt_version": PROMPT_VERSION,
            "runner": RUNNER,
            "notes": [
                "Agent A and Agent B vote independently for every candidate.",
                "Agent C is called only when the first two normalized vote keys disagree.",
                "Accepted links are generated only from final consensus decisions.",
            ],
        },
        "counts": {
            "candidates_in": candidates_payload["counts"]["candidates"],
            "adjudications": len(adjudications),
            "votes": sum(len(item["votes"]) for item in adjudications),
            "third_votes": sum(1 for item in adjudications if len(item["votes"]) == 3),
            "final_accepts": sum(1 for decision in final_decisions if decision == "accept"),
        },
        "reports": {
            "final_decisions": sorted_counter(final_decisions),
            "consensus_methods": sorted_counter(methods),
            "vote_counts": sorted_counter(vote_counts),
        },
        "adjudications": adjudications,
    }


def load_existing() -> dict[str, dict[str, Any]]:
    if not LLM_ADJUDICATIONS_PATH.exists():
        return {}
    payload = load_json(LLM_ADJUDICATIONS_PATH)
    return {item["candidate_id"]: item for item in payload.get("adjudications", [])}


def main() -> None:
    args = parse_args()
    candidates_payload = load_json(CANDIDATES_PATH)
    manifest_entries = {
        entry["entry_id"]: entry for entry in load_json(MANIFEST_PATH).get("entries", [])
    }
    places = load_json(GAZETTEER_PATH)["places"]
    candidates = candidates_payload["candidates"]
    if args.candidate_id:
        wanted = set(args.candidate_id)
        candidates = [candidate for candidate in candidates if candidate["candidate_id"] in wanted]
        missing = sorted(wanted - {candidate["candidate_id"] for candidate in candidates})
        if missing:
            raise SystemExit(f"Unknown candidate IDs: {missing}")
    if args.limit:
        candidates = candidates[: args.limit]

    adjudications_by_candidate = load_existing()
    for index, candidate in enumerate(candidates, start=1):
        candidate_id = candidate["candidate_id"]
        if candidate_id in adjudications_by_candidate and not args.force:
            print(f"[{index}/{len(candidates)}] Reusing {candidate_id}")
            continue
        entry = manifest_entries.get(candidate["entry_id"])
        if not entry:
            raise AssertionError(f"{candidate_id}: missing manifest entry {candidate['entry_id']}")
        print(f"[{index}/{len(candidates)}] Adjudicating {candidate_id}")
        adjudications_by_candidate[candidate_id] = adjudicate_candidate(
            candidate, entry, places, args
        )
        write_json(LLM_ADJUDICATIONS_PATH, build_payload(candidates_payload, adjudications_by_candidate))

    payload = build_payload(candidates_payload, adjudications_by_candidate)
    write_json(LLM_ADJUDICATIONS_PATH, payload)
    print(f"Wrote {rel(LLM_ADJUDICATIONS_PATH)}")
    print(f"Adjudications: {payload['counts']['adjudications']}")
    print(f"Votes: {payload['counts']['votes']}")
    print(f"Final decisions: {payload['reports']['final_decisions']}")


if __name__ == "__main__":
    main()
