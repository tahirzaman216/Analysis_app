from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "delivery_history.csv.csv"


def load_and_prepare_data():
    df = pd.read_csv(CSV_PATH)

    for col in ["Scheduled Delivery Date", "Delivered to Client Date", "Delivery Recorded Date"]:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    df["Delivery_Delay_Days"] = (
        df["Delivered to Client Date"] - df["Scheduled Delivery Date"]
    ).dt.days
    df["Delivery_Status"] = np.where(
        df["Delivery_Delay_Days"] > 0,
        "Late",
        np.where(df["Delivery_Delay_Days"] < 0, "Early", "On Time"),
    )
    df["is_late"] = (df["Delivery_Status"] == "Late").astype(int)

    # Additional temporal features
    df["Month"] = df["Delivery Recorded Date"].dt.month
    df["Year"] = df["Delivery Recorded Date"].dt.year
    df["Weekday"] = df["Delivery Recorded Date"].dt.dayofweek

    # Keep the most relevant business features; keep date column for monthly forecasting
    features = [
        "Country",
        "Vendor",
        "Shipment Mode",
        "Product Group",
        "Managed By",
        "Fulfill Via",
        "Vendor INCO Term",
        "Month",
        "Year",
        "Weekday",
        "Line Item Quantity",
        "Line Item Value",
        "Freight Cost (USD)",
        "Delivery Recorded Date",
    ]

    df_model = df[features + ["is_late"]].copy()
    df_model = df_model.sort_values("Year").reset_index(drop=True)

    return df_model


def train_late_risk_model(df):
    X = df[[c for c in df.columns if c not in ["is_late", "Delivery Recorded Date"]]]
    y = df["is_late"]

    cat_cols = X.select_dtypes(include=["object"]).columns.tolist()
    num_cols = X.select_dtypes(exclude=["object"]).columns.tolist()

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median"))]), num_cols),
            ("cat", Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("encoder", OneHotEncoder(handle_unknown="ignore")),
            ]), cat_cols),
        ]
    )

    model = Pipeline([
        ("preprocessor", preprocessor),
        ("classifier", RandomForestClassifier(
            n_estimators=250,
            max_depth=12,
            min_samples_leaf=5,
            random_state=42,
            class_weight="balanced"
        )),
    ])

    split_index = int(len(df) * 0.8)
    X_train = X.iloc[:split_index]
    X_test = X.iloc[split_index:]
    y_train = y.iloc[:split_index]
    y_test = y.iloc[split_index:]

    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    prob = model.predict_proba(X_test)[:, 1]

    print("Late shipment classification model")
    print("=" * 40)
    print(classification_report(y_test, preds, target_names=["Not Late", "Late"]))
    print(f"ROC AUC: {roc_auc_score(y_test, prob):.4f}")

    return model


def monthly_forecast_preview(df):
    monthly = (
        df.assign(Month=df["Delivery Recorded Date"].dt.to_period("M").astype(str))
        .groupby("Month")
        .agg(Shipments=("is_late", "count"), Late_Rate=("is_late", "mean"))
        .reset_index()
    )

    monthly["Month_Num"] = np.arange(len(monthly))
    monthly["sin_month"] = np.sin(2 * np.pi * monthly["Month_Num"] / 12)
    monthly["cos_month"] = np.cos(2 * np.pi * monthly["Month_Num"] / 12)

    # Simple month-ahead forecast using historic trend and seasonality
    train = monthly.iloc[:-3]
    test = monthly.iloc[-3:]

    X_train = train[["Month_Num", "sin_month", "cos_month"]]
    y_train = train["Shipments"]
    X_test = test[["Month_Num", "sin_month", "cos_month"]]
    y_test = test["Shipments"]

    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    model = LinearRegression()
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    print("\nMonthly shipment forecast preview")
    print("=" * 40)
    print(pd.DataFrame({
        "Actual": y_test.values,
        "Forecast": pred.round(0)
    }).to_string(index=False))
    print(f"MAE: {mean_absolute_error(y_test, pred):.2f}")
    print(f"RMSE: {np.sqrt(mean_squared_error(y_test, pred)):.2f}")
    print(f"R2: {r2_score(y_test, pred):.4f}")


def main():
    df = load_and_prepare_data()
    train_late_risk_model(df)
    monthly_forecast_preview(df)


if __name__ == "__main__":
    main()
