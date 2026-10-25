"""Attachment-only, empirically calibrated DEMO generator.
Not a clinical prediction model or a staff-performance assessment.
FSC identities, specialties and effects are fictional simulation assumptions.
Requires numpy and pandas. Run: python gen_data_calibrated.py
"""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd

SPECIALTIES = [
    ("brain_death", "Brain-death cases"),
    ("non_brain_death", "Non-brain-death cases"),
    ("anoxia", "Anoxia cases"),
    ("stroke", "Stroke cases"),
    ("trauma", "Head-trauma cases"),
    ("cardiovascular", "Cardiovascular mechanism"),
    ("intoxication", "Intoxication mechanism"),
    ("blunt", "Blunt-injury mechanism"),
    ("mva", "Motor-vehicle accident circumstances"),
    ("natural", "Natural-cause circumstances"),
    ("anoxia", "Anoxia cases"),
    ("stroke", "Stroke cases"),
]

def matches(frame, specialty):
    cause = frame.cause_of_death_unos.fillna("").str.lower()
    mech = frame.mechanism_of_death.fillna("").str.lower()
    circ = frame.circumstances_of_death.fillna("").str.lower()
    return {
        "brain_death": frame.brain_death,
        "non_brain_death": ~frame.brain_death,
        "anoxia": cause.eq("anoxia"),
        "stroke": cause.str.contains("stroke|cva", regex=True),
        "trauma": cause.eq("head trauma"),
        "cardiovascular": mech.eq("cardiovascular"),
        "intoxication": mech.str.contains("intoxication"),
        "blunt": mech.eq("blunt injury"),
        "mva": circ.isin(["mva", "motor vehicle accident"]),
        "natural": circ.str.contains("natural causes"),
    }[specialty].to_numpy()

def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -40, 40)))

