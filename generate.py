# import numpy as np
# import pandas as pd
#
# # Set random seed for reproducibility
# np.random.seed(42)
# n_samples = 2500
#
# # 1. Core Patient & Clinical Referral Features
# case_ids = [f"ID-{2026 + i}" for i in range(n_samples)]
# ages = np.random.randint(18, 82, size=n_samples)
# registry_status = np.random.choice([True, False], size=n_samples, p=[0.42, 0.58])
#
# # Clinically accurate referral metrics
# primary_etiologies = np.random.choice(
#     ['Severe Trauma', 'Anoxic Brain Injury (Cardiac Arrest)', 'Cerebrovascular Accident / Stroke'], 
#     size=n_samples, 
#     p=[0.35, 0.40, 0.25]
# )
#
# donation_pathway = np.random.choice(
#     ['DBD (Brain Death)', 'DCD (Circulatory Death)'], 
#     size=n_samples, 
#     p=[0.55, 0.45]
# )
#
# # 2. Qualitative & Logistical Friction Factors (Life Connection of Ohio Insights)
# premature_mention = np.random.choice([True, False], size=n_samples, p=[0.20, 0.80]) # Hospital mentioned donation too soon / before prognosis accepted
# multiple_decision_makers = np.random.choice([True, False], size=n_samples, p=[0.45, 0.55]) # Large/disagreed family group
# estrangement = np.random.choice([True, False], size=n_samples, p=[0.15, 0.85]) # Family estrangement friction
# medical_mistrust = np.random.choice([True, False], size=n_samples, p=[0.18, 0.82]) # Negative hospital experience / institutional mistrust
# interpreter_utilized = np.random.choice([True, False], size=n_samples, p=[0.12, 0.88]) # Language barrier addressed with interpreter
# patient_unstable = np.random.choice([True, False], size=n_samples, p=[0.25, 0.75]) # Hemodynamically unstable during approach
# late_referral_rushing = np.random.choice([True, False], size=n_samples, p=[0.22, 0.78]) # Late referral, family rushing to stop life support
# family_emotional_state = np.random.choice(['Shutdown/Stoic', 'Angered/Defensive', 'Accepting/Grieving'], size=n_samples, p=[0.30, 0.25, 0.45])
#
# # 3. OPC (Organ Procurement Coordinator) Assignment Features
# opc_pool_size = 12
# opc_ids = [f"OPC-{101 + i}" for i in range(opc_pool_size)]
# assigned_opc_indices = np.random.randint(0, opc_pool_size, size=n_samples)
# assigned_opc_id = [opc_ids[i] for i in assigned_opc_indices]
# opc_seniority_years = np.random.randint(1, 14, size=n_samples)
# opc_bilingual = np.random.choice([True, False], size=n_samples, p=[0.25, 0.75])
#
# # Assemble into DataFrame
# df = pd.DataFrame({
#     'case_id': case_ids,
#     'age': ages,
#     'registry_status': registry_status,
#     'primary_etiology': primary_etiologies,
#     'donation_pathway': donation_pathway,
#     'premature_donation_mention': premature_mention,
#     'multiple_decision_makers': multiple_decision_makers,
#     'family_estrangement': estrangement,
#     'medical_mistrust': medical_mistrust,
#     'interpreter_utilized': interpreter_utilized,
#     'patient_hemodynamically_unstable': patient_unstable,
#     'late_referral_rushing_withdrawal': late_referral_rushing,
#     'family_emotional_state': family_emotional_state,
#     'assigned_opc_id': assigned_opc_id,
#     'opc_seniority_years': opc_seniority_years,
#     'opc_bilingual': opc_bilingual
# })
#
# # 4. Realistic Probability Math for Consent (Ground Truth Logic)
# base_prob = 0.7
#
# # Positive Drivers
# registry_boost = df['registry_status'].astype(int) * 0.32
# seniority_boost = (df['opc_seniority_years'] / 14.0) * 0.12
# interpreter_boost = df['interpreter_utilized'].astype(int) * 0.10
#
# # Negative Friction Penalties (The LCO Operational Bottlenecks)
# premature_penalty = df['premature_donation_mention'].astype(int) * -0.28
# mult_decision_penalty = df['multiple_decision_makers'].astype(int) * -0.12
# estrangement_penalty = df['family_estrangement'].astype(int) * -0.18
# mistrust_penalty = df['medical_mistrust'].astype(int) * -0.22
# unstable_penalty = df['patient_hemodynamically_unstable'].astype(int) * -0.10
# late_referral_penalty = df['late_referral_rushing_withdrawal'].astype(int) * -0.30
#
# # Pathway Friction (DCD carries higher stress due to active withdrawal timelines)
# pathway_penalty = (df['donation_pathway'] == 'DCD (Circulatory Death)').astype(int) * -0.12
#
# # Emotional State Adjustments
# emotional_penalty = np.select(
#     [df['family_emotional_state'] == 'Shutdown/Stoic', df['family_emotional_state'] == 'Angered/Defensive', df['family_emotional_state'] == 'Accepting/Grieving'],
#     [-0.20, -0.15, 0.10],
#     default=0.0
# )
#
# # Total Probability Calculation
# calculated_prob = (
#     base_prob + registry_boost + seniority_boost + interpreter_boost
#     + premature_penalty + mult_decision_penalty + estrangement_penalty
#     + mistrust_penalty + unstable_penalty + late_referral_penalty 
#     + pathway_penalty + emotional_penalty
# )
#
# calculated_prob = np.clip(calculated_prob, 0.05, 0.95)
#
# # Generate binary outcome (1 = Consent Granted, 0 = Refused)
# df['consent_obtained'] = (np.random.random(n_samples) < calculated_prob).astype(int)
#
# # Export to CSV
# df.to_csv("data.csv", index=False)
#
# print(f"Generated {n_samples} LCO-informed OPO referral records with clinical pathways!")
# print(f"Dataset saved to 'opo_referral_dataset.csv'.")
# print(f"Overall baseline consent rate in generated data: {df['consent_obtained'].mean() * 100:.1f}%")


