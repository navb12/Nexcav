"""
NexCav Dataset Generator
Simulates centrifugal pump telemetry for ~100 runs across healthy and cavitation regimes.
Generates:
  - data/nexcav_train.csv (80% of runs)
  - data/test_runs.csv    (20% of runs)
Columns:
  run_id, time_s, suction_pressure, discharge_pressure, flow_rate, vibration_rms, temperature, rpm, severity_pct, label
"""

import os
import random
import math
import numpy as np
import pandas as pd

# Physics & nominal operating specs
NOMINAL = {
    "suction_pressure": 2.05,    # bar (abs)
    "discharge_pressure": 6.52,  # bar (abs)
    "flow_rate": 100.2,          # m3/h
    "vibration_rms": 1.85,       # mm/s RMS
    "temperature": 52.5,         # deg C
    "rpm": 2950.0                # RPM
}

def generate_run(run_id: str, run_type: str, duration_s: int = 60, seed: int = 42):
    """
    Generate a single time-series run of length duration_s seconds at 1 Hz.
    run_type: 'normal', 'incipient', 'developed', 'severe', 'borderline'
    """
    rng = np.random.RandomState(seed)
    rows = []

    # Choose ramp start time and ramp duration
    if run_type == "normal":
        max_target_severity = 0.0
        ramp_start = duration_s
        ramp_duration = 1
    elif run_type == "borderline":
        max_target_severity = rng.uniform(0.14, 0.24)  # 14% - 24% right around onset boundary
        ramp_start = rng.randint(8, 20)
        ramp_duration = rng.randint(10, 25)
    elif run_type == "incipient":
        max_target_severity = rng.uniform(0.24, 0.42)  # 24% - 42%
        ramp_start = rng.randint(10, 25)
        ramp_duration = rng.randint(6, 18)
    elif run_type == "developed":
        max_target_severity = rng.uniform(0.48, 0.72)  # 48% - 72%
        ramp_start = rng.randint(10, 20)
        ramp_duration = rng.randint(5, 15)
    elif run_type == "severe":
        max_target_severity = rng.uniform(0.78, 1.00)  # 78% - 100%
        ramp_start = rng.randint(8, 16)
        ramp_duration = rng.randint(4, 12)
    else:
        max_target_severity = 0.0
        ramp_start = duration_s
        ramp_duration = 1

    # Realistic industrial sensor noise parameters (moderate turbulence & process jitter)
    noise_suct_base = 0.060
    noise_disc_base = 0.070
    noise_flow_base = 1.75
    noise_vib_base = 0.29
    noise_temp_base = 0.40
    noise_rpm_base = 7.5

    for t in range(duration_s):
        # Calculate continuous severity at time t
        if t < ramp_start:
            sev = 0.0
        else:
            progress = min(1.0, (t - ramp_start) / max(1, ramp_duration))
            # Smooth S-curve (sigmoidal/sinusoidal) transition
            smooth_factor = 0.5 * (1.0 - math.cos(math.pi * progress))
            sev = max_target_severity * smooth_factor

        severity_pct = round(sev * 100.0, 1)

        # Label: 0 = Normal, 1 = Cavitation
        # Real-world cavitation inception has an intermittent transition band
        if sev < 0.16:
            label = 0
            cav_active = False
        elif sev >= 0.26:
            label = 1
            cav_active = True
        else:
            # Transition boundary (intermittent inception bursts)
            prob_burst = (sev - 0.16) / 0.10
            cav_active = bool(rng.uniform(0, 1) < prob_burst)
            label = 1 if cav_active else 0

        # Physical Hydrodynamic Telemetry Generation with Realistic Process Fluctuations
        # Process demand drift (plant piping line variation)
        line_fluct = 0.06 * math.sin(t * 0.18 + (seed % 13))
        flow_fluct = 2.2 * math.cos(t * 0.14 + (seed % 11))

        # 1. Suction pressure drop due to restriction/deficit
        suction_drop = -0.85 * sev - 0.20 * (sev ** 2)
        suct_target = max(0.40, NOMINAL["suction_pressure"] + suction_drop + line_fluct)

        # 2. Cavitation intensity index
        # When cavitation is active or intermittent burst occurs
        if cav_active:
            cav_intensity = max(0.06, (sev - 0.12) * 1.35)
        else:
            cav_intensity = 0.0

        # 3. Flow rate and discharge pressure response
        flow_drop = -12.0 * cav_intensity
        head_drop = -0.80 * (cav_intensity ** 1.1)
        flow_target = max(20.0, NOMINAL["flow_rate"] + flow_drop + flow_fluct)
        disc_target = max(2.5, NOMINAL["discharge_pressure"] + head_drop + 0.5 * line_fluct)

        # 4. Vibration RMS surge from broadband shock pulses
        vib_surge = 3.2 * (cav_intensity ** 1.1) if cav_intensity > 0 else 0.0
        vib_target = math.sqrt(NOMINAL["vibration_rms"] ** 2 + vib_surge ** 2)

        # 5. Temperature and RPM
        temp_target = min(80.0, NOMINAL["temperature"] + 3.8 * cav_intensity)
        rpm_target = max(2600.0, NOMINAL["rpm"] - 10.0 * cav_intensity)

        # Realistic noise scaling with turbulence
        noise_scale = 1.0 + 1.4 * cav_intensity
        common_z = rng.normal(0, 1)

        p_suct = round(float(suct_target + rng.normal(0, noise_suct_base * noise_scale)), 2)
        p_disc = round(float(disc_target + rng.normal(0, noise_disc_base * noise_scale) + 0.01 * common_z), 2)
        flow = round(float(flow_target + rng.normal(0, noise_flow_base * noise_scale) + 0.2 * common_z), 1)
        vib = round(float(max(0.4, vib_target + rng.normal(0, noise_vib_base * noise_scale) + 0.04 * cav_intensity * common_z)), 2)
        temp = round(float(temp_target + rng.normal(0, noise_temp_base)), 1)
        rpm = round(float(rpm_target + rng.normal(0, noise_rpm_base)), 0)

        rows.append({
            "run_id": run_id,
            "time_s": t,
            "suction_pressure": p_suct,
            "discharge_pressure": p_disc,
            "flow_rate": flow,
            "vibration_rms": vib,
            "temperature": temp,
            "rpm": rpm,
            "severity_pct": severity_pct,
            "label": label
        })

    return rows

