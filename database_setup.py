from pathlib import Path
import sqlite3

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "delivery_history.csv.csv"
DB_PATH = BASE_DIR / "delivery_database.db"


def clean_delivery_data(df: pd.DataFrame) -> pd.DataFrame:
    df_clean = df.copy()

    for col in df_clean.select_dtypes(include=["object"]).columns:
        df_clean[col] = df_clean[col].astype(str).str.strip()
        df_clean[col] = df_clean[col].replace({"nan": np.nan, "None": np.nan, "NaN": np.nan})

    df_clean = df_clean.drop_duplicates().copy()

    for col in df_clean.select_dtypes(include=["object"]).columns:
        df_clean[col] = df_clean[col].fillna("Unknown")

    for col in df_clean.select_dtypes(include=["number"]).columns:
        if df_clean[col].isnull().any():
            df_clean[col] = df_clean[col].fillna(df_clean[col].median())

    for col in ["Scheduled Delivery Date", "Delivered to Client Date", "Delivery Recorded Date"]:
        df_clean[col] = pd.to_datetime(df_clean[col], errors="coerce")

    if {"Scheduled Delivery Date", "Delivered to Client Date"}.issubset(df_clean.columns):
        df_clean["Delivery_Delay_Days"] = (
            df_clean["Delivered to Client Date"] - df_clean["Scheduled Delivery Date"]
        ).dt.days
        df_clean["Delivery_Status"] = np.where(
            df_clean["Delivery_Delay_Days"] > 0,
            "Late",
            np.where(df_clean["Delivery_Delay_Days"] < 0, "Early", "On Time"),
        )

    return df_clean


def build_summary_tables(conn: sqlite3.Connection, df: pd.DataFrame) -> None:
    country_summary = (
        df.groupby("Country")
        .agg(
            Total_Shipments=("ID", "count"),
            Late_Shipments=("Delivery_Status", lambda s: (s == "Late").sum()),
            Avg_Delay=("Delivery_Delay_Days", "mean"),
        )
        .reset_index()
    )
    country_summary["Late_Rate_pct"] = (
        country_summary["Late_Shipments"] / country_summary["Total_Shipments"] * 100
    ).round(2)

    vendor_summary = (
        df.groupby("Vendor")
        .agg(
            Total_Shipments=("ID", "count"),
            Late_Shipments=("Delivery_Status", lambda s: (s == "Late").sum()),
            Avg_Delay=("Delivery_Delay_Days", "mean"),
        )
        .reset_index()
    )
    vendor_summary["Late_Rate_pct"] = (
        vendor_summary["Late_Shipments"] / vendor_summary["Total_Shipments"] * 100
    ).round(2)

    product_summary = (
        df.groupby("Product Group")
        .agg(
            Total_Shipments=("ID", "count"),
            Total_Value=("Line Item Value", "sum"),
            Avg_Delay=("Delivery_Delay_Days", "mean"),
            Late_Rate_pct=("Delivery_Status", lambda s: (s == "Late").mean() * 100),
        )
        .reset_index()
    )

    monthly_summary = (
        df.assign(Month=df["Delivery Recorded Date"].dt.to_period("M").astype(str))
        .groupby("Month")
        .agg(
            Total_Shipments=("ID", "count"),
            Late_Shipments=("Delivery_Status", lambda s: (s == "Late").sum()),
            Avg_Delay=("Delivery_Delay_Days", "mean"),
        )
        .reset_index()
    )
    monthly_summary["Late_Rate_pct"] = (
        monthly_summary["Late_Shipments"] / monthly_summary["Total_Shipments"] * 100
    ).round(2)

    country_summary.to_sql("country_performance", conn, if_exists="replace", index=False)
    vendor_summary.to_sql("vendor_performance", conn, if_exists="replace", index=False)
    product_summary.to_sql("product_performance", conn, if_exists="replace", index=False)
    monthly_summary.to_sql("monthly_performance", conn, if_exists="replace", index=False)


def main():
    df = pd.read_csv(CSV_PATH)
    df_clean = clean_delivery_data(df)

    conn = sqlite3.connect(DB_PATH)
    df_clean.to_sql("delivery_fact", conn, if_exists="replace", index=False)
    build_summary_tables(conn, df_clean)
    conn.close()

    print(f"Database created successfully: {DB_PATH}")
    print(f"Rows inserted: {len(df_clean)}")
    print("Tables created: delivery_fact, country_performance, vendor_performance, product_performance, monthly_performance")


if __name__ == "__main__":
    main()
