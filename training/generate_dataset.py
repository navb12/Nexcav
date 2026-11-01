import csv
import math
import random
import os

RAW = ["suction_pressure", "discharge_pressure", "flow_rate", "vibration_rms", "temperature", "rpm"]

def generate_sample(scenario: str, tick: int, sev: float, rng: random.Random, drift: float = 0.0):
    nominal = dict(suction_pressure=2.0, discharge_pressure=6.5, flow_rate=100.0, vibration_rms=2.0, temperature=55.0, rpm=2950.0)
    z = rng.gauss(0, 1)
    
    flow = nominal["flow_rate"] - 4 * sev + rng.gauss(0, 2 + 4 * sev) + 3 * math.sin(tick / 8) + 2.0 * sev * z
    flow -= drift * 2.0  # slight drift effect
    
    d = dict(
        suction_pressure=nominal["suction_pressure"] - 0.55 * sev + rng.gauss(0, 0.08 + 0.12 * sev) - drift * 0.1,
        flow_rate=flow,
        rpm=nominal["rpm"] + rng.gauss(0, 8),
        discharge_pressure=nominal["discharge_pressure"] - 0.004 * (flow - nominal["flow_rate"]) + rng.gauss(0, 0.05 + 0.12 * sev) + 0.1 * sev * z,
        vibration_rms=max(0.2, nominal["vibration_rms"] + 1.3 * sev + rng.gauss(0, 0.25 + 0.35 * sev) + 0.4 * sev * z + drift * 0.3),
        temperature=nominal["temperature"] + 2 * sev + rng.gauss(0, 0.6) + drift * 1.5
    )
    return d

def generate_dataset(output_path="dataset.csv", n_samples=3000, seed=42):
    rng = random.Random(seed)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["scenario", "severity", "label"] + RAW)
        
        for i in range(n_samples):
            # Mix scenarios: 50% normal, 30% developing, 20% severe
            u = rng.random()
            if u < 0.50:
                scen = "normal"
                sev = rng.uniform(0.0, 0.25)
                lbl = 0
            elif u < 0.80:
                scen = "developing"
                sev = rng.uniform(0.6, 1.4)
                lbl = 1
            else:
                scen = "severe"
                sev = rng.uniform(1.6, 2.0)
                lbl = 2
                
            drift = 0.2 if (i > n_samples * 0.6) else 0.0
            readings = generate_sample(scen, i, sev, rng, drift)
            writer.writerow([scen, round(sev, 3), lbl] + [round(readings[k], 4) for k in RAW])
            
    print(f"Generated dataset with {n_samples} samples at {output_path}")

if __name__ == "__main__":
    generate_dataset()