def generate_dataset():
    random.seed(42)
    np.random.seed(42)

    total_runs = 100
    # Balanced run distribution (100 total runs)
    run_types = (
        ["normal"] * 25 +
        ["borderline"] * 20 +
        ["incipient"] * 20 +
        ["developed"] * 18 +
        ["severe"] * 17
    )
    random.shuffle(run_types)

    all_runs = []
    run_ids = []
    for i, r_type in enumerate(run_types):
        rid = f"run_{i+1:03d}_{r_type}"
        run_ids.append(rid)
        run_rows = generate_run(rid, r_type, duration_s=60, seed=1000 + i * 37)
        all_runs.extend(run_rows)

    # Split strictly by run_id (80% train, 20% test)
    # Stratified-style selection of runs so test set has representative types
    type_to_ids = {}
    for rid, rtype in zip(run_ids, run_types):
        type_to_ids.setdefault(rtype, []).append(rid)

    train_run_ids = set()
    test_run_ids = set()

    for rtype, rids in type_to_ids.items():
        n_test = max(1, int(round(len(rids) * 0.20)))
        test_selected = set(rids[:n_test])
        test_run_ids.update(test_selected)
        train_run_ids.update(set(rids[n_test:]))

    # Ensure exactly 80 / 20 split
    all_id_list = list(run_ids)
    if len(test_run_ids) != 20:
        # Adjust to strictly 20 test runs and 80 train runs
        test_run_ids = set(all_id_list[:20])
        train_run_ids = set(all_id_list[20:])

    print(f"Total runs: {len(run_ids)}")
    print(f"Train runs: {len(train_run_ids)} ({len(train_run_ids)/len(run_ids)*100:.0f}%)")
    print(f"Test runs:  {len(test_run_ids)} ({len(test_run_ids)/len(run_ids)*100:.0f}%)")
    assert train_run_ids.isdisjoint(test_run_ids), "Error: overlap between train and test runs!"

    df_all = pd.DataFrame(all_runs)
    df_train = df_all[df_all["run_id"].isin(train_run_ids)].copy().reset_index(drop=True)
    df_test = df_all[df_all["run_id"].isin(test_run_ids)].copy().reset_index(drop=True)

    os.makedirs("data", exist_ok=True)
    train_path = os.path.join("data", "nexcav_train.csv")
    test_path = os.path.join("data", "test_runs.csv")

    df_train.to_csv(train_path, index=False)
    df_test.to_csv(test_path, index=False)

    print(f"Saved {len(df_train)} train rows to {train_path}")
    print(f"Saved {len(df_test)} test rows to {test_path}")
    print(f"Train label balance: {df_train['label'].value_counts().to_dict()}")
    print(f"Test label balance:  {df_test['label'].value_counts().to_dict()}")

if __name__ == "__main__":
    generate_dataset()