def generate(source, n=2500, seed=42, boost=0.03):
    if n < 1 or not 0 <= boost <= 0.05:
        raise ValueError("n must be positive; demo boost must be between 0 and 0.05")
    src = pd.read_csv(source)
    required = {"age", "brain_death", "cause_of_death_unos", "mechanism_of_death", "circumstances_of_death", "authorized"}
    if not required.issubset(src):
        raise ValueError(f"Missing columns: {required - set(src)}")
    for col in ["brain_death", "authorized"]:
        parsed = src[col].astype(str).str.lower().map({"true": True, "false": False, "1": True, "0": False})
        if parsed.isna().any():
            raise ValueError(f"Invalid/missing boolean in {col}")
        src[col] = parsed.astype(bool)
    rng = np.random.default_rng(seed)
    # Joint bootstrap preserves observed feature relationships and missingness.
    # These are resampled source profiles, NOT privacy-preserving synthetic records.
    features = [c for c in src.columns if c != "authorized"]
    out = src.iloc[rng.integers(0, len(src), n)][features].reset_index(drop=True).copy()
    out.insert(0, "case_id", [f"SYN-{i+1:06d}" for i in range(n)])
    # Keep raw labels: do not silently merge potentially distinct coding systems.
    src_key = src.cause_of_death_unos.fillna("__MISSING__")
    out_key = out.cause_of_death_unos.fillna("__MISSING__")
    cells = src.assign(_cause=src_key).groupby(["brain_death", "_cause"]).authorized.agg(["size", "sum"])
    parent = src.groupby("brain_death").authorized.mean()
    # Small cells shrink toward brain-death-specific rate; large cells retain rates.
    prior = np.where(cells["size"] < 50, 30.0, 0.0)
    cells["rate"] = (cells["sum"] + prior * cells.index.get_level_values(0).map(parent).to_numpy()) / (cells["size"] + prior)
    rates = np.array([cells.loc[(bool(b), c), "rate"] for b, c in zip(out.brain_death, out_key)])
    rates = np.clip(rates, 0.001, 0.999)
    logits = np.log(rates / (1-rates))
    # Fixed profiles: attributes do not change between cases for a given FSC.
    profiles = pd.DataFrame({
        "fsc_id": [f"SIM-FSC-{i+1:02d}" for i in range(len(SPECIALTIES))],
        "specialty_key": [s[0] for s in SPECIALTIES],
        "specialization": [s[1] for s in SPECIALTIES],
        "matched_boost_pp": boost * 100,
        "seniority_years": rng.integers(1, 14, len(SPECIALTIES)),
        "bilingual": rng.random(len(SPECIALTIES)) < 0.25,
        "fictional_profile": True,
    })
    assigned = rng.integers(0, len(profiles), n)
    out["assigned_fsc_id"] = profiles.fsc_id.to_numpy()[assigned]
    out["fsc_specialization"] = profiles.specialization.to_numpy()[assigned]
    out["fsc_seniority_years"] = profiles.seniority_years.to_numpy()[assigned]
    out["fsc_bilingual"] = profiles.bilingual.to_numpy()[assigned]
    match = np.zeros(n, dtype=bool)
    for i, (key, _) in enumerate(SPECIALTIES):
        match |= (assigned == i) & matches(out, key)
    delta = match.astype(float) * boost
    # Recenter baseline within each brain-death group AFTER adding specialty effects.
    # This preserves source group mean probabilities without inflating the baseline.
    baseline = np.zeros(n)
    for b in [False, True]:
        mask = out.brain_death.to_numpy() == b
        if not mask.any():
            continue
        target = float(parent.loc[b])
        lo, hi = -30.0, 30.0
        for _ in range(70):
            mid = (lo+hi)/2
            p = np.clip(sigmoid(logits[mask]+mid), 0.001, 1-boost-0.001)
            if (p + delta[mask]).mean() < target:
                lo = mid
            else:
                hi = mid
        baseline[mask] = np.clip(sigmoid(logits[mask]+(lo+hi)/2), 0.001, 1-boost-0.001)
    out["specialty_match"] = match
    out["authorization_probability_without_match"] = baseline
    out["specialty_boost_applied"] = delta
    out["authorization_probability"] = baseline + delta
    out["authorized"] = rng.random(n) < out.authorization_probability
    out["consent_obtained"] = out.authorized.astype(int)
    # Legacy aliases. Non-brain-death does NOT establish a DCD pathway.
    out["assigned_opc_id"] = out.assigned_fsc_id
    out["opc_seniority_years"] = out.fsc_seniority_years
    out["opc_bilingual"] = out.fsc_bilingual
    out["primary_etiology"] = out.cause_of_death_unos.fillna("Unknown / not recorded")
    out["donation_pathway"] = np.where(out.brain_death, "Brain death recorded; pathway unverified", "Non-brain-death; pathway unverified")
    # Unmeasured legacy features retained for interface compatibility only.
    # Their prevalence is ASSUMED from the supplied script, not estimated from CSV.
    assumptions = {"registry_status": .42, "premature_donation_mention": .20,
        "multiple_decision_makers": .45, "family_estrangement": .15,
        "medical_mistrust": .18, "interpreter_utilized": .12,
        "patient_hemodynamically_unstable": .25, "late_referral_rushing_withdrawal": .22}
    for name, prevalence in assumptions.items():
        out[name] = rng.random(n) < prevalence
    out["family_emotional_state"] = rng.choice(["Shutdown/Stoic", "Angered/Defensive", "Accepting/Grieving"], n, p=[.30,.25,.45])
    out["simulation_only"] = True
    return out, profiles

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).with_name("OPOApproached_cleaned.csv"))
    parser.add_argument("--output", type=Path, default=Path("opo_referral_dataset_calibrated.csv"))
    parser.add_argument("--n", type=int, default=2500)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--boost", type=float, default=.03, help="Simulation-only probability increment; .03 = 3 percentage points")
    args = parser.parse_args()
    generated, profiles = generate(args.source, args.n, args.seed, args.boost)
    generated.to_csv(args.output, index=False)
    profiles.to_csv(args.output.with_name("fictional_fsc_profiles.csv"), index=False)
    print(f"Generated {len(generated)} demo records; authorization rate {generated.authorized.mean():.2%}")
    print("Specialties and boosts are fictional; unmeasured legacy features have no outcome effects.")