import pandas as pd
import numpy as np

def generate_expanded_dataset(input_csv='OPOApproached_cleaned.csv', 
                              output_csv='OPOApproached_expanded.csv', 
                              n_samples=25000, 
                              y_opcs=15, 
                              random_state=42):
    # Load real data
    df_real = pd.read_csv(input_csv)
    
    # Set random seed for reproducibility
    np.random.seed(random_state)
    
    # 1. Impute missing values in reference data so no blanks/NaNs are carried over
    df_clean = df_real.copy()
    
    # Impute missing numeric columns (like age) using random sampling from valid values
    if df_clean['age'].isna().sum() > 0:
        valid_ages = df_clean['age'].dropna().values
        missing_mask = df_clean['age'].isna()
        df_clean.loc[missing_mask, 'age'] = np.random.choice(valid_ages, size=missing_mask.sum())
        
    # Impute missing categorical columns by sampling from non-null values in that column
    for col in ['cause_of_death_unos', 'mechanism_of_death', 'circumstances_of_death']:
        if col in df_clean.columns and df_clean[col].isna().sum() > 0:
            valid_vals = df_clean[col].dropna().values
            missing_mask = df_clean[col].isna()
            df_clean.loc[missing_mask, col] = np.random.choice(valid_vals, size=missing_mask.sum())
            
    # Drop cause_of_death_opo if present (not part of requested output schema)
    if 'cause_of_death_opo' in df_clean.columns:
        df_clean = df_clean.drop(columns=['cause_of_death_opo'])

    # 2. Bootstrap sample the fully imputed real rows
    sampled_indices = np.random.choice(df_clean.index, size=n_samples, replace=True)
    df_synth = df_clean.loc[sampled_indices].reset_index(drop=True)
    
    # 3. Assign OPC IDs formatted as OPC_xx (total y different OPCs)
    opc_ids = [f"OPC_{i:02d}" for i in range(1, y_opcs + 1)]
    df_synth['opc_id'] = np.random.choice(opc_ids, size=n_samples)
    
    # 4. Define hidden specialty profiles for each OPC to influence authorization subtly
    unique_races = df_clean['race'].unique()
    opc_hidden_profiles = {}
    for opc in opc_ids:
        opc_hidden_profiles[opc] = {
            'specialty_race': np.random.choice(unique_races),
            'specialty_age_min': np.random.choice([18, 30, 45, 60]),
            'bonus_magnitude': np.random.uniform(0.15, 0.35)
        }
        
    # 5. Apply hidden OPC influence on 'authorized' outcome based on case matching
    for idx, row in df_synth.iterrows():
        opc = row['opc_id']
        profile = opc_hidden_profiles[opc]
        
        matches_specialty = (
            (row['race'] == profile['specialty_race']) or 
            (profile['specialty_age_min'] <= row['age'] < profile['specialty_age_min'] + 20)
        )
        
        if matches_specialty and not df_synth.loc[idx, 'authorized']:
            if np.random.random() < profile['bonus_magnitude']:
                df_synth.loc[idx, 'authorized'] = True

    # 6. Populate secondary synthetic columns (fully populated with no blanks)
    df_synth['registry_status'] = np.random.choice(
        ['First Person Consent / Registered', 'Not Registered', 'Unknown'], 
        size=n_samples, p=[0.45, 0.48, 0.07]
    )
    
    unos_pool = df_clean['cause_of_death_unos'].unique().tolist()
    df_synth['primary_etiology'] = np.random.choice(unos_pool, size=n_samples)
    
    # Donation pathway conditionally correlated with brain_death
    pathway = []
    for bd in df_synth['brain_death']:
        if bd:
            pathway.append(np.random.choice(['DBD', 'DCD'], p=[0.90, 0.10]))
        else:
            pathway.append(np.random.choice(['DBD', 'DCD'], p=[0.05, 0.95]))
    df_synth['donation_pathway'] = pathway
    
    # Clinical process & behavioral attributes (Boolean fields)
    df_synth['premature_donation_mention'] = np.random.choice([True, False], size=n_samples, p=[0.15, 0.85])
    df_synth['multiple_decision_makers'] = np.random.choice([True, False], size=n_samples, p=[0.60, 0.40])
    df_synth['family_estrangement'] = np.random.choice([True, False], size=n_samples, p=[0.12, 0.88])
    df_synth['medical_mistrust'] = np.random.choice([True, False], size=n_samples, p=[0.18, 0.82])
    df_synth['interpreter_utilized'] = np.random.choice([True, False], size=n_samples, p=[0.22, 0.78])
    df_synth['patient_hemodynamically_unstable'] = np.random.choice([True, False], size=n_samples, p=[0.35, 0.65])
    df_synth['late_referral_rushing_withdrawal'] = np.random.choice([True, False], size=n_samples, p=[0.20, 0.80])
    
    df_synth['family_emotional_state'] = np.random.choice(
        ['Accepting', 'Ambivalent', 'Distressed / Grieving', 'Hostile', 'Numb / Shocked'], 
        size=n_samples, p=[0.25, 0.20, 0.35, 0.05, 0.15]
    )
    
    # 7. Enforce exact requested column schema
    requested_columns = [
        'age', 'gender', 'race', 'brain_death', 'cause_of_death_unos', 
        'mechanism_of_death', 'circumstances_of_death', 'registry_status', 
        'primary_etiology', 'donation_pathway', 'premature_donation_mention', 
        'multiple_decision_makers', 'family_estrangement', 'medical_mistrust', 
        'interpreter_utilized', 'patient_hemodynamically_unstable', 
        'late_referral_rushing_withdrawal', 'family_emotional_state', 
        'opc_id', 'authorized'
    ]
    
    df_final = df_synth[[col for col in requested_columns if col in df_synth.columns]]
    
    # Save output
    df_final.to_csv(output_csv, index=False)
    print(f"Successfully generated {n_samples} complete rows with zero blank/NaN values. Saved to {output_csv}")

if __name__ == '__main__':
    generate_expanded_dataset()
