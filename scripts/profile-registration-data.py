#!/usr/bin/env python3
"""Create a privacy-safe profile of an FSY registration CSV.

The report contains aggregate counts and operational categories only. It never
prints names, contact details, medical notes, birthdays, or emergency contacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd


SENSITIVE_COLUMNS = {
    "First Name",
    "Last Name",
    "Preferred Name",
    "Birthday",
    "Phone",
    "Email",
    "Medical Information",
    "Dietary Information",
    "Contact 1 Name",
    "Contact 1 Email",
    "Contact 1 Phone",
    "Contact 2 Name",
    "Contact 2 Email",
    "Contact 2 Phone",
    "Bishop's Email",
    "Bishop's Name",
}

SAFE_CATEGORICAL_COLUMNS = {
    "Gender",
    "T-shirt Size",
    "Age",
    "Status",
    "Type",
    "Stake - District Name",
    "Ward - Branch Name",
}


def normalized_text(value: object) -> str:
    text = "" if pd.isna(value) else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()
    return re.sub(r"\s+", " ", text)


def nonempty(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.strip().ne("")


def compact_counts(series: pd.Series, limit: int = 20) -> dict[str, int]:
    values = series.fillna("(missing)").astype(str).str.strip().replace("", "(missing)")
    return {str(key): int(value) for key, value in values.value_counts().head(limit).items()}


def repeated_nonempty(series: pd.Series) -> dict[str, int]:
    cleaned = series.fillna("").astype(str).str.strip().str.casefold()
    cleaned = cleaned[cleaned.ne("")]
    counts = cleaned.value_counts()
    duplicate_groups = counts[counts.gt(1)]
    return {
        "duplicate_groups": int(duplicate_groups.size),
        "rows_in_duplicate_groups": int(duplicate_groups.sum()),
    }


def parse_dates(series: pd.Series, *, dayfirst: bool) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", format="mixed", dayfirst=dayfirst)


def age_on(date_of_birth: pd.Series, reference: pd.Timestamp) -> pd.Series:
    years = reference.year - date_of_birth.dt.year
    before_birthday = (reference.month < date_of_birth.dt.month) | (
        (reference.month == date_of_birth.dt.month) & (reference.day < date_of_birth.dt.day)
    )
    return years - before_birthday.astype("Int64")


def normalized_variant_summary(series: pd.Series) -> dict[str, object]:
    frame = pd.DataFrame({"original": series.fillna("").astype(str).str.strip()})
    frame = frame[frame["original"].ne("")]
    frame["normalized"] = frame["original"].map(normalized_text)
    variants = frame.groupby("normalized")["original"].agg(lambda values: sorted(set(values)))
    collision_groups = variants[variants.map(len).gt(1)]
    # Unit/stake names are operational categories, but keep the output compact.
    examples = [items[:6] for items in collision_groups.head(20).tolist()]
    return {
        "normalized_distinct": int(frame["normalized"].nunique()),
        "variant_groups": int(collision_groups.size),
        "variant_examples": examples,
    }


def sensitive_note_coverage(series: pd.Series, kind: str) -> dict[str, int]:
    normalized = series.map(normalized_text)
    negative = {
        "", "no", "none", "nil", "na", "n a", "not applicable", "nothing",
        "no known allergies", "no allergy", "no allergies",
    }
    if kind == "medical":
        negative.update({"no medical condition", "no medical conditions", "no medical issue", "no medical issues"})
    meaningful = ~normalized.isin(negative)
    return {
        "blank": int(normalized.eq("").sum()),
        "empty_or_negative": int(normalized.isin(negative).sum()),
        "potentially_actionable": int(meaningful.sum()),
    }


def column_profile(frame: pd.DataFrame, column: str) -> dict[str, object]:
    series = frame[column]
    present = nonempty(series)
    result: dict[str, object] = {
        "missing": int((~present).sum()),
        "missing_rate": round(float((~present).mean()), 4),
        "distinct_nonempty": int(series[present].astype(str).str.strip().nunique()),
    }
    if column in SAFE_CATEGORICAL_COLUMNS:
        result["top_values"] = compact_counts(series)
    if column in SENSITIVE_COLUMNS:
        result["values_suppressed"] = True
    return result


def profile(path: Path) -> dict[str, object]:
    raw = path.read_bytes()
    encoding = "utf-8-sig"
    try:
        raw.decode(encoding)
    except UnicodeDecodeError:
        encoding = "cp1252"

    frame = pd.read_csv(path, dtype=str, encoding=encoding, keep_default_na=False)
    frame.columns = [str(column).strip() for column in frame.columns]
    for column in frame.columns:
        frame[column] = frame[column].astype(str).str.strip()

    required = {
        "First Name", "Last Name", "Birthday", "Gender", "Age", "Type",
        "Stake - District Name", "Ward - Branch Name",
    }
    missing_required = sorted(required.difference(frame.columns))
    if missing_required:
        raise ValueError(f"Missing expected columns: {', '.join(missing_required)}")

    dob_us = parse_dates(frame["Birthday"], dayfirst=False)
    dob_dmy = parse_dates(frame["Birthday"], dayfirst=True)
    stated_age = pd.to_numeric(frame["Age"], errors="coerce")
    session_start = pd.Timestamp("2026-09-14")
    derived_us = age_on(dob_us, session_start)
    derived_dmy = age_on(dob_dmy, session_start)
    comparable_us = stated_age.notna() & derived_us.notna()
    comparable_dmy = stated_age.notna() & derived_dmy.notna()

    type_values = frame["Type"].map(normalized_text)
    youth_mask = type_values.str.contains(r"participant|youth", regex=True)
    if not youth_mask.any():
        # The export may use a local label. Ages 14–18 are a safer fallback than
        # treating YSA/staff rows as youth.
        youth_mask = stated_age.between(14, 18, inclusive="both")

    birthdays_mask = (
        youth_mask
        & dob_us.notna()
        & (dob_us.dt.month == 9)
        & dob_us.dt.day.between(14, 19, inclusive="both")
    )
    birthday_counts = {
        f"2026-09-{day:02d}": int((birthdays_mask & dob_us.dt.day.eq(day)).sum())
        for day in range(14, 20)
    }
    turning_ages = (2026 - dob_us[birthdays_mask].dt.year).astype("Int64")

    full_name = (
        frame["First Name"].map(normalized_text)
        + " "
        + frame["Last Name"].map(normalized_text)
    ).str.strip()
    dob_key = dob_us.dt.strftime("%Y-%m-%d").fillna("")
    person_key = full_name + "|" + dob_key
    person_key = person_key[full_name.ne("") & dob_key.ne("")]
    person_counts = person_key.value_counts()
    person_duplicates = person_counts[person_counts.gt(1)]

    identity_email = frame["Email"].map(normalized_text) if "Email" in frame else pd.Series("", index=frame.index)
    identity_phone = frame["Phone"].map(normalized_text) if "Phone" in frame else pd.Series("", index=frame.index)
    candidate_identity = identity_email.where(identity_email.ne(""), identity_phone)
    candidate_identity = candidate_identity.where(
        candidate_identity.ne(""),
        person_key.reindex(frame.index, fill_value=""),
    )
    candidate_counts = candidate_identity[candidate_identity.ne("")].value_counts()

    registration_date = parse_dates(frame["Date"], dayfirst=False) if "Date" in frame else pd.Series(pd.NaT, index=frame.index)
    type_name_dob_unit = (
        type_values + "|" + full_name + "|" + dob_key + "|" + frame["Ward - Branch Name"].map(normalized_text)
    )
    source_key_material = type_name_dob_unit + "|" + frame["Date"].map(normalized_text)
    type_name_counts = type_name_dob_unit[type_name_dob_unit.str.replace("|", "", regex=False).ne("")].value_counts()
    source_key_counts = source_key_material[source_key_material.str.replace("|", "", regex=False).ne("")].value_counts()

    date_patterns = (
        frame["Birthday"]
        .where(nonempty(frame["Birthday"]), "(missing)")
        .map(lambda value: re.sub(r"\d", "9", value))
        .value_counts()
        .head(12)
    )

    report: dict[str, object] = {
        "file": {
            "name": path.name,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "encoding": encoding,
        },
        "shape": {"rows": int(len(frame)), "columns": int(len(frame.columns))},
        "columns": list(frame.columns),
        "column_profiles": {column: column_profile(frame, column) for column in frame.columns},
        "record_distributions": {
            "type": compact_counts(frame["Type"]),
            "status": compact_counts(frame["Status"]) if "Status" in frame else {},
            "gender": compact_counts(frame["Gender"]),
            "age": compact_counts(frame["Age"]),
            "stake": compact_counts(frame["Stake - District Name"]),
            "unit_top_20": compact_counts(frame["Ward - Branch Name"]),
            "type_by_status": {
                str(record_type): {str(status): int(count) for status, count in row.items()}
                for record_type, row in pd.crosstab(frame["Type"], frame["Status"]).to_dict(orient="index").items()
            },
            "type_by_gender": {
                str(record_type): {str(gender): int(count) for gender, count in row.items()}
                for record_type, row in pd.crosstab(frame["Type"], frame["Gender"]).to_dict(orient="index").items()
            },
            "age_by_type": {
                str(record_type): {
                    str(age): int(count)
                    for age, count in group["Age"].value_counts().sort_index(key=lambda index: pd.to_numeric(index, errors="coerce")).items()
                }
                for record_type, group in frame.groupby("Type")
            },
        },
        "date_quality": {
            "birthday_patterns": {str(key): int(value) for key, value in date_patterns.items()},
            "us_parse_success": int(dob_us.notna().sum()),
            "dmy_parse_success": int(dob_dmy.notna().sum()),
            "us_age_exact_match_at_session_start": int((derived_us[comparable_us] == stated_age[comparable_us]).sum()),
            "dmy_age_exact_match_at_session_start": int((derived_dmy[comparable_dmy] == stated_age[comparable_dmy]).sum()),
            "comparable_age_rows": int(comparable_us.sum()),
            "future_birthdays": int((dob_us > session_start).sum()),
            "registration_date_parse_success": int(registration_date.notna().sum()),
            "registration_date_min": registration_date.min().isoformat() if registration_date.notna().any() else None,
            "registration_date_max": registration_date.max().isoformat() if registration_date.notna().any() else None,
        },
        "duplicates": {
            "exact_rows": int(frame.duplicated(keep=False).sum()),
            "name_and_birthday_groups": int(person_duplicates.size),
            "rows_in_name_and_birthday_groups": int(person_duplicates.sum()),
            "email": repeated_nonempty(frame["Email"]) if "Email" in frame else {},
            "phone": repeated_nonempty(frame["Phone"]) if "Phone" in frame else {},
            "candidate_identity_missing": int(candidate_identity.eq("").sum()),
            "candidate_identity_collision_groups": int(candidate_counts[candidate_counts.gt(1)].size),
            "candidate_identity_rows_in_collisions": int(candidate_counts[candidate_counts.gt(1)].sum()),
            "type_name_birthday_unit_collision_groups": int(type_name_counts[type_name_counts.gt(1)].size),
            "type_name_birthday_unit_rows_in_collisions": int(type_name_counts[type_name_counts.gt(1)].sum()),
            "source_key_with_registration_date_collision_groups": int(source_key_counts[source_key_counts.gt(1)].size),
            "source_key_with_registration_date_rows_in_collisions": int(source_key_counts[source_key_counts.gt(1)].sum()),
        },
        "normalization": {
            "stake": normalized_variant_summary(frame["Stake - District Name"]),
            "unit": normalized_variant_summary(frame["Ward - Branch Name"]),
        },
        "conference_birthdays": {
            "window": ["2026-09-14", "2026-09-19"],
            "youth_count": int(birthdays_mask.sum()),
            "by_date": birthday_counts,
            "turning_age_distribution": {
                str(key): int(value) for key, value in turning_ages.value_counts().sort_index().items()
            },
            "by_registration_status": compact_counts(frame.loc[birthdays_mask, "Status"]),
        },
        "privacy_relevant_coverage": {
            "medical_information": sensitive_note_coverage(frame["Medical Information"], "medical") if "Medical Information" in frame else {},
            "dietary_information": sensitive_note_coverage(frame["Dietary Information"], "dietary") if "Dietary Information" in frame else {},
            "participant_email_present": int((youth_mask & nonempty(frame["Email"])).sum()) if "Email" in frame else 0,
            "participant_phone_present": int((youth_mask & nonempty(frame["Phone"])).sum()) if "Phone" in frame else 0,
            "contact_1_phone_present": int(nonempty(frame["Contact 1 Phone"]).sum()) if "Contact 1 Phone" in frame else 0,
            "contact_2_phone_present": int(nonempty(frame["Contact 2 Phone"]).sum()) if "Contact 2 Phone" in frame else 0,
        },
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = profile(args.csv_path)
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
